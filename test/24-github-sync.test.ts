import fs from 'fs';
import path from 'path';

import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import Config from '@/shared/config';
import { documentRepository } from '@/infrastructure/db/repositories/document.repository';
import { githubRepositoryRepository } from '@/infrastructure/db/repositories/github-repository.repository';
import { documentStorage } from '@/infrastructure/files/document-storage';
import { sequelizeUnitOfWork } from '@/infrastructure/db/unit-of-work';
import { syncGitHubRepository } from '@/app/use-cases/github/commands/sync-github-repository.handler';
import { GitHubDeps } from '@/app/use-cases/github/dependencies';
import { GitHubFile, isExcluded } from '@/domain/entities/github';
import { GitHubUnavailableError } from '@/domain/exceptions/github.exception';

const ORGANIZATION = 'github-sync';

const file = (name:string, sha = 'v1'):GitHubFile =>
  ({ path: `docs/${name}.md`, sha, size: 100, viewLink: `https://github.com/acme/docs/blob/x/docs/${name}.md` });

/**
 * GitHub de prueba: un commit y su arbol. `failAfter` corta el recorrido a mitad
 * como lo haria la cuota agotada, y `downloads` apunta lo que se bajo de verdad.
 */
const fakeGitHub = (commit:string, tree:GitHubFile[], failAfter?:number, downloads:string[] = []) => ({
  head: async () => commit,
  async *walk() {
    let count = 0;
    for(const item of tree) {
      if(failAfter !== undefined && count++ >= failAfter) throw new GitHubUnavailableError('quota');
      yield item;
    }
  },
  download: async (_organization:string, _owner:string, _repository:string, sha:string, target:string) => {
    downloads.push(sha);
    await fs.promises.writeFile(target, `# ${sha}\n`);
    return true;
  },
  downloads
});

