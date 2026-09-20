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

  // Una baja no borra: el mismo fichero de Drive revive el mismo documento.
  it('Should discharge a Drive document and revive it with the same id', async () => {

    const folders:any = await sequelize.query(
      `INSERT INTO pergamo.drive_folder(organization, folder_id, name) VALUES ('pergamo', 'test-discharge', 'Test')
      RETURNING id;`, { type: QueryTypes.SELECT });
    const folder = folders[0].id;

    try {

      const metadata = { name: 'a.pdf', original_name: 'a.pdf', mimetype: 'application/pdf', extension: 'pdf', hash: 'drive:1', tags: [] };
      const scan = { scanStatus: 'pending' as const, scanSignature: null, scanEngine: null, scanDate: null };
      const remote = { source: 'drive' as const, fileId: 'test-discharge-file', folder, revision: '1' };

      const created = await documentRepository.create('pergamo', metadata, scan, 'none', undefined, remote);
      expect(created.source).toBe('drive');
      expect(created.remote).toEqual(remote);

      await documentRepository.discharge('pergamo', [created.id]);
      expect(await documentRepository.findById('pergamo', created.id)).toBeNull();

      const state = await documentRepository.listRemoteState('pergamo', 'drive', null, 1000);
      expect(state).toContainEqual({ id: created.id, fileId: remote.fileId, folder, revision: '1', indexStatus: 'none', discharged: true });

      const revived = await documentRepository.updateRemote('pergamo', created.id,
        { hash: 'drive:2' }, { ...remote, revision: '2' }, scan, 'pending');
      expect(revived.id).toBe(created.id);
      expect(revived.remote.revision).toBe('2');
      expect(revived.dischargeDate).toBeUndefined();
      // La mezcla conserva lo que no llego en la revision.
      expect(revived.metadata.name).toBe('a.pdf');
      expect(revived.metadata.hash).toBe('drive:2');
      expect(await documentRepository.findById('pergamo', created.id)).not.toBeNull();

    } finally {
      await sequelize.query(`DELETE FROM pergamo.document WHERE remote_file_id = 'test-discharge-file';`, { type: QueryTypes.DELETE });
      await sequelize.query('DELETE FROM pergamo.drive_folder WHERE id = :folder;', { replacements: { folder }, type: QueryTypes.DELETE });
    }
  });
});
