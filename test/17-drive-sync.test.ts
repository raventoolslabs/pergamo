import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import Config from '@/shared/config';
import { documentRepository } from '@/infrastructure/db/repositories/document.repository';
import { driveConnectionRepository } from '@/infrastructure/db/repositories/drive-connection.repository';
import { driveFolderRepository } from '@/infrastructure/db/repositories/drive-folder.repository';
import { sequelizeUnitOfWork } from '@/infrastructure/db/unit-of-work';
import { syncDriveFolder } from '@/app/use-cases/drive/commands/sync-drive-folder.handler';
import { DriveDeps } from '@/app/use-cases/drive/dependencies';
import { DriveFile } from '@/domain/entities/drive';
import { DriveUnavailableError } from '@/domain/exceptions/drive.exception';

const ORGANIZATION = 'drive-sync';
const PDF = 'application/pdf';

const file = (id:string, md5 = 'v1', extra:Partial<DriveFile> = {}):DriveFile =>
  ({ id, name: `${id}.pdf`, mimetype: PDF, size: 100, md5Checksum: md5, version: '1', modifiedTime: 't', ...extra });

/**
 * Drive de prueba: cada carpeta es una lista de ficheros, y `failAfter` corta el
 * recorrido a mitad como lo haria una cuota agotada. A Google no se llama.
 */
const fakeDrive = (tree:Record<string, DriveFile[]>, failAfter?:number) => ({
  async *walk(_organization:string, folderId:string) {
    let count = 0;
    for(const item of tree[folderId] ?? []) {
      if(failAfter !== undefined && count++ >= failAfter) throw new DriveUnavailableError('quota');
      yield item;
    }
  }
});

