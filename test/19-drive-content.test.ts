import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { StatusCodes } from 'http-status-codes';

import { app } from '@/server';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import Config from '@/shared/config';
import { documentRepository } from '@/infrastructure/db/repositories/document.repository';

const PDF = fs.readFileSync(path.join(__dirname, 'assets', 'test.pdf'));

// Lo que Drive tiene: sin el id, el fichero se borro alli.
const remoteFiles = new Set<string>();

jest.mock('@/infrastructure/google/drive.client', () => ({
  driveClient: {
    download: async (_organization:string, fileId:string, target:string) => {
      if(!remoteFiles.has(fileId)) return false;
      await require('fs').promises.writeFile(target, PDF);
      return true;
    }
  }
}));

/** Un documento de Drive se entrega desde un temporal que no sobrevive a la respuesta. */
describe('Drive content', () => {

  let api;
  let server;
  let token;
  let documentId;

  const temporaries = async () =>
    (await fs.promises.readdir(Config.tmp_base)).filter((file) => file.startsWith('drive-'));

  beforeAll(async () => {

    server = await app(0);
    api = axios.create({ baseURL: `http://localhost:${server.address().port}`, validateStatus: () => true });

    token = (await api.post('/api/organization/login', { name: 'pergamo', password: Config.password_master })).data.token;

    const document = await documentRepository.create('pergamo',
      { name: 'remote', original_name: 'remote.pdf', mimetype: 'application/pdf', extension: 'pdf', hash: 'drive:1', tags: [] },
      { scanStatus: 'pending', scanSignature: null, scanEngine: null, scanDate: null }, 'none',
      undefined, { fileId: 'test-drive-content', revision: '1' });

    documentId = document.id;
  });

  afterAll(async () => {
    await sequelize.query('DELETE FROM pergamo.document WHERE id = :id;', { replacements: { id: documentId }, type: QueryTypes.DELETE });
    server.close();
    await sequelize.close();
  });

  it('Should deliver the file and remove the temporary copy', async () => {

    remoteFiles.add('test-drive-content');
    const before = await temporaries();

    const response = await api.get(`/api/document/${documentId}/file`, {
      headers: { authorization: token }, responseType: 'arraybuffer'
    });

    expect(response.status).toBe(StatusCodes.OK);
    expect(Buffer.from(response.data).equals(PDF)).toBe(true);

    // El borrado va en 'close', que puede llegar un instante despues del ultimo byte.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await temporaries()).toEqual(before);
  });

  it('Should report where the file lives apart from the metadata', async () => {

    const source = await api.get(`/api/document/${documentId}/source`, { headers: { authorization: token } });
    expect(source.data).toEqual({ source: 'drive', drive_view_link: null });

    // El cuerpo de GET /:id es el JSONB tal cual: no gana claves.
    const metadata = await api.get(`/api/document/${documentId}`, { headers: { authorization: token } });
    expect(metadata.data).not.toHaveProperty('source');
  });

  it('Should answer FILE_MISSING when the file was deleted in Drive', async () => {

    remoteFiles.delete('test-drive-content');

    const response = await api.get(`/api/document/${documentId}/file`, { headers: { authorization: token } });

    expect(response.status).toBe(StatusCodes.NOT_FOUND);
    expect(response.data.code).toBe('FILE_MISSING');
  });

  it('Should have no archived versions and refuse a file replacement', async () => {

    const auth = { headers: { authorization: token } };

    const versions = await api.get(`/api/document/${documentId}/versions`, auth);
    expect(versions.status).toBe(StatusCodes.OK);
    expect(versions.data).toEqual([]);

    const version = await api.get(`/api/document/${documentId}/versions/1/file`, auth);
    expect(version.status).toBe(StatusCodes.NOT_FOUND);

    const form = new FormData();
    form.append('document', fs.createReadStream(path.join(__dirname, 'assets', 'test.pdf')));
    const replaced = await api.put(`/api/document/${documentId}/file`, form, {
      headers: { authorization: token, ...form.getHeaders() }
    });
    expect(replaced.status).toBe(StatusCodes.BAD_REQUEST);
    expect(replaced.data.code).toBe('DRIVE_READ_ONLY');
  });
});
