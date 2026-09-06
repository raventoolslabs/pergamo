import axios from 'axios';
import path from 'path';
import fs from 'fs';
import FormData from 'form-data';
import { StatusCodes } from 'http-status-codes';

import { app } from '../src/app';
import sequelize, { QueryTypes } from '../src/utils/db';
import Config from '../src/config';

/**
 * Estado de cuarentena y bloqueo de descarga.
 *
 * Cubre la brecha estructural que ClamAV no puede cerrar por si solo: se
 * escaneaba una unica vez, en la subida, y un fichero limpio hoy puede tener
 * firma dentro de tres dias. Estas pruebas verifican que un documento cuyo
 * veredicto no es 'clean' deja de servirse, y que sus metadatos siguen siendo
 * consultables para que el cliente pueda saber por que.
 *
 * El estado se fuerza por base de datos en lugar de tumbar clamd: lo que se
 * comprueba aqui es el gate, y hacerlo depender de la disponibilidad real del
 * escaner convertiria la prueba en intermitente.
 */
describe('Scan quarantine gate', () => {

  let api;
  let server;
  let token;
  let documentId;

  const setStatus = async (status:string, signature:string|null = null) =>
    sequelize.query(
      'UPDATE pergamo.document SET scan_status = :status, scan_signature = :signature WHERE id = :id;', {
      replacements: { id: documentId, status, signature },
      type: QueryTypes.UPDATE
    });

  beforeAll(async () => {

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

    const form = new FormData();
    form.append('document', fs.createReadStream(path.join(__dirname, 'assets', 'test.pdf')));

    const upload = await api.post('/document', form, {
      headers: { authorization: token, ...form.getHeaders() }
    });

    documentId = upload.data.uuid;
  });

  afterAll(async () => {

    if(documentId) {
      // El borrado exige que el documento exista; su estado de analisis no
      // interviene, asi que se limpia igual estando en cuarentena.
      await api.delete(`/document/${documentId}`, { headers: { authorization: token } });
    }

    server.close();
    await sequelize.close();
  });

  it('Should store a freshly uploaded document as clean', async () => {

    const rows:any = await sequelize.query(
      'SELECT scan_status, scan_engine FROM pergamo.document WHERE id = :id;', {
      replacements: { id: documentId },
      type: QueryTypes.SELECT
    });

    expect(rows.length).toBe(1);
    expect(rows[0].scan_status).toBe('clean');

    // Con el antivirus activo queda registrado con que motor y base de firmas
    // se aprobo: es lo que define despues que hay que reescanear.
    if(Config.enable_antivirus) expect(rows[0].scan_engine).toBeTruthy();
  });

  it('Should block the download of an infected document with 423', async () => {

    await setStatus('infected', 'Test.Signature-1');

    const response = await api.get(`/document/${documentId}/file`, {
      headers: { authorization: token }
    });

    expect(response.status).toBe(StatusCodes.LOCKED);
    expect(response.data.error).toContain('Test.Signature-1');
  });

  it('Should still serve the metadata of a quarantined document', async () => {

    // El bloqueo se aplica en getFile y NO en getInfo: los metadatos son como
    // el cliente descubre por que el documento esta bloqueado.
    const response = await api.get(`/document/${documentId}`, {
      headers: { authorization: token }
    });

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.uuid).toBe(documentId);
  });

  it('Should block the download of a pending document with 423', async () => {

    // 'pending' es el estado en que queda una subida aceptada mientras el
    // escaner estaba habilitado pero no disponible.
    await setStatus('pending');

    const response = await api.get(`/document/${documentId}/file`, {
      headers: { authorization: token }
    });

    expect(response.status).toBe(StatusCodes.LOCKED);
    expect(response.data.error).toContain('pending');
  });

  it('Should serve the file again once the scan is clean', async () => {

    await setStatus('clean');

    const response = await api.get(`/document/${documentId}/file`, {
      headers: { authorization: token }
    });

    expect(response.status).toBe(StatusCodes.OK);
  });

  it('Should quote and escape the filename in Content-Disposition', async () => {

    // El nombre procede del originalname del cliente. Sin comillas ni escape se
    // podian inyectar parametros adicionales en la cabecera.
    const response = await api.get(`/document/${documentId}/file`, {
      headers: { authorization: token }
    });

    const disposition = response.headers['content-disposition'];

    expect(disposition).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
