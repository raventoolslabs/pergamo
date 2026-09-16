import axios from 'axios';
import path from 'path';
import fs from 'fs';
import FormData from 'form-data';
import { StatusCodes } from 'http-status-codes';

import { app } from '@/server';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import Config from '@/shared/config';
import { documentRepository } from '@/infrastructure/db/repositories/document.repository';

/**
 * Un documento dado de baja no existe para la API: ni se lee, ni se modifica,
 * ni se borra, ni se lista. La baja se fuerza por SQL porque lo que se prueba
 * es el repositorio, no la sincronizacion que la provoca.
 */
describe('Discharged documents', () => {

  let api;
  let server;
  let token;
  let documentId;

  const auth = () => ({ headers: { authorization: token } });

  const setDischarge = async (discharged:boolean) =>
    sequelize.query(
      `UPDATE pergamo.document SET discharge_date = ${discharged ? 'CURRENT_TIMESTAMP' : 'NULL'} WHERE id = :id;`, {
      replacements: { id: documentId },
      type: QueryTypes.UPDATE
    });

  const upload = () => {
    const form = new FormData();
    form.append('document', fs.createReadStream(path.join(__dirname, 'assets', 'test.pdf')));
    return form;
  };

  beforeAll(async () => {

    server = await app(0);

    api = axios.create({
      baseURL: `http://localhost:${server.address().port}`,
      validateStatus: () => true
    });

    const login = await api.post('/api/organization/login', {
      name: 'pergamo',
      password: Config.password_master
    });
    token = login.data.token;

    const form = upload();
    const response = await api.post('/api/document', form, {
      headers: { authorization: token, ...form.getHeaders() }
    });
    documentId = response.data.uuid;

    await setDischarge(true);
  });

  afterAll(async () => {

    if(documentId) {
      await setDischarge(false);
      await api.delete(`/api/document/${documentId}`, auth());
    }

    server.close();
    await sequelize.close();
  });

  it('Should not find it', async () => {
    expect((await api.get(`/api/document/${documentId}`, auth())).status).toBe(StatusCodes.NOT_FOUND);
    expect((await api.get(`/api/document/${documentId}/file`, auth())).status).toBe(StatusCodes.NOT_FOUND);
  });

  it('Should not list it', async () => {

    // Lo mas reciente primero: sin la baja, el documento entraria en esta pagina.
    const listed = async () => {
      const response = await api.get('/api/document', {
        ...auth(), params: { limit: 100, sort: 'creation_date', order: 'desc' }
      });
      expect(response.status).toBe(StatusCodes.OK);
      return JSON.stringify(response.data).includes(documentId);
    };

    expect(await listed()).toBe(false);

    await setDischarge(false);
    expect(await listed()).toBe(true);
    await setDischarge(true);
  });

  it('Should not modify its metadata or its file', async () => {

    const metadata = await api.put(`/api/document/${documentId}`, { name: 'changed.pdf' }, auth());
    expect(metadata.status).toBe(StatusCodes.NOT_FOUND);

    const form = upload();
    const file = await api.put(`/api/document/${documentId}/file`, form, {
      headers: { authorization: token, ...form.getHeaders() }
    });
    expect(file.status).toBe(StatusCodes.NOT_FOUND);
  });

  it('Should not release or delete it', async () => {

    expect((await api.post(`/api/document/${documentId}/release`, null, auth())).status).toBe(StatusCodes.NOT_FOUND);
    expect((await api.delete(`/api/document/${documentId}`, auth())).status).toBe(StatusCodes.NOT_FOUND);

    const rows:any = await sequelize.query('SELECT id FROM pergamo.document WHERE id = :id;', {
      replacements: { id: documentId },
      type: QueryTypes.SELECT
    });
    expect(rows).toHaveLength(1);
  });

  // Una baja a mitad de indexacion no puede dejar el documento clavado en 'indexing'.
  it('Should still let a running indexing job settle its status', async () => {

    await documentRepository.setIndexStatus(documentId, 'error', 'test');

    const rows:any = await sequelize.query('SELECT index_status FROM pergamo.document WHERE id = :id;', {
      replacements: { id: documentId },
      type: QueryTypes.SELECT
    });
    expect(rows[0].index_status).toBe('error');
  });
});
