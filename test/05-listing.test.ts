import axios from 'axios';
import path from 'path';
import fs from 'fs';
import FormData from 'form-data';

import { app } from '../src/app';
import sequelize, { QueryTypes } from '../src/utils/db';
import Config from '../src/config';
import { StatusCodes } from 'http-status-codes';

/**
 * Cubre los endpoints de listado y de configuracion, que son los que sostienen
 * la interfaz web: sin ellos no hay forma de descubrir que documentos existen
 * ni que limites aplica el despliegue.
 */
describe('Listing endpoints', () => {

  const OTHER_ORGANIZATION = 'test-listing';
  const OTHER_PASSWORD = 'Listing0123#';

  let api;
  let server;
  let tokenOwner;
  let tokenOther;
  let tokenMaster;
  let otherId;
  let documentId;
  let documentName;

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
    tokenMaster = response.data.token;

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
    documentName = response.data.name;

    // Una etiqueta conocida, para poder comprobar el filtro por tag.
    await api.put(`/document/${documentId}`, { tags: ['listado'] }, {
      headers: { authorization: tokenOwner, 'Content-Type': 'application/json' }
    });
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

  /* ------------------------------------------------------- GET /document -- */

  it('Should list the documents of the authenticated organization', async () => {

    const response = await api.get('/document', { headers: { authorization: tokenOwner } });

    expect(response.status).toBe(StatusCodes.OK);
    expect(typeof response.data.total).toBe('number');
    expect(response.data.limit).toBe(25);
    expect(response.data.offset).toBe(0);
    expect(Array.isArray(response.data.documents)).toBe(true);

    const document = response.data.documents.find((item:any) => item.id === documentId);

    expect(document).toBeDefined();
    expect(document.metadata.uuid).toBe(documentId);
    expect(document.scan_status).toBeDefined();
    // La ruta en disco no sale nunca al cliente.
    expect(document.path).toBeUndefined();
  });

  it('Should not list documents from another organization', async () => {

    const response = await api.get('/document', { headers: { authorization: tokenOther } });

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.documents.some((item:any) => item.id === documentId)).toBe(false);
  });

  it('Should filter by name, tag and scan status', async () => {

    let response = await api.get(`/document?name=${encodeURIComponent(documentName)}`, {
      headers: { authorization: tokenOwner }
    });
    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.documents.some((item:any) => item.id === documentId)).toBe(true);

    response = await api.get('/document?tag=listado', { headers: { authorization: tokenOwner } });
    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.documents.some((item:any) => item.id === documentId)).toBe(true);

    response = await api.get('/document?tag=inexistente', { headers: { authorization: tokenOwner } });
    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.documents.length).toBe(0);

    response = await api.get('/document?scan_status=infected', { headers: { authorization: tokenOwner } });
    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.documents.some((item:any) => item.id === documentId)).toBe(false);
  });

  it('Should accept several scan statuses at once', async () => {

    // La interfaz agrupa 'infected' y 'error' en un solo filtro: si la lista no
    // llegara entera, una de las dos mitades quedaria imposible de encontrar.
    let response = await api.get('/document?scan_status=infected,error', {
      headers: { authorization: tokenOwner }
    });
    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.documents.some((item:any) => item.id === documentId)).toBe(false);

    response = await api.get('/document?scan_status=clean,pending', {
      headers: { authorization: tokenOwner }
    });
    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.documents.some((item:any) => item.id === documentId)).toBe(true);
  });

  it('Should filter by deposit date range', async () => {

    const pasado = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const futuro = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    let response = await api.get(`/document?from=${encodeURIComponent(pasado)}&to=${encodeURIComponent(futuro)}`, {
      headers: { authorization: tokenOwner }
    });
    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.documents.some((item:any) => item.id === documentId)).toBe(true);

    // Una franja que termina antes de que existiera el documento no puede
    // devolverlo: si lo hace, el filtro no se esta aplicando.
    response = await api.get(`/document?to=${encodeURIComponent(pasado)}`, {
      headers: { authorization: tokenOwner }
    });
    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.documents.some((item:any) => item.id === documentId)).toBe(false);

    response = await api.get(`/document?from=${encodeURIComponent(futuro)}`, {
      headers: { authorization: tokenOwner }
    });
    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.documents.some((item:any) => item.id === documentId)).toBe(false);
  });

  it('Should paginate', async () => {

    const response = await api.get('/document?limit=1&offset=0', { headers: { authorization: tokenOwner } });

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.limit).toBe(1);
    expect(response.data.documents.length).toBeLessThanOrEqual(1);
    // El total cuenta el corpus entero, no la pagina.
    expect(response.data.total).toBeGreaterThanOrEqual(response.data.documents.length);
  });

  it('Should reject invalid query parameters instead of ignoring them', async () => {

    for(const query of ['limit=0', 'limit=1000', 'offset=-1', 'sort=path', 'order=random',
      'scan_status=whatever', 'scan_status=clean,whatever', 'scan_status=', 'from=ayer',
      'to=ayer', 'unknown=1']) {
      const response = await api.get(`/document?${query}`, { headers: { authorization: tokenOwner } });
      expect([query, response.status]).toEqual([query, StatusCodes.BAD_REQUEST]);
    }
  });

  it('Should not treat wildcards in the name filter as patterns', async () => {

    // Sin escapar, '%' devolveria el corpus entero en lugar de buscarlo como
    // caracter literal.
    const response = await api.get('/document?name=%25', { headers: { authorization: tokenOwner } });

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.documents.some((item:any) => item.id === documentId)).toBe(false);
  });

  it('Should tell a master token that it has no organization', async () => {

    const response = await api.get('/document', { headers: { authorization: tokenMaster } });

    expect(response.status).toBe(StatusCodes.BAD_REQUEST);
    expect(response.data.error).toContain('master');
  });

  it('Should require a token to list documents', async () => {
    const response = await api.get('/document');
    expect(response.status).toBe(StatusCodes.UNAUTHORIZED);
  });

  /* -------------------------------------------------- GET /document/:id/scan -- */

  it('Should expose the scan state of a document', async () => {

    const response = await api.get(`/document/${documentId}/scan`, {
      headers: { authorization: tokenOwner }
    });

    expect(response.status).toBe(StatusCodes.OK);
    expect(['pending', 'clean', 'infected', 'error', 'malicious']).toContain(response.data.scan_status);
    expect(response.data).toHaveProperty('scan_signature');
  });

  it('Should not expose the scan state of a document from another organization', async () => {

    const response = await api.get(`/document/${documentId}/scan`, {
      headers: { authorization: tokenOther }
    });

    expect(response.status).toBe(StatusCodes.NOT_FOUND);
  });

  /* --------------------------------------------------- GET /organization -- */

  it('Should list organizations for the master user', async () => {

    const response = await api.get('/organization', { headers: { authorization: tokenMaster } });

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.organizations.some((item:any) => item.id === otherId)).toBe(true);
    // El hash de la contrasena no puede salir de la base de datos.
    response.data.organizations.forEach((item:any) => expect(item.password).toBeUndefined());
  });

  it('Should filter organizations by name', async () => {

    const response = await api.get(`/organization?name=${OTHER_ORGANIZATION}`, {
      headers: { authorization: tokenMaster }
    });

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.organizations.length).toBe(1);
    expect(response.data.organizations[0].name).toBe(OTHER_ORGANIZATION);
  });

  it('Should refuse to list organizations without the master token', async () => {

    let response = await api.get('/organization', { headers: { authorization: tokenOwner } });
    expect(response.status).toBe(StatusCodes.UNAUTHORIZED);

    response = await api.get('/organization');
    expect(response.status).toBe(StatusCodes.UNAUTHORIZED);
  });

  /* --------------------------------------------------------- GET /config -- */

  it('Should serve the deployment limits to an authenticated client', async () => {

    const response = await api.get('/config', { headers: { authorization: tokenOwner } });

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.valid_mimetype).toEqual(Config.valid_mimetype);
    expect(response.data.valid_metadata_modify).toEqual(Config.valid_metadata_modify);
    expect(response.data.max_file_size).toBe(Config.max_file_size);
    expect(response.data.max_version_file).toBe(Config.max_version_file);
  });

  it('Should require a token for the deployment limits', async () => {
    const response = await api.get('/config');
    expect(response.status).toBe(StatusCodes.UNAUTHORIZED);
  });
});
