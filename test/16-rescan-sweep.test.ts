import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { StatusCodes } from 'http-status-codes';

import { app } from '@/server';
import Config from '@/shared/config';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { rescanQueue } from '@/infrastructure/queue/rescan.queue';
import { RESCAN_QUEUE_NAME } from '@/infrastructure/queue/connection';

/**
 * Barrido de los documentos sin veredicto.
 *
 * Necesita un Redis alcanzable, como la bateria de la cola de indexacion, y usa
 * su mismo prefijo de prueba para no tocar las claves de nadie.
 *
 * Lo que se fija aqui es el control de unicidad: dos peticiones seguidas no
 * pueden dejar dos barridos recorriendo el mismo corpus. El trabajo NO se
 * consume —no se levanta worker—, de modo que la comprobacion es sobre la cola
 * y no sobre lo que tarde clamd.
 */
const PREFIX = 'pergamo-test';

describe('Rescan sweep', () => {

  let api;
  let server;
  let token:string;
  let queue:Queue;
  let redis:Redis;
  let documentId:string;

  beforeAll(async () => {

    Config.queue.prefix = PREFIX;

    server = await app(0);

    api = axios.create({
      baseURL: `http://localhost:${server.address().port}`,
      validateStatus: () => true
    });

    const login = await api.post('/organization/login', {
      name: 'pergamo',
      password: Config.password_master
    });
    token = login.data.token;

    redis = new Redis(Config.queue.redis_url, { maxRetriesPerRequest: null });
    queue = new Queue(RESCAN_QUEUE_NAME, { connection: redis, prefix: PREFIX });

    await queue.obliterate({ force: true });

    const form = new FormData();
    form.append('document', fs.createReadStream(path.join(__dirname, 'assets', 'test.pdf')));

    const upload = await api.post('/document', form, {
      headers: { authorization: token, ...form.getHeaders() }
    });

    documentId = upload.data.uuid;

    // Sin veredicto, que es lo que un barrido resuelve.
    await sequelize.query(
      "UPDATE pergamo.document SET scan_status = 'pending' WHERE id = :id;", {
      replacements: { id: documentId },
      type: QueryTypes.UPDATE
    });
  });

  afterAll(async () => {

    if(documentId) {
      await api.delete(`/document/${documentId}`, { headers: { authorization: token } });
    }

    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
    await redis.quit().catch(() => redis.disconnect());
    await rescanQueue.close().catch(() => {});

    server.close();
    await sequelize.close();
  });

  it('Should report no sweep before anything is asked for', async () => {

    const response = await api.get('/document/rescan', { headers: { authorization: token } });

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.status).toBe('idle');
    // Y lo que queda por analizar, que es lo que decide si hay algo que ofrecer.
    expect(response.data.pending).toBeGreaterThan(0);
  });

  it('Should leave out of the count what the scanner cannot read', async () => {

    const before = await api.get('/document/rescan', { headers: { authorization: token } });

    // Pasado el tope del escaner deja de ser trabajo pendiente: ningun analisis
    // le va a dar veredicto, asi que un barrido no lo cuenta ni lo mira.
    await sequelize.query(
      `UPDATE pergamo.document
      SET metadata = jsonb_set(metadata, '{size}', to_jsonb(:size::bigint))
      WHERE id = :id;`, {
      replacements: { id: documentId, size: Config.max_file_size + 1 },
      type: QueryTypes.UPDATE
    });

    const after = await api.get('/document/rescan', { headers: { authorization: token } });

    expect(after.data.pending).toBe(before.data.pending - 1);

    await sequelize.query(
      `UPDATE pergamo.document
      SET metadata = jsonb_set(metadata, '{size}', to_jsonb(:size::bigint))
      WHERE id = :id;`, {
      replacements: { id: documentId, size: 13536 },
      type: QueryTypes.UPDATE
    });
  });

  it('Should queue a sweep of the pending documents', async () => {

    const response = await api.post('/document/rescan', null, { headers: { authorization: token } });

    if(!Config.enable_antivirus) {
      // Sin motor no hay barrido que ofrecer.
      expect(response.status).toBe(StatusCodes.BAD_REQUEST);
      expect(response.data.code).toBe('ANTIVIRUS_DISABLED');
      return;
    }

    expect(response.status).toBe(StatusCodes.ACCEPTED);
    expect(['queued', 'running']).toContain(response.data.status);

    expect(await queue.getJobCountByTypes('waiting', 'active')).toBe(1);
  });

  it('Should not queue a second sweep while one is alive', async () => {

    if(!Config.enable_antivirus) return;

    const first = await api.post('/document/rescan', null, { headers: { authorization: token } });
    const second = await api.post('/document/rescan', null, { headers: { authorization: token } });

    expect(first.status).toBe(StatusCodes.ACCEPTED);
    expect(second.status).toBe(StatusCodes.ACCEPTED);

    // Pedirlo dos veces no es un error: devuelve el que ya estaba.
    expect(await queue.getJobCountByTypes('waiting', 'active')).toBe(1);
  });

  it('Should keep one organization out of another\'s sweep', async () => {

    if(!Config.enable_antivirus) return;

    // El identificador del trabajo lleva la organizacion: el barrido de una no
    // puede recorrer el corpus de otra ni aparecer en su pantalla.
    const job = await queue.getJob('sweep-pending-documents--pergamo');

    expect(job).toBeTruthy();
    expect(job.data.organization).toBe('pergamo');
  });
});
