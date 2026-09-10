import fs from 'fs';
import path from 'path';

import Config from '@/shared/config';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { indexDocument } from '@/app/use-cases/indexing/commands/index-document.handler';
import { IndexingDeps } from '@/app/use-cases/indexing/dependencies';
import { documentRepository } from '@/infrastructure/db/repositories/document.repository';
import { documentChunkRepository } from '@/infrastructure/db/repositories/document-chunk.repository';
import { sequelizeUnitOfWork } from '@/infrastructure/db/unit-of-work';
import { documentStorage } from '@/infrastructure/files/document-storage';
import { officeParserConverter } from '@/infrastructure/indexing/converters/officeparser.converter';
import { chunker } from '@/infrastructure/indexing/chunker';
import { ProviderUnavailableError } from '@/domain/exceptions/indexing.exception';
import { EmbeddingProvider } from '@/app/ports/services/embedding-provider.service';

const DIMENSION = Config.indexing.embedding.dimension;
const PDF = 'application/pdf';

const vector = (seed:number) => {
  const values = new Array(DIMENSION).fill(0);
  values[seed % DIMENSION] = 1;
  return values;
};

/**
 * Embebedor de prueba: la maquina de inferencia no participa. Es el motivo por
 * el que el caso de uso recibe sus dependencias por parametro.
 */
const fakeEmbedder = (behaviour:{ fail?:boolean } = {}):EmbeddingProvider => ({
  provider: 'test',
  model: 'test-model',
  dimension: DIMENSION,
  distance: 'cosine',
  init: async () => {},
  embedQuery: async () => vector(0),
  embedDocuments: async (texts) => {
    if(behaviour.fail) throw new ProviderUnavailableError('the test provider is down');
    return texts.map((_, index) => vector(index));
  }
});

const deps = (overrides:Partial<IndexingDeps> = {}):IndexingDeps => ({
  documents: documentRepository,
  chunks: documentChunkRepository,
  converter: officeParserConverter,
  chunker,
  embedder: fakeEmbedder(),
  storage: documentStorage,
  unitOfWork: sequelizeUnitOfWork,
  ...overrides
});

const ORGANIZATIONS = ['index-a', 'index-b'];

const createOrganization = (id:string) =>
  sequelize.query(
    `INSERT INTO pergamo.organization(id, name, password)
     VALUES (:id, :id, crypt('Pergamo0123#', gen_salt('bf')))
     ON CONFLICT (id) DO NOTHING;`, { replacements: { id }, type: QueryTypes.INSERT });

/** Deposita un fichero como lo haria una subida, sin pasar por la API. */
const createDocument = async (organization:string, source:string, mimetype:string, hash = 'h-' + Date.now()) => {

  const rows:any = await sequelize.query(
    `INSERT INTO pergamo.document(metadata, organization, scan_status)
     VALUES (:metadata::jsonb, :organization, 'clean') RETURNING id, path;`, {
    replacements: {
      organization,
      metadata: JSON.stringify({ name: 'probe', extension: 'pdf', mimetype, hash, tags: [] })
    },
    type: QueryTypes.SELECT
  });

  const document = rows[0];

  if(source) {
    const target = documentStorage.resolve(organization, document.path);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.copyFile(source, target);
  }

  return document;
};

const stateOf = async (id:string) => {
  const rows:any = await sequelize.query(
    'SELECT index_status, index_error, index_chunks, index_model FROM pergamo.document WHERE id = :id;', {
    replacements: { id }, type: QueryTypes.SELECT });
  return rows[0];
};

const asset = (name:string) => path.join(__dirname, 'assets', name);