describe('Drive sync', () => {

  let enqueued:string[];
  let deletedChunks:string[];
  let sweeps:number;
  let folderA:string;
  let folderB:string;

  const deps = (tree:Record<string, DriveFile[]>, failAfter?:number) => ({
    drive: fakeDrive(tree, failAfter),
    connections: driveConnectionRepository,
    folders: driveFolderRepository,
    documents: documentRepository,
    chunks: { deleteByDocument: async (id:string) => { deletedChunks.push(id); } },
    syncQueue: null,
    indexQueue: { enqueue: async (id:string) => { enqueued.push(id); }, close: async () => {} },
    rescanQueue: { enqueueSweep: async () => { sweeps++; return { status: 'queued' }; } },
    unitOfWork: sequelizeUnitOfWork
  }) as unknown as DriveDeps;

  const sync = (folder:string, tree:Record<string, DriveFile[]>, failAfter?:number) =>
    syncDriveFolder({ organization: ORGANIZATION, folder, trace: 'test' }, deps(tree, failAfter));

  const row = async (fileId:string) => {
    const rows:any = await sequelize.query(
      `SELECT id, drive_folder, drive_revision, index_status, scan_status, discharge_date, metadata
      FROM pergamo.document WHERE organization = :organization AND drive_file_id = :fileId;`, {
      replacements: { organization: ORGANIZATION, fileId },
      type: QueryTypes.SELECT
    });
    return rows[0];
  };

  const cleanup = async () => {
    await sequelize.query('DELETE FROM pergamo.document WHERE organization = :organization;', {
      replacements: { organization: ORGANIZATION }, type: QueryTypes.DELETE });
    await sequelize.query('DELETE FROM pergamo.organization WHERE id = :organization;', {
      replacements: { organization: ORGANIZATION }, type: QueryTypes.DELETE });
  };

  beforeAll(async () => {

    await cleanup();
    await sequelize.query(
      `INSERT INTO pergamo.organization(id, name, password) VALUES (:id, :id, crypt('Pergamo0123#', gen_salt('bf')));`, {
      replacements: { id: ORGANIZATION }, type: QueryTypes.INSERT });

    folderA = (await driveFolderRepository.create({ organization: ORGANIZATION, folderId: 'A', name: 'A', indexDocuments: true })).id;
    folderB = (await driveFolderRepository.create({ organization: ORGANIZATION, folderId: 'B', name: 'B', indexDocuments: false })).id;
  });

  beforeEach(() => {
    enqueued = [];
    deletedChunks = [];
    sweeps = 0;
  });

  afterAll(async () => {
    await cleanup();
    await sequelize.close();
  });

  it('Should import supported files as pending and skip the rest', async () => {

    const progress = await sync(folderA, { A: [file('a'), file('b'), file('video', 'x', { mimetype: 'video/mp4' })] });

    expect(progress).toMatchObject({ seen: 3, created: 2, skipped: 1 });

    const a = await row('a');
    expect(a).toMatchObject({ drive_folder: folderA, drive_revision: 'v1', index_status: 'pending', scan_status: 'pending' });
    expect(a.metadata).toMatchObject({ name: 'a', extension: 'pdf', hash: 'drive:v1' });
    expect(enqueued).toHaveLength(2);
    // Lo importado entra sin veredicto: se pide el barrido, si hay antivirus.
    expect(sweeps).toBe(Config.enable_antivirus ? 1 : 0);
    expect((await driveFolderRepository.findById(ORGANIZATION, folderA)).syncDate).toBeInstanceOf(Date);
  });

  it('Should do nothing when nothing changed', async () => {

    const progress = await sync(folderA, { A: [file('a'), file('b')] });

    expect(progress).toMatchObject({ created: 0, updated: 0, restored: 0, discharged: 0 });
    expect(enqueued).toHaveLength(0);
    expect(sweeps).toBe(0);
  });

  it('Should reindex a changed file that had an index and keep its tags', async () => {

    await sequelize.query(
      `UPDATE pergamo.document SET index_status = 'indexed', scan_status = 'clean',
        metadata = jsonb_set(metadata, '{tags}', '["keep"]') WHERE drive_file_id = 'a';`, { type: QueryTypes.UPDATE });

    const progress = await sync(folderA, { A: [file('a', 'v2'), file('b')] });

    expect(progress.updated).toBe(1);
    const a = await row('a');
    expect(a).toMatchObject({ drive_revision: 'v2', index_status: 'pending', scan_status: 'pending' });
    expect(a.metadata.tags).toEqual(['keep']);
    expect(enqueued).toEqual([a.id]);
  });

  // Un fallo de red a mitad no puede vaciar el repositorio.
  it('Should discharge nothing when the walk aborts', async () => {

    await expect(sync(folderA, { A: [file('a', 'v2'), file('b')] }, 0)).rejects.toThrow('quota');

    expect((await row('a')).discharge_date).toBeNull();
    expect((await row('b')).discharge_date).toBeNull();
    expect(deletedChunks).toHaveLength(0);
    expect((await driveFolderRepository.findById(ORGANIZATION, folderA)).syncError).toBe('quota');
  });

  it('Should discharge what disappeared and drop its chunks', async () => {

    const progress = await sync(folderA, { A: [file('a', 'v2')] });

    expect(progress.discharged).toBe(1);
    const b = await row('b');
    expect(b.discharge_date).not.toBeNull();
    expect(deletedChunks).toEqual([b.id]);
    expect((await driveFolderRepository.findById(ORGANIZATION, folderA)).syncError).toBeUndefined();
  });

  it('Should revive a file that comes back with the same id', async () => {

    const before = await row('b');
    const progress = await sync(folderA, { A: [file('a', 'v2'), file('b')] });

    expect(progress.restored).toBe(1);
    const b = await row('b');
    expect(b.id).toBe(before.id);
    expect(b.discharge_date).toBeNull();
  });

  it('Should not steal or discharge files of an overlapping folder', async () => {

    const progress = await sync(folderB, { B: [file('a', 'v2')] });
    expect(progress).toMatchObject({ created: 0, updated: 0 });
    expect((await row('a')).drive_folder).toBe(folderA);

    await sync(folderB, { B: [] });
    expect((await row('a')).discharge_date).toBeNull();
  });
});