describe('GitHub sync', () => {

  let enqueued:string[];
  let deletedChunks:string[];
  let sweeps:number;
  let downloads:string[];
  let repository:string;
  let copied:string;

  const deps = (commit:string, tree:GitHubFile[], failAfter?:number) => ({
    github: fakeGitHub(commit, tree, failAfter, downloads),
    settings: null,
    repositories: githubRepositoryRepository,
    documents: documentRepository,
    chunks: { deleteByDocument: async (id:string) => { deletedChunks.push(id); } },
    storage: documentStorage,
    syncQueue: null,
    indexQueue: { enqueue: async (id:string) => { enqueued.push(id); }, close: async () => {} },
    rescanQueue: { enqueueSweep: async () => { sweeps++; return { status: 'queued' }; } },
    unitOfWork: sequelizeUnitOfWork
  }) as unknown as GitHubDeps;

  const sync = (commit:string, tree:GitHubFile[], failAfter?:number) =>
    syncGitHubRepository({ organization: ORGANIZATION, repository, trace: 'test' }, deps(commit, tree, failAfter));

  const row = async (filePath:string) => {
    const rows:any = await sequelize.query(
      `SELECT id, path, remote_folder, remote_revision, index_status, scan_status, discharge_date, metadata
      FROM pergamo.document WHERE organization = :organization AND remote_file_id = :fileId;`, {
      replacements: { organization: ORGANIZATION, fileId: `acme/docs@main:${filePath}` },
      type: QueryTypes.SELECT
    });
    return rows[0];
  };

  const cleanup = async () => {
    await sequelize.query('DELETE FROM pergamo.document WHERE organization = :organization;', {
      replacements: { organization: ORGANIZATION }, type: QueryTypes.DELETE });
    await sequelize.query('DELETE FROM pergamo.organization WHERE id = :organization;', {
      replacements: { organization: ORGANIZATION }, type: QueryTypes.DELETE });
    await fs.promises.rm(path.join(Config.path_base, ORGANIZATION), { recursive: true, force: true });
  };

  beforeAll(async () => {

    await cleanup();
    await sequelize.query(
      `INSERT INTO pergamo.organization(id, name, password) VALUES (:id, :id, crypt('Pergamo0123#', gen_salt('bf')));`, {
      replacements: { id: ORGANIZATION }, type: QueryTypes.INSERT });

    repository = (await githubRepositoryRepository.create({
      organization: ORGANIZATION, owner: 'acme', repository: 'docs', branch: 'main',
      indexDocuments: true, storeContent: true, excludes: []
    })).id;
  });

  beforeEach(() => {
    enqueued = [];
    deletedChunks = [];
    downloads = [];
    sweeps = 0;
  });

  afterAll(async () => {
    await cleanup();
    await sequelize.close();
  });

  it('Should import the markdown of the branch and keep a copy', async () => {

    const progress = await sync('c1', [file('guide'), file('readme')]);

    expect(progress).toMatchObject({ seen: 2, created: 2, skipped: 0 });

    const guide = await row('docs/guide.md');
    expect(guide).toMatchObject({ remote_folder: repository, remote_revision: 'v1', index_status: 'pending', scan_status: 'pending' });
    expect(guide.metadata).toMatchObject({
      name: 'docs/guide', original_name: 'guide.md', mimetype: 'text/markdown',
      extension: 'md', hash: 'github:v1', repository: 'acme/docs', branch: 'main', path: 'docs/guide.md'
    });
    expect(enqueued).toHaveLength(2);
    expect(sweeps).toBe(Config.enable_antivirus ? 1 : 0);

    // La copia en Pergamo: con ella el documento se entrega sin la API.
    copied = documentStorage.resolve(ORGANIZATION, guide.path);
    expect(await documentStorage.exists(copied)).toBe(true);

    const stored = await githubRepositoryRepository.findById(ORGANIZATION, repository);
    expect(stored.lastCommit).toBe('c1');
    expect(stored.syncDate).toBeInstanceOf(Date);
  });

  // El atajo del enunciado: el commit es lo primero que se mira.
  it('Should not walk the tree when the branch is still on the same commit', async () => {

    const progress = await sync('c1', [file('guide'), file('readme')]);

    expect(progress).toMatchObject({ seen: 0, created: 0, updated: 0 });
    expect(downloads).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it('Should reindex only what changed when the branch moves on', async () => {

    await sequelize.query(
      `UPDATE pergamo.document SET index_status = 'indexed', scan_status = 'clean',
        metadata = jsonb_set(metadata, '{tags}', '["keep"]')
      WHERE organization = :organization;`, {
      replacements: { organization: ORGANIZATION }, type: QueryTypes.UPDATE });

    const progress = await sync('c2', [file('guide', 'v2'), file('readme')]);

    expect(progress).toMatchObject({ seen: 2, updated: 1 });

    const guide = await row('docs/guide.md');
    expect(guide).toMatchObject({ remote_revision: 'v2', index_status: 'pending', scan_status: 'pending' });
    expect(guide.metadata.tags).toEqual(['keep']);
    expect(enqueued).toEqual([guide.id]);
    // Solo el que cambio se vuelve a bajar.
    expect(downloads).toEqual(['v2']);
  });

  // Un fallo de red a mitad no puede vaciar el archivo ni adelantar el commit.
  it('Should discharge nothing and keep the commit when the walk aborts', async () => {

    await expect(sync('c3', [file('guide', 'v2')], 0)).rejects.toThrow('quota');

    expect((await row('docs/guide.md')).discharge_date).toBeNull();
    expect((await row('docs/readme.md')).discharge_date).toBeNull();

    const stored = await githubRepositoryRepository.findById(ORGANIZATION, repository);
    expect(stored.lastCommit).toBe('c2');
    expect(stored.syncError).toBe('quota');
  });

  it('Should discharge what disappeared from the branch and drop its chunks', async () => {

    const progress = await sync('c3', [file('guide', 'v2')]);

    expect(progress.discharged).toBe(1);

    const readme = await row('docs/readme.md');
    expect(readme.discharge_date).not.toBeNull();
    expect(deletedChunks).toEqual([readme.id]);

    const stored = await githubRepositoryRepository.findById(ORGANIZATION, repository);
    expect(stored.lastCommit).toBe('c3');
    expect(stored.syncError).toBeUndefined();
  });

  it('Should revive a file that comes back with the same id', async () => {

    const before = await row('docs/readme.md');
    const progress = await sync('c4', [file('guide', 'v2'), file('readme')]);

    expect(progress.restored).toBe(1);

    const readme = await row('docs/readme.md');
    expect(readme.id).toBe(before.id);
    expect(readme.discharge_date).toBeNull();
  });

  it('Should skip a file larger than the deployment allows', async () => {

    const huge = { ...file('huge'), size: Config.max_file_size + 1 };
    const progress = await sync('c5', [file('guide', 'v2'), file('readme'), huge]);

    expect(progress).toMatchObject({ seen: 3, skipped: 1, created: 0 });
    expect(await row('docs/huge.md')).toBeUndefined();
  });

  // Excluir no es solo dejar de traer: lo que ya estaba archivado se retira.
  it('Should discharge what an exclusion leaves out and bring it back when it is removed', async () => {

    const excluded = await githubRepositoryRepository.updateExcludes(ORGANIZATION, repository, ['docs/readme.md']);

    // Sin olvidar el commit, la pasada daria la rama por hecha y no se aplicaria.
    expect(excluded.excludes).toEqual(['docs/readme.md']);
    expect(excluded.lastCommit).toBeUndefined();

    const progress = await sync('c5', [file('guide', 'v2'), file('readme')]);

    const excludedRow = await row('docs/readme.md');

    expect(progress).toMatchObject({ seen: 2, skipped: 1, discharged: 1 });
    expect(excludedRow.discharge_date).not.toBeNull();
    // Lo que importa: sale del indice, no solo del archivo.
    expect(excludedRow.index_status).toBe('none');
    expect(deletedChunks).toEqual([excludedRow.id]);

    await githubRepositoryRepository.updateExcludes(ORGANIZATION, repository, []);
    const back = await sync('c5', [file('guide', 'v2'), file('readme')]);

    expect(back.restored).toBe(1);
    expect((await row('docs/readme.md')).discharge_date).toBeNull();
  });

  it('Should take a pattern without wildcards as a folder too', () => {

    expect(isExcluded('docs/private/a.md', ['docs/private'])).toBe(true);
    expect(isExcluded('docs/a.md', ['docs/private'])).toBe(false);
    expect(isExcluded('docs/a.md', ['**/*.md'])).toBe(true);
    expect(isExcluded('CHANGELOG.md', ['CHANGELOG.md'])).toBe(true);
  });
});
