import axios from 'axios';

import { app } from '@/server';
import Config from '@/shared/config';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { documentChunkRepository } from '@/infrastructure/db/repositories/document-chunk.repository';
import { indexQueue } from '@/infrastructure/queue/index.queue';

const DIMENSION = Config.indexing.embedding.dimension;
const OTHER = 'chunks-other';

// Las claves exactas del contrato. Se compara el conjunto entero y no solo la
// ausencia de 'embedding': una clave nueva que se cuele tiene que romper esto.
const CHUNK_KEYS = [
  'chunk_id', 'position', 'content', 'page', 'section', 'heading_path', 'content_type', 'length'
];

const vector = (seed:number) => {
  const values = new Array(DIMENSION).fill(0);
  values[Math.abs(seed) % DIMENSION] = 1;
  return values;
};

describe('Document chunks', () => {

  let api;
  let server;
  let token:string;
  let otherToken:string;
  let masterToken:string;
  let mine:string;
  let theirs:string;
  let empty:string;

  const seedDocument = async (organization:string, contents:string[]) => {

    const rows:any = await sequelize.query(
      `INSERT INTO pergamo.document(metadata, organization, scan_status)
       VALUES (:metadata::jsonb, :organization, 'clean') RETURNING id;`, {
      replacements: {
        organization,
        metadata: JSON.stringify({ name: 'p', extension: 'pdf', mimetype: 'application/pdf', hash: 'h', tags: [] })
      },
      type: QueryTypes.SELECT });

    const id = rows[0].id;

    if(contents.length) await documentChunkRepository.replace(id, organization,
      contents.map((content, position) => ({
        position,
        content,
        headingPath: ['Guia', `Seccion ${position}`],
        section: `Seccion ${position}`,
        contentType: 'text' as const,
        page: position + 1,
        embedding: vector(position)
      })));

    return id;
  };

  beforeAll(async () => {

    server = await app(0);

    api = axios.create({
      baseURL: `http://localhost:${server.address().port}`,
      validateStatus: () => true
    });

    token = (await api.post('/organization/login',
      { name: 'pergamo', password: Config.password_master })).data.token;

    masterToken = (await api.post('/organization/login',
      { name: Config.user_master, password: Config.password_master })).data.token;

    await sequelize.query(
      `INSERT INTO pergamo.organization(id, name, password)
       VALUES (:id, :id, crypt('Pergamo0123#', gen_salt('bf'))) ON CONFLICT (id) DO NOTHING;`, {
      replacements: { id: OTHER }, type: QueryTypes.INSERT });

    otherToken = (await api.post('/organization/login',
      { name: OTHER, password: 'Pergamo0123#' })).data.token;

    mine = await seedDocument('pergamo',
      ['Primero de todos.', 'Segundo.', 'Tercero.', 'Cuarto y ultimo.']);

    theirs = await seedDocument(OTHER, ['Documento confidencial de la otra organizacion.']);

    empty = await seedDocument('pergamo', []);
  });

  afterAll(async () => {
    await sequelize.query('DELETE FROM pergamo.document WHERE id IN (:ids);', {
      replacements: { ids: [mine, theirs, empty] }, type: QueryTypes.DELETE });
    await sequelize.query('DELETE FROM pergamo.organization WHERE id = :id;', {
      replacements: { id: OTHER }, type: QueryTypes.DELETE });
    await indexQueue.close();
    server.close();
    await sequelize.close();
  });

  const chunks = (id:string, query = '', authorization = token) =>
    api.get(`/document/${id}/chunks${query}`, { headers: { authorization } });

  /* ------------------------------------------------------------ lectura -- */

  it('Should return the chunks of a document in order', async () => {

    const response = await chunks(mine);

    expect(response.status).toBe(200);
    expect(response.data.total).toBe(4);
    expect(response.data.chunks.map((chunk:any) => chunk.position)).toEqual([0, 1, 2, 3]);
    expect(response.data.chunks[0].content).toBe('Primero de todos.');
    expect(response.data.chunks[0].heading_path).toEqual(['Guia', 'Seccion 0']);
    expect(response.data.chunks[0].page).toBe(1);
    expect(response.data.chunks[0].length).toBe('Primero de todos.'.length);
  });

  /**
   * El vector es parcialmente reversible y hereda la confidencialidad del
   * documento. Se comprueba el conjunto exacto de claves y no solo que falte
   * 'embedding', para que anadir una columna al SELECT no pase inadvertido.
   */
  it('Should never expose the embedding', async () => {

    const response = await chunks(mine);

    response.data.chunks.forEach((chunk:any) => {
      expect(Object.keys(chunk).sort()).toEqual([...CHUNK_KEYS].sort());
    });

    expect(JSON.stringify(response.data)).not.toContain('embedding');
  });

  it('Should paginate', async () => {

    const first = await chunks(mine, '?limit=2');

    expect(first.data.total).toBe(4);
    expect(first.data.limit).toBe(2);
    expect(first.data.offset).toBe(0);
    expect(first.data.chunks.map((chunk:any) => chunk.position)).toEqual([0, 1]);

    const second = await chunks(mine, '?limit=2&offset=2');

    expect(second.data.chunks.map((chunk:any) => chunk.position)).toEqual([2, 3]);
  });

  it('Should answer a document with no chunks with an empty page', async () => {

    const response = await chunks(empty);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ total: 0, limit: 8, offset: 0, chunks: [] });
  });

  /* -------------------------------------------------------- aislamiento -- */

  /**
   * El criterio que no se comprueba leyendo codigo: con el identificador ajeno
   * en la mano, la respuesta tiene que ser 404 y no el contenido.
   */
  it('Should not return chunks of another organization', async () => {

    const response = await chunks(theirs);

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.data)).not.toContain('confidencial');

    // Y al reves, para que no pase por casualidad.
    const owner = await chunks(theirs, '', otherToken);

    expect(owner.status).toBe(200);
    expect(owner.data.chunks[0].content).toContain('confidencial');
  });

  it('Should reject a master token, which has no organization', async () => {

    const response = await chunks(mine, '', masterToken);

    expect(response.status).toBe(400);
  });

  it('Should reject an unauthenticated request', async () => {

    const response = await api.get(`/document/${mine}/chunks`);

    expect(response.status).toBe(401);
  });

  /* -------------------------------------------------------- validacion -- */

  it('Should answer 404 for a document that does not exist', async () => {

    const response = await chunks('4eb817b4-aeac-442c-9b42-0e99ad82a605');

    expect(response.status).toBe(404);
  });

  it('Should reject a misspelled or out-of-range query parameter', async () => {

    // .strict(): un parametro mal escrito es un 400 y no una peticion que se
    // atiende ignorando lo que se pidio.
    expect((await chunks(mine, '?limitt=2')).status).toBe(400);
    expect((await chunks(mine, '?limit=0')).status).toBe(400);
    expect((await chunks(mine, '?limit=500')).status).toBe(400);
    expect((await chunks(mine, '?offset=-1')).status).toBe(400);
  });

});