describe('Document indexing', () => {

  const created:string[] = [];

  beforeAll(async () => {
    for(const organization of ORGANIZATIONS) await createOrganization(organization);
  });

  afterAll(async () => {
    await sequelize.query('DELETE FROM pergamo.document WHERE organization IN (:organizations);', {
      replacements: { organizations: ORGANIZATIONS }, type: QueryTypes.DELETE });
    await sequelize.query('DELETE FROM pergamo.organization WHERE id IN (:organizations);', {
      replacements: { organizations: ORGANIZATIONS }, type: QueryTypes.DELETE });
    await sequelize.close();
  });

  const track = (id:string) => { created.push(id); return id; };

  /* ------------------------------------------------------- el caso de uso -- */

  it('Should index a document and record what produced it', async () => {

    const document = await createDocument('index-a', asset('multipage.pdf'), PDF);
    track(document.id);

    await expect(indexDocument({ document: document.id, organization: 'index-a' }, deps())).resolves.toBe('indexed');

    const state = await stateOf(document.id);

    expect(state.index_status).toBe('indexed');
    expect(state.index_model).toBe('test-model');
    expect(state.index_chunks).toBeGreaterThan(0);
    expect(await documentChunkRepository.countByDocument(document.id)).toBe(state.index_chunks);
  });

  it('Should return silently when the document no longer exists', async () => {

    await expect(indexDocument({ document: 'gone', organization: 'index-a' }, deps())).resolves.toBe('skipped');
  });

  it('Should not open a document that is not clean', async () => {

    const document = await createDocument('index-a', asset('multipage.pdf'), PDF);
    track(document.id);

    await sequelize.query("UPDATE pergamo.document SET scan_status = 'malicious' WHERE id = :id;", {
      replacements: { id: document.id }, type: QueryTypes.UPDATE });

    await expect(indexDocument({ document: document.id, organization: 'index-a' }, deps())).resolves.toBe('skipped');
    expect((await stateOf(document.id)).index_status).toBe('none');
    expect(await documentChunkRepository.countByDocument(document.id)).toBe(0);
  });

  it('Should mark a mimetype with no converter as unsupported', async () => {

    const document = await createDocument('index-a', asset('multipage.pdf'), 'image/png');
    track(document.id);

    await expect(indexDocument({ document: document.id, organization: 'index-a' }, deps())).resolves.toBe('unsupported');
    expect((await stateOf(document.id)).index_status).toBe('unsupported');
  });

  it('Should report a missing file instead of an empty index', async () => {

    const document = await createDocument('index-a', null, PDF);
    track(document.id);

    await expect(indexDocument({ document: document.id, organization: 'index-a' }, deps())).resolves.toBe('error');

    const state = await stateOf(document.id);

    expect(state.index_status).toBe('error');
    expect(state.index_error).toBe('FILE_MISSING');
  });

  it('Should report an extraction that produced nothing', async () => {

    const document = await createDocument('index-a', asset('multipage.pdf'), PDF);
    track(document.id);

    // Lo que produce un PDF escaneado sin capa de texto. Marcarlo indexado con
    // cero trozos lo escondería.
    const empty = { ...chunker, split: () => [] };

    await expect(indexDocument({ document: document.id, organization: 'index-a' }, deps({ chunker: empty })))
      .resolves.toBe('error');

    expect((await stateOf(document.id)).index_error).toBe('EMPTY_CONTENT');
  });

  it('Should leave the document pending when the provider is unavailable', async () => {

    const document = await createDocument('index-a', asset('multipage.pdf'), PDF);
    track(document.id);

    await expect(indexDocument({ document: document.id, organization: 'index-a' },
      deps({ embedder: fakeEmbedder({ fail: true }) }))).rejects.toThrow(ProviderUnavailableError);

    // Nunca 'indexed' sin vector: se queda en la cola del proximo barrido.
    expect((await stateOf(document.id)).index_status).toBe('pending');
    expect(await documentChunkRepository.countByDocument(document.id)).toBe(0);
  });

  /**
   * Esta condicion, y no la deduplicacion de la cola, es lo que garantiza que
   * los vectores correspondan al fichero que hay en disco.
   */
  it('Should discard everything when the file is replaced mid-flight', async () => {

    const document = await createDocument('index-a', asset('multipage.pdf'), PDF);
    track(document.id);

    const racing = {
      ...fakeEmbedder(),
      embedDocuments: async (texts:string[]) => {
        // modifyFile entra justo aqui: el hash del documento ya no es el que se
        // convirtio.
        await sequelize.query(
          `UPDATE pergamo.document SET metadata = jsonb_set(metadata, '{hash}', '"otro"')
           WHERE id = :id;`, { replacements: { id: document.id }, type: QueryTypes.UPDATE });
        return texts.map((_, index) => vector(index));
      }
    };

    await expect(indexDocument({ document: document.id, organization: 'index-a' }, deps({ embedder: racing })))
      .resolves.toBe('stale');

    expect((await stateOf(document.id)).index_status).toBe('indexing');
    expect(await documentChunkRepository.countByDocument(document.id)).toBe(0);
  });

  it('Should replace the chunks when a document is indexed again', async () => {

    const document = await createDocument('index-a', asset('multipage.pdf'), PDF);
    track(document.id);

    await indexDocument({ document: document.id, organization: 'index-a' }, deps());
    const first = await documentChunkRepository.countByDocument(document.id);

    await indexDocument({ document: document.id, organization: 'index-a' }, deps());

    expect(await documentChunkRepository.countByDocument(document.id)).toBe(first);
  });

  /* -------------------------------------------------------- el almacen -- */

  it('Should never return chunks from another organization', async () => {

    const mine = await createDocument('index-a', asset('multipage.pdf'), PDF);
    const theirs = await createDocument('index-b', asset('multipage.pdf'), PDF);
    track(mine.id); track(theirs.id);

    await indexDocument({ document: mine.id, organization: 'index-a' }, deps());
    await indexDocument({ document: theirs.id, organization: 'index-b' }, deps());

    // Amplio a proposito: el limite no puede ser lo que oculte una fuga.
    const mineHits = await documentChunkRepository.search({
      organization: 'index-a', embedding: vector(0), text: 'pergamo', candidates: 500, limit: 500 });
    const theirHits = await documentChunkRepository.search({
      organization: 'index-b', embedding: vector(0), text: 'pergamo', candidates: 500, limit: 500 });

    expect(mineHits.some((hit) => hit.document === mine.id)).toBe(true);
    expect(mineHits.some((hit) => hit.document === theirs.id)).toBe(false);

    expect(theirHits.some((hit) => hit.document === theirs.id)).toBe(true);
    expect(theirHits.every((hit) => hit.document === theirs.id)).toBe(true);
  });

  it('Should not return the vector itself', async () => {

    const hits = await documentChunkRepository.search({
      organization: 'index-a', embedding: vector(0), text: 'pergamo', candidates: 10, limit: 1 });

    expect(hits[0]).not.toHaveProperty('embedding');
    expect(Object.keys(hits[0]).sort()).toEqual(
      ['chunk', 'content', 'document', 'headingPath', 'page', 'score', 'section', 'similarity']);
  });

  it('Should take the chunks with the document when it is removed', async () => {

    const document = await createDocument('index-a', asset('multipage.pdf'), PDF);
    track(document.id);

    await indexDocument({ document: document.id, organization: 'index-a' }, deps());
    expect(await documentChunkRepository.countByDocument(document.id)).toBeGreaterThan(0);

    await documentRepository.remove('index-a', document.id);

    expect(await documentChunkRepository.countByDocument(document.id)).toBe(0);
  });
});
