import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

import { app } from '@/server';
import Config from '@/shared/config';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { indexQueue } from '@/infrastructure/queue/index.queue';
import { JOB_NAME, QUEUE_NAME } from '@/infrastructure/queue/connection';

/**
 * Necesita un Redis alcanzable, igual que el resto de la bateria necesita una
 * PostgreSQL: el prefijo mantiene estas claves separadas de las de cualquier
 * otra cosa que viva en la misma instancia.
 */
const PREFIX = 'pergamo-test';

const asset = (name:string) => path.join(__dirname, 'assets', name);

describe('Indexing queue', () => {

  let api;
  let server;
  let token:string;
  let queue:Queue;
  let redis:Redis;

  const upload = (query = '', file = 'multipage.pdf', mimetype = 'application/pdf') => {

    const form = new FormData();
    form.append('document', fs.createReadStream(asset(file)), { contentType: mimetype });

    return api.post(`/document${query}`, form, {
      headers: { 'authorization': token, ...form.getHeaders() }
    });
  };

  const indexStatusOf = async (id:string) => {
    const rows:any = await sequelize.query(
      'SELECT index_status FROM pergamo.document WHERE id = :id;', {
      replacements: { id }, type: QueryTypes.SELECT });
    return rows[0]?.index_status;
  };

  const remove = (id:string) => api.delete(`/document/${id}`, { headers: { authorization: token } });

  /**
   * El encolado ocurre despues del commit y NO se espera: Redis caido no puede
   * tumbar un deposito ya confirmado. Aqui hay que darle ese margen.
   */
  const waitForJob = async (id:string) => {
    for(let attempt = 0; attempt < 40; attempt++) {
      const job = await queue.getJob(id);
      if(job) return job;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return undefined;
  };

  beforeAll(async () => {

    // Arranca con la indexacion desactivada, que es el defecto, para que el
    // worker embebido no llegue a existir: aqui no hay maquina de inferencia.
    server = await app(0);

    api = axios.create({
      baseURL: `http://localhost:${server.address().port}`,
      validateStatus: () => true
    });

    const response = await api.post('/organization/login', {
      name: 'pergamo',
      password: Config.password_master
    });

    token = response.data.token;

    Config.indexing.queue_prefix = PREFIX;

    redis = new Redis(Config.indexing.redis_url, { maxRetriesPerRequest: null });
    queue = new Queue(QUEUE_NAME, { connection: redis, prefix: PREFIX });

    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
    await redis.quit();
    await indexQueue.close();
    server.close();
    await sequelize.close();
  });

  /* ------------------------------------------ con la indexacion apagada -- */

  it('Should refuse to index when the deployment does not', async () => {

    Config.indexing.enabled = false;

    const response = await upload('?index=true');

    // 400 y no silencio: el cliente no debe creer que tiene vectores.
    expect(response.status).toBe(400);
    expect(response.data.error).toContain('does not index');
  });

  it('Should still accept an upload that does not ask for indexing', async () => {

    Config.indexing.enabled = false;

    const response = await upload();

    expect(response.status).toBe(200);
    expect(await indexStatusOf(response.data.uuid)).toBe('none');

    await remove(response.data.uuid);
  });

  it('Should reject an unknown query parameter instead of ignoring it', async () => {

    // El motivo de .strict(): '?indexx=true' pediria indexar y no lo obtendria.
    const response = await upload('?indexx=true');

    expect(response.status).toBe(400);
  });

  /* ----------------------------------------- con la indexacion encendida -- */

  it('Should queue a document that asks for it', async () => {

    Config.indexing.enabled = true;

    const response = await upload('?index=true');

    expect(response.status).toBe(200);
    expect(await indexStatusOf(response.data.uuid)).toBe('pending');

    const job = await waitForJob(response.data.uuid);

    expect(job).toBeDefined();
    expect(job.name).toBe(JOB_NAME);
    // Nada mas que los dos identificadores: un trabajo puede pasar horas en la
    // cola y todo lo demas se relee de la base.
    expect(job.data).toEqual({ document: response.data.uuid, organization: 'pergamo' });

    await remove(response.data.uuid);
  });

  /**
   * La otra mitad de la regla. Indexar convierte el fichero, es decir lo abre
   * con un parser, y eso es exactamente lo que un documento en cuarentena no
   * puede provocar: se guarda, pero nadie lo toca.
   */
  it('Should not queue a quarantined deposit even when indexing was asked for', async () => {

    Config.indexing.enabled = true;

    // Contenido activo: la subida entra y queda en cuarentena por si sola, sin
    // necesidad de un ClamAV con firmas reales.
    const response = await upload('?index=true', 'payloads/payload1.pdf');

    expect(response.status).toBe(200);

    const stored:any = await sequelize.query(
      'SELECT scan_status FROM pergamo.document WHERE id = :id;', {
      replacements: { id: response.data.uuid }, type: QueryTypes.SELECT });

    expect(stored[0].scan_status).toBe('malicious');
    expect(await indexStatusOf(response.data.uuid)).toBe('none');
    expect(await queue.getJob(response.data.uuid)).toBeUndefined();

    await remove(response.data.uuid);
  });

  it('Should not queue a document that did not ask for it', async () => {

    Config.indexing.enabled = true;

    const response = await upload();

    expect(await indexStatusOf(response.data.uuid)).toBe('none');
    expect(await queue.getJob(response.data.uuid)).toBeUndefined();

    await remove(response.data.uuid);
  });

  it('Should keep one job per document', async () => {

    Config.indexing.enabled = true;

    const response = await upload('?index=true');
    const id = response.data.uuid;

    await waitForJob(id);
    await indexQueue.enqueue(id, 'pergamo');
    await indexQueue.enqueue(id, 'pergamo');

    const waiting = await queue.getJobs(['waiting', 'delayed', 'active']);

    expect(waiting.filter((job) => job.id === id)).toHaveLength(1);

    await remove(id);
  });

  it('Should send a replaced file back to the queue and drop its chunks', async () => {

    Config.indexing.enabled = true;

    const response = await upload('?index=true');
    const id = response.data.uuid;

    // Como si el worker ya hubiera terminado.
    await sequelize.query(
      `UPDATE pergamo.document SET index_status = 'indexed', index_chunks = 1 WHERE id = :id;`, {
      replacements: { id }, type: QueryTypes.UPDATE });
    await queue.obliterate({ force: true });

    const form = new FormData();
    form.append('document', fs.createReadStream(asset('multipage.pdf')), { contentType: 'application/pdf' });

    const replaced = await api.put(`/document/${id}/file`, form, {
      headers: { authorization: token, ...form.getHeaders() }
    });

    expect(replaced.status).toBe(200);
    // Reemplazar el fichero no puede desindexar por omision, y tampoco dejar
    // buscables los vectores de un contenido que ya no esta.
    expect(await indexStatusOf(id)).toBe('pending');
    expect(await waitForJob(id)).toBeDefined();

    await remove(id);
  });

  it('Should serve the index state on its own endpoint', async () => {

    Config.indexing.enabled = true;

    const response = await upload('?index=true');
    const id = response.data.uuid;

    await waitForJob(id);

    const info = await api.get(`/document/${id}/index`, { headers: { authorization: token } });

    expect(info.status).toBe(200);
    expect(info.data).toMatchObject({ index_status: 'pending' });
    expect(info.data).toHaveProperty('index_model');
    expect(info.data).toHaveProperty('index_error');

    await remove(id);
  });

  it('Should announce whether the deployment indexes', async () => {

    Config.indexing.enabled = true;

    const response = await api.get('/config', { headers: { authorization: token } });

    expect(response.data.indexing_enabled).toBe(true);
  });
});
