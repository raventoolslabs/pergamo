import axios from 'axios';
import path from 'path';
import fs from 'fs';
import FormData from 'form-data';
import mime from 'mime-types';

import { app } from '../src/app';
import Config from '../src/config'
import { sha256, sha256File } from '../src/utils/hash';
import FilesUtils from "../src/utils/files";
describe('Document Tests', () => {

  let api;
  let server;
  let token;
  let id;

  beforeAll(async () => {
    server = await app(0);

    api = axios.create({
      baseURL: `http://localhost:${server.address().port}`,
      validateStatus: () => { return true; }
    });

    const response = await api.post(`/organization/login`, {
      name: 'pergamo',
      password: Config.password_master,
    });

    token = response.data.token;
  });

  afterAll(async() => {
    server.close();
  });

  it('Should upload a document', async () => {

    const pathPdf = path.join(__dirname, 'assets', 'test.pdf');

    const form = new FormData();
    form.append('document', fs.createReadStream(pathPdf));

    const response = await api.post('/document', form, {
      headers: {
        'authorization': token,
        ...form.getHeaders()
      },
    });

    const hash =  await sha256File(pathPdf)

    expect(response.status).toBe(200);
    expect(response.data.name).toBe('test');
    expect(response.data.extension).toBe('pdf');
    expect(response.data.original_name).toBe('test.pdf');
    expect(response.data.mimetype).toBe('application/pdf');
    expect(response.data.hash).toBe(hash);

    id = response.data.uuid;
  });

  it('Should not upload a virus', async () => {

    const virus = `X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`

    const form = new FormData();
    form.append('document', Buffer.from(virus), {
      filename: 'virus.pdf',
      contentType: 'application/pdf',
    });

    const response = await api.post('/document', form, {
      headers: {
        'authorization': token,
        ...form.getHeaders()
      },
    });

    expect(response.status).toBe(400);
    expect(response.data.error).toBe('File is infected with Win.Test.EICAR_HDB-1');
  });

  it('Should get a metadata of document', async () => {

    const response = await api.get(`/document/${id}`, {
      headers: {
        'authorization': token
      }
    });

    expect(response.status).toBe(200);
    expect(response.data.name).toBe('test');
    expect(response.data.extension).toBe('pdf');
    expect(response.data.original_name).toBe('test.pdf');
    expect(response.data.mimetype).toBe('application/pdf');
    expect(response.data.uuid).toBe(id);
  });

  it('Should get a file of document', async () => {

    const response = await api.get(`/document/${id}/file`, {
      headers: {
        'authorization': token
      }
    });

    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();
  });

  it('Should modify a metadata of document', async () => {

    const tags = ['test'];
    const response = await api.put(`/document/${id}`, { tags }, {
      headers: {
        'authorization': token,
        'Content-Type': mime.contentType('json')
      }
    });

    expect(response.status).toBe(200);
    expect(response.data.tags.includes('test')).toBeTruthy();
  });

  it('Should modify a file of document', async () => {

    const pathPdf = path.join(__dirname, 'assets', 'test2.pdf');

    const form = new FormData();
    form.append('document', fs.createReadStream(pathPdf));

    const response = await api.put(`/document/${id}/file`, form, {
      headers: {
        'authorization': token,
        ...form.getHeaders()
      },
    });

    const hash =  await sha256File(pathPdf)

    expect(response.status).toBe(200);
    expect(response.data.name).toBe('test2');
    expect(response.data.extension).toBe('pdf');
    expect(response.data.original_name).toBe('test2.pdf');
    expect(response.data.mimetype).toBe('application/pdf');
    expect(response.data.hash).toBe(hash);
  });

  if(Config.max_version_file > 1) {
    it('Should return saved versions of a document', async () => {

      let response = await api.get(`/document/${id}/versions`, {
        headers: {
          'authorization': token
        }
      });
  
      expect(response.status).toBe(200);
      expect(response.data.length).toBe(1);
      expect(response.data[0].version).toBe(1);
    });
  }
  
  it('Should remove a document', async () => {

    let response = await api.get(`/document/${id}`, {
      headers: {
        'authorization': token
      }
    });

    const pathFile = FilesUtils.pathFile(response.data);

    response = await api.delete(`/document/${id}`, {
      headers: {
        'authorization': token
      }
    });

    expect(response.status).toBe(200);
    expect(response.data.message).toBe(`Document with id ${id} deleted`);
    expect(!fs.existsSync(pathFile)).toBeTruthy();
  });
});