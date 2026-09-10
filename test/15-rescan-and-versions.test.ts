import axios from 'axios';
import path from 'path';
import fs from 'fs';
import FormData from 'form-data';
import { StatusCodes } from 'http-status-codes';

import { app } from '@/server';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import Config from '@/shared/config';
import { documentStorage } from '@/infrastructure/files/document-storage';

/**
 * Reanalisis bajo demanda y descarga de una version archivada.
 *
 * El reanalisis hereda la politica del barrido: no toca 'malicious', porque esa
 * cuarentena es por lo que el fichero lleva dentro y un escaner lo encontraria
 * limpio. El estado se fuerza por base de datos en vez de tumbar clamd: lo que
 * se comprueba es la puerta, no el motor.
 */
describe('Rescan and archived versions', () => {

  const OTHER_ORGANIZATION = 'test-rescan';
  const OTHER_PASSWORD = 'Rescan0123#';

  let api;
  let server;
  let token;
  let tokenOther;
  let otherId;
  let documentId;

  const setStatus = async (status:string, signature:string|null = null) =>
    sequelize.query(
      'UPDATE pergamo.document SET scan_status = :status, scan_signature = :signature WHERE id = :id;', {
      replacements: { id: documentId, status, signature },
      type: QueryTypes.UPDATE
    });

  const storedPath = async () => {

    const rows:any = await sequelize.query(
      'SELECT organization, path FROM pergamo.document WHERE id = :id;', {
      replacements: { id: documentId },
      type: QueryTypes.SELECT
    });

    return documentStorage.resolve(rows[0].organization, rows[0].path);
  };

  beforeAll(async () => {

    server = await app(0);

    api = axios.create({
      baseURL: `http://localhost:${server.address().port}`,
      validateStatus: () => true
    });

    let response = await api.post('/organization/login', {
      name: 'pergamo',
      password: Config.password_master
    });
    token = response.data.token;

    response = await api.post('/organization/login', {
      name: Config.user_master,
      password: Config.password_master
    });
    const tokenMaster = response.data.token;

    response = await api.post('/organization/master/create', {
      name: OTHER_ORGANIZATION,
      password: OTHER_PASSWORD
    }, { headers: { authorization: tokenMaster } });
    otherId = response.data.id;

    response = await api.post('/organization/login', {
      name: OTHER_ORGANIZATION,
      password: OTHER_PASSWORD
    });
    tokenOther = response.data.token;

    const form = new FormData();
    form.append('document', fs.createReadStream(path.join(__dirname, 'assets', 'test.pdf')));

    response = await api.post('/document', form, {
      headers: { authorization: token, ...form.getHeaders() }
    });

    documentId = response.data.uuid;
  });

  afterAll(async () => {

    if(documentId) {
      await api.delete(`/document/${documentId}`, { headers: { authorization: token } });
    }

    if(otherId) {
      await sequelize.query('DELETE FROM pergamo.organization WHERE id = :id;', {
        replacements: { id: otherId },
        type: QueryTypes.DELETE
      });
    }

    server.close();
    await sequelize.close();
  });

  it('Should give a verdict to a document that had none', async () => {

    await setStatus('pending');

    const response = await api.post(`/document/${documentId}/scan`, null, {
      headers: { authorization: token }
    });

    if(!Config.enable_antivirus) {
      // Sin motor no hay reanalisis que ofrecer, y el estado guardado no se toca.
      expect(response.status).toBe(StatusCodes.BAD_REQUEST);
      return;
    }

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.scan_status).toBe('clean');
    // El motor queda registrado: es lo que separa un analisis de un documento
    // guardado sin que nadie lo mirara.
    expect(response.data.scan_engine).toBeTruthy();
    expect(response.data.scan_date).toBeTruthy();
  });

  it('Should refuse to rescan a document quarantined for active content', async () => {

    await setStatus('malicious', 'ACTIVE_CONTENT:javascript');

    const response = await api.post(`/document/${documentId}/scan`, null, {
      headers: { authorization: token }
    });

    if(!Config.enable_antivirus) {
      expect(response.status).toBe(StatusCodes.BAD_REQUEST);
    } else {
      // Liberarlo en lote es justo lo que esta cuarentena no permite: sale a
      // mano, por `npm run scan:release`.
      expect(response.status).toBe(StatusCodes.LOCKED);
      expect(response.data.error).toContain('manual review');
    }

    const rows:any = await sequelize.query(
      'SELECT scan_status FROM pergamo.document WHERE id = :id;', {
      replacements: { id: documentId },
      type: QueryTypes.SELECT
    });

    expect(rows[0].scan_status).toBe('malicious');
  });

  it('Should record a missing file as an error and not as a clean verdict', async () => {

    if(!Config.enable_antivirus) return;

    await setStatus('clean');

    const filePath = await storedPath();
    const backup = `${filePath}.backup`;

    await fs.promises.rename(filePath, backup);

    try {

      const response = await api.post(`/document/${documentId}/scan`, null, {
        headers: { authorization: token }
      });

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.data.scan_status).toBe('error');
      expect(response.data.scan_signature).toBe('FILE_MISSING');

    } finally {
      await fs.promises.rename(backup, filePath);
    }
  });

  it('Should not let one organization rescan another\'s document', async () => {

    const response = await api.post(`/document/${documentId}/scan`, null, {
      headers: { authorization: tokenOther }
    });

    // La propiedad se comprueba antes que nada: el 404 es el mismo que recibiria
    // por un identificador inventado.
    expect(response.status).toBe(StatusCodes.NOT_FOUND);
  });

  it('Should serve an archived version once the file has been replaced', async () => {

    await setStatus('clean');

    const form = new FormData();
    form.append('document', fs.createReadStream(path.join(__dirname, 'assets', 'test2.pdf')));

    const replaced = await api.put(`/document/${documentId}/file`, form, {
      headers: { authorization: token, ...form.getHeaders() }
    });

    expect(replaced.status).toBe(StatusCodes.OK);

    const versions = await api.get(`/document/${documentId}/versions`, {
      headers: { authorization: token }
    });

    expect(versions.data.length).toBeGreaterThan(0);

    // Se entrega el ZIP tal cual lo dejo el archivador, no el fichero original.
    const response = await api.get(`/document/${documentId}/versions/1/file`, {
      headers: { authorization: token },
      responseType: 'arraybuffer'
    });

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.headers['content-type']).toContain('application/zip');
    expect(Buffer.from(response.data).subarray(0, 2).toString()).toBe('PK');
  });

  it('Should answer 404 for a version that was never archived', async () => {

    const response = await api.get(`/document/${documentId}/versions/99/file`, {
      headers: { authorization: token }
    });

    expect(response.status).toBe(StatusCodes.NOT_FOUND);
  });

  it('Should reject a version number that is not one', async () => {

    const response = await api.get(`/document/${documentId}/versions/0/file`, {
      headers: { authorization: token }
    });

    expect(response.status).toBe(StatusCodes.BAD_REQUEST);
  });

  it('Should withhold an archived version while the document is quarantined', async () => {

    await setStatus('infected', 'Test.Signature-1');

    const response = await api.get(`/document/${documentId}/versions/1/file`, {
      headers: { authorization: token }
    });

    // El archivo es el mismo contenido una copia atras: retener el fichero
    // actual y entregar el anterior no retendria nada.
    expect(response.status).toBe(StatusCodes.LOCKED);

    await setStatus('clean');
  });

  it('Should not let one organization download another\'s archived version', async () => {

    const response = await api.get(`/document/${documentId}/versions/1/file`, {
      headers: { authorization: tokenOther }
    });

    expect(response.status).toBe(StatusCodes.NOT_FOUND);
  });
});
