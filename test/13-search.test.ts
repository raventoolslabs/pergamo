import axios from 'axios';
import http from 'http';

import { app } from '@/server';
import Config from '@/shared/config';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { documentChunkRepository } from '@/infrastructure/db/repositories/document-chunk.repository';
import { indexQueue } from '@/infrastructure/queue/index.queue';
import { searchDocuments } from '@/app/use-cases/search/queries/search-documents.handler';
import { EmbeddingProvider } from '@/app/ports/services/embedding-provider.service';

const DIMENSION = Config.indexing.embedding.dimension;
const OTHER = 'search-other';

const vector = (seed:number) => {
  const values = new Array(DIMENSION).fill(0);
  values[Math.abs(seed) % DIMENSION] = 1;
  return values;
};

/**
 * Cada texto se convierte en el vector de su primera palabra, de modo que la
 * mitad densa es predecible sin maquina de inferencia.
 */
const seedOf = (text:string) => text.trim().split(/\s+/)[0].length;

/**
 * Servidor de embeddings compatible con OpenAI, no un doble del puerto: asi la
 * busqueda por HTTP ejercita el cliente de verdad —cabeceras, lotes y el
 * parametro `dimensions`— y no solo el caso de uso.
 */
const startProvider = () => new Promise<{ server:http.Server; requests:any[] }>((resolve) => {

  const requests:any[] = [];

  const server = http.createServer((req, res) => {

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {

      const payload = JSON.parse(body);
      requests.push({ url: req.url, authorization: req.headers.authorization, ...payload });

      const input:string[] = Array.isArray(payload.input) ? payload.input : [payload.input];

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        data: input.map((text, index) => ({
          index,
          embedding: vector(seedOf(text)).slice(0, payload.dimensions ?? DIMENSION)
        }))
      }));
    });
  });

  server.listen(0, '127.0.0.1', () => resolve({ server, requests }));
});

const fakeEmbedder:EmbeddingProvider = {
  provider: 'test',
  model: 'test-model',
  dimension: DIMENSION,
  distance: 'cosine',
  init: async () => {},
  embedQuery: async (text) => vector(seedOf(text)),
  embedDocuments: async (texts) => texts.map((text) => vector(seedOf(text)))
};

const deps = { chunks: documentChunkRepository, embedder: fakeEmbedder };

