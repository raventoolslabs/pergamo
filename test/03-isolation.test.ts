import axios from 'axios';
import path from 'path';
import fs from 'fs';
import FormData from 'form-data';
import { Readable } from 'stream';

import { app } from '../src/app';
import sequelize, { QueryTypes } from '../src/utils/db';
import Config from '../src/config';
import { StatusCodes } from 'http-status-codes';

/**
 * Cubre las garantias de seguridad que no verificaba ninguna prueba: que una
 * organizacion no puede alcanzar los documentos de otra, que un token invalido
 * se rechaza, y que las validaciones de fichero se aplican de verdad.
 */
describe('Isolation and input validation', () => {

  const OTHER_ORGANIZATION = 'test-isolation';
  const OTHER_PASSWORD = 'Isolation0123#';

  let api;
  let server;
  let tokenOwner;
  let tokenOther;
  let otherId;
  let documentId;

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
    tokenOwner = response.data.token;

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
      headers: { authorization: tokenOwner, ...form.getHeaders() }
    });
    documentId = response.data.uuid;
  });

  afterAll(async () => {

    if(documentId) {
      await api.delete(`/document/${documentId}`, { headers: { authorization: tokenOwner } });
    }

    if(otherId) {
      await sequelize.query('DELETE FROM pergamo.organization WHERE id = :id;', {
        replacements: { id: otherId },
        type: QueryTypes.DELETE
      });
    }

    server.close();
  });

  it('Should have prepared both organizations and a document', () => {
    expect(tokenOwner).toBeDefined();
    expect(tokenOther).toBeDefined();
    expect(otherId).toBeDefined();
    expect(documentId).toBeDefined();
  });

  it('Should not expose metadata of a document from another organization', async () => {
    const response = await api.get(`/document/${documentId}`, {
      headers: { authorization: tokenOther }
    });
    expect(response.status).toBe(StatusCodes.NOT_FOUND);
  });

  it('Should not expose the file of a document from another organization', async () => {
    const response = await api.get(`/document/${documentId}/file`, {
      headers: { authorization: tokenOther }
    });
    expect(response.status).toBe(StatusCodes.NOT_FOUND);
  });

  it('Should not modify metadata of a document from another organization', async () => {
    const response = await api.put(`/document/${documentId}`, { name: 'robado' }, {
      headers: { authorization: tokenOther, 'Content-Type': 'application/json' }
    });
    expect(response.status).toBe(StatusCodes.NOT_FOUND);
  });

  it('Should not delete a document from another organization', async () => {
    const response = await api.delete(`/document/${documentId}`, {
      headers: { authorization: tokenOther }
    });
    expect(response.status).toBe(StatusCodes.NOT_FOUND);

    // El documento sigue siendo accesible para su propietario.
    const owner = await api.get(`/document/${documentId}`, {
      headers: { authorization: tokenOwner }
    });
    expect(owner.status).toBe(StatusCodes.OK);
  });

  it('Should reject a tampered token', async () => {
    const response = await api.get(`/document/${documentId}`, {
      headers: { authorization: `${tokenOwner}modificado` }
    });
    expect(response.status).toBe(StatusCodes.UNAUTHORIZED);
  });

  it('Should reject a request without token', async () => {
    const response = await api.get(`/document/${documentId}`);
    expect(response.status).toBe(StatusCodes.UNAUTHORIZED);
  });

  it('Should reject content that does not match the declared mimetype', async () => {
    const form = new FormData();
    form.append('document', Buffer.from('MZ contenido que no es un PDF'), {
      filename: 'falso.pdf',
      contentType: 'application/pdf'
    });

    const response = await api.post('/document', form, {
      headers: { authorization: tokenOwner, ...form.getHeaders() }
    });

    expect(response.status).toBe(StatusCodes.BAD_REQUEST);
    expect(response.data.error).toContain('does not match');
  });

  it('Should reject metadata values that are too large', async () => {
    const response = await api.put(`/document/${documentId}`, { name: 'x'.repeat(5000) }, {
      headers: { authorization: tokenOwner, 'Content-Type': 'application/json' }
    });
    expect(response.status).toBe(StatusCodes.BAD_REQUEST);
  });

  it('Should reject a file over the configured size limit', async () => {

    // Antes esta prueba iba envuelta en `if(Config.max_file_size <= 5242880)`,
    // que con el valor por defecto (50 MB) NUNCA se cumplia: el limite de
    // tamano no estaba cubierto y, al ser un `if` y no un it.skip, Jest ni
    // siquiera lo reportaba como omitido.
    //
    // El cuerpo se genera por streaming en lugar de materializar el fichero
    // completo en memoria, de modo que la prueba corre con cualquier
    // MAX_FILE_SIZE sin cargar decenas de MB en el proceso de test.
    const total = Config.max_file_size + 1024;
    const chunk = Buffer.alloc(64 * 1024, 0x41);

    let sent = 0;
    const source = new Readable({
      read() {
        if(sent === 0) { this.push(Buffer.from('%PDF-')); sent = 5; return; }
        if(sent >= total) return this.push(null);
        const size = Math.min(chunk.length, total - sent);
        sent += size;
        this.push(size === chunk.length ? chunk : chunk.subarray(0, size));
      }
    });

    const form = new FormData();
    form.append('document', source, {
      filename: 'grande.pdf',
      contentType: 'application/pdf',
      knownLength: total
    });

    // multer aborta en cuanto se supera el limite, asi que el servidor puede
    // responder mientras el cliente sigue enviando: la conexion se corta y
    // axios reporta un error de socket en vez de la respuesta. Ambos desenlaces
    // confirman el rechazo; lo que no puede ocurrir es un 200.
    let status:number;

    try {

      const response = await api.post('/document', form, {
        headers: { authorization: tokenOwner, ...form.getHeaders() },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });

      status = response.status;

    } catch(error:any) {

      expect(['ECONNRESET', 'EPIPE', 'ERR_BAD_REQUEST']).toContain(error.code);
      return;
    }

    expect(status).toBe(StatusCodes.REQUEST_TOO_LONG);
  }, 120000);
});