describe('Document search', () => {

  let api;
  let server;
  let token:string;
  let otherToken:string;
  let masterToken:string;
  let mine:string;
  let theirs:string;
  let provider:http.Server;
  let providerRequests:any[];

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

    await documentChunkRepository.replace(id, organization, contents.map((content, position) => ({
      position,
      content,
      headingPath: ['Seccion'],
      section: 'Seccion',
      contentType: 'text' as const,
      page: position + 1,
      embedding: vector(seedOf(content))
    })));

    return id;
  };

  beforeAll(async () => {

    const started = await startProvider();
    provider = started.server;
    providerRequests = started.requests;

    Config.indexing.embedding.base_url =
      `http://127.0.0.1:${(provider.address() as any).port}/v1`;
    Config.indexing.embedding.api_key = 'test-key';

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

    mine = await seedDocument('pergamo', [
      'El presupuesto aprobado para el ejercicio asciende a 42000 euros.',
      'Las condiciones de entrega se pactan por escrito.'
    ]);

    theirs = await seedDocument(OTHER, [
      'El presupuesto aprobado para el ejercicio asciende a 99999 euros.',
      'Documento confidencial de la otra organizacion.'
    ]);

    Config.indexing.enabled = true;
  });

  afterAll(async () => {
    await sequelize.query('DELETE FROM pergamo.document WHERE id IN (:ids);', {
      replacements: { ids: [mine, theirs] }, type: QueryTypes.DELETE });
    await sequelize.query('DELETE FROM pergamo.organization WHERE id = :id;', {
      replacements: { id: OTHER }, type: QueryTypes.DELETE });
    await indexQueue.close();
    server.close();
    provider.close();
    await sequelize.close();
  });

  const search = (body:any, authorization = token) =>
    api.post('/search', body, { headers: { authorization } });

  /* ---------------------------------------------------------- proveedor -- */

  it('Should ask the provider for the width the index has', async () => {

    await search({ query: 'presupuesto', limit: 1 });

    const last = providerRequests[providerRequests.length - 1];

    // El parametro que permite que un modelo de otra anchura nativa —los
    // text-embedding-3 de OpenAI son 1536— entregue vectores del tamano de la
    // columna, sin una version nueva del indice por cambiar de proveedor.
    expect(last.dimensions).toBe(DIMENSION);
    expect(last.url).toBe('/v1/embeddings');
    expect(last.authorization).toBe('Bearer test-key');
    expect(last.input).toEqual(['presupuesto']);
  });

  /* -------------------------------------------------------- aislamiento -- */

  /**
   * El criterio que no se comprueba leyendo codigo. Los dos fondos contienen
   * casi la misma frase a proposito: si el filtro faltara, la consulta traeria
   * el trozo ajeno por delante de la mitad del propio.
   */
  it('Should never return a chunk from another organization', async () => {

    const response = await search({ query: 'presupuesto aprobado ejercicio', limit: 50 });

    expect(response.status).toBe(200);
    expect(response.data.results.length).toBeGreaterThan(0);
    expect(response.data.results.every((hit:any) => hit.document_id === mine)).toBe(true);

    const theirResponse = await search({ query: 'presupuesto aprobado ejercicio', limit: 50 }, otherToken);

    expect(theirResponse.data.results.every((hit:any) => hit.document_id === theirs)).toBe(true);
  });

  /**
   * Lo retenido se descarta al final de la consulta, no dentro de las dos
   * mitades: un documento que un reescaneo pasa a 'infected' deja de salir sin
   * que haya que reindexar ni borrar sus trozos.
   */
  it('Should never return a chunk of a quarantined document', async () => {

    const withheld = await seedDocument('pergamo', [
      'El presupuesto aprobado para el ejercicio asciende a 42000 euros.'
    ]);

    const query = { query: 'presupuesto aprobado ejercicio', limit: 50 };
    const found = (response:any) => response.data.results.some((hit:any) => hit.document_id === withheld);

    expect(found(await search(query))).toBe(true);

    for(const status of ['infected', 'malicious', 'error']) {

      await sequelize.query('UPDATE pergamo.document SET scan_status = :status WHERE id = :id;', {
        replacements: { id: withheld, status }, type: QueryTypes.UPDATE });

      const response = await search(query);

      expect(response.status).toBe(200);
      expect(found(response)).toBe(false);
    }

    await sequelize.query('DELETE FROM pergamo.document WHERE id = :id;', {
      replacements: { id: withheld }, type: QueryTypes.DELETE });
  });

  it('Should refuse a master token, which has no organization', async () => {

    const response = await search({ query: 'presupuesto' }, masterToken);

    expect(response.status).toBe(400);
    expect(response.data.error).toContain('master token has no organization');
  });

  it('Should refuse an unauthenticated search', async () => {

    const response = await api.post('/search', { query: 'presupuesto' });

    expect(response.status).toBe(401);
  });

  /* ---------------------------------------------------------- respuesta -- */

  it('Should never return the vector', async () => {

    const response = await search({ query: 'presupuesto', limit: 1 });

    expect(response.data.results[0]).not.toHaveProperty('embedding');
    expect(Object.keys(response.data.results[0]).sort()).toEqual([
      'chunk_id', 'content', 'document_id', 'heading_path', 'page', 'score', 'section', 'similarity'
    ]);
  });

  it('Should return the provenance of each fragment', async () => {

    const [hit] = (await search({ query: 'presupuesto', limit: 1 })).data.results;

    expect(hit.document_id).toBe(mine);
    expect(hit.section).toBe('Seccion');
    expect(hit.heading_path).toEqual(['Seccion']);
    expect(typeof hit.page).toBe('number');
    expect(typeof hit.similarity).toBe('number');
  });

  /* ------------------------------------------------------------ consulta -- */

  it('Should find a number the dense half would miss', async () => {

    // La mitad lexica ganandose el sitio: 42000 no significa nada para un
    // modelo de embeddings, y para ts_rank_cd es un termino exacto.
    const response = await search({ query: '42000', limit: 5 });

    expect(response.data.results.some((hit:any) => hit.content.includes('42000'))).toBe(true);
  });

  it('Should honour the requested limit', async () => {

    const response = await search({ query: 'presupuesto entrega', limit: 1 });

    expect(response.data.results).toHaveLength(1);
    expect(response.data.limit).toBe(1);
  });

  it('Should apply a similarity threshold', async () => {

    // Sin umbral un fondo sin nada relevante devuelve igualmente los trozos
    // menos malos, y quien pregunte los tomara por buenos.
    const loose = await search({ query: 'presupuesto', limit: 50 });
    const strict = await search({ query: 'presupuesto', limit: 50, min_similarity: 0.999 });

    expect(strict.data.results.length).toBeLessThan(loose.data.results.length);
    strict.data.results.forEach((hit:any) => expect(hit.similarity).toBeGreaterThanOrEqual(0.999));
  });

  it('Should reject a malformed body instead of guessing', async () => {

    for(const body of [{}, { query: '' }, { query: 'x', limit: 0 }, { query: 'x', limit: 500 },
                       { query: 'x', unexpected: true }]) {
      expect((await search(body)).status).toBe(400);
    }
  });

  /* ------------------------------------------------ con la indexacion off -- */

  it('Should say so when the deployment does not index', async () => {

    Config.indexing.enabled = false;

    try {
      await expect(searchDocuments({ organization: 'pergamo', query: 'presupuesto', limit: 5 }, deps))
        .rejects.toThrow(/does not index/);
    } finally {
      Config.indexing.enabled = true;
    }
  });
});
