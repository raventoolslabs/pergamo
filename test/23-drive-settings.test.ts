import axios from 'axios';
import { StatusCodes } from 'http-status-codes';

import { app } from '@/server';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import Config from '@/shared/config';
import { documentRepository } from '@/infrastructure/db/repositories/document.repository';
import { driveConnectionRepository } from '@/infrastructure/db/repositories/drive-connection.repository';
import { driveFolderRepository } from '@/infrastructure/db/repositories/drive-folder.repository';
import { driveSettingsRepository } from '@/infrastructure/db/repositories/drive-settings.repository';

const SECRET = 'GOCSPX-super-secret';
// Organizacion de usar y tirar: el desmontaje arrasa con la que lo sufre.
const OTHER = 'drive-teardown';

/** El cliente OAuth de cada organizacion: contrato de la API y sellado real. */
describe('Drive settings', () => {

  const original = { drive: { ...Config.drive }, secret_key: Config.secret_key };

  let api;
  let server;
  let token;

  const auth = () => ({ headers: { authorization: token } });
  const put = (body:object) => api.put('/api/drive/settings', body, auth());

  const storedSecret = async ():Promise<string | null> => {
    const rows:any = await sequelize.query(
      'SELECT client_secret FROM pergamo.drive_settings WHERE organization = :organization;',
      { replacements: { organization: 'pergamo' }, type: QueryTypes.SELECT });
    return rows.length === 1 ? rows[0].client_secret : null;
  };

  beforeAll(async () => {

    server = await app(0);
    api = axios.create({ baseURL: `http://localhost:${server.address().port}`, validateStatus: () => true });

    token = (await api.post('/api/organization/login', { name: 'pergamo', password: Config.password_master })).data.token;

    Object.assign(Config.drive, { enabled: true, redirect_uri: 'http://localhost/api/drive/callback' });
    Config.secret_key = Buffer.alloc(32, 5).toString('base64');
  });

  afterAll(async () => {
    await driveSettingsRepository.remove('pergamo');
    Object.assign(Config.drive, original.drive);
    Config.secret_key = original.secret_key;
    server.close();
    await sequelize.close();
  });

  it('Should report no client before anything is registered', async () => {

    const response = await api.get('/api/drive/settings', auth());

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data).toMatchObject({ configured: false, client_id: null });
    // Lo que hay que registrar en Google Cloud, aunque sea del despliegue.
    expect(response.data.redirect_uri).toBe('http://localhost/api/drive/callback');
  });

  it('Should register a client without ever giving the secret back', async () => {

    const response = await put({ client_id: 'id.apps.googleusercontent.com', client_secret: SECRET });

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data).toMatchObject({ configured: true, client_id: 'id.apps.googleusercontent.com' });
    expect(JSON.stringify(response.data)).not.toContain(SECRET);
    expect((await api.get('/api/drive/settings', auth())).data.configured).toBe(true);
  });

  it('Should store the secret sealed and only open it for the adapter', async () => {

    const stored = await storedSecret();

    expect(stored).not.toBe(SECRET);
    // iv:tag:data, las tres partes en base64.
    expect(stored.split(':')).toHaveLength(3);

    expect(await driveSettingsRepository.credentials('pergamo')).toMatchObject({ clientSecret: SECRET });
  });

  it('Should keep the stored secret when the body omits it', async () => {

    const response = await put({ client_id: 'other.apps.googleusercontent.com' });

    expect(response.data).toMatchObject({ configured: true, client_id: 'other.apps.googleusercontent.com' });
    expect(await driveSettingsRepository.credentials('pergamo')).toMatchObject({ clientSecret: SECRET });
  });

  it('Should drop the secret when the body sends null', async () => {

    expect((await put({ client_id: 'other.apps.googleusercontent.com', client_secret: null })).data.configured).toBe(false);
    expect(await storedSecret()).toBeNull();
    expect(await driveSettingsRepository.credentials('pergamo')).toBeNull();

    // Sin secreto no hay con que pedir autorizacion a Google.
    const connect = await api.post('/api/drive/connect', null, auth());
    expect(connect.status).toBe(StatusCodes.BAD_REQUEST);
    expect(connect.data.code).toBe('DRIVE_NOT_CONFIGURED');
  });

  it('Should take the connection away with the client', async () => {

    await put({ client_id: 'id.apps.googleusercontent.com', client_secret: SECRET });
    await driveConnectionRepository.save({
      organization: 'pergamo', googleAccount: 'a@example.com', sealedRefreshToken: 'sealed', scope: 'drive'
    });

    expect((await api.delete('/api/drive/settings', auth())).status).toBe(StatusCodes.NO_CONTENT);

    // El refresh_token lo emitio ese cliente: sin el no se puede renovar nunca.
    expect(await driveSettingsRepository.find('pergamo')).toBeNull();
    expect(await driveConnectionRepository.find('pergamo')).toBeNull();
  });

  /**
   * Desconectar desmonta: el binario vive en Drive, asi que conservar la ficha
   * de un documento que ya no se puede descargar no serviria de nada.
   *
   * En una organizacion aparte, y no en 'pergamo': el desmontaje se lleva TODAS
   * sus carpetas y da de baja TODOS sus documentos de Drive, y esta bateria
   * comparte base con lo que haya sembrado quien la ejecute.
   */
  it('Should tear Drive down on disconnect: folders, documents, connection and client', async () => {

    await put({ client_id: 'id.apps.googleusercontent.com', client_secret: SECRET });

    // Los documentos no caen con la organizacion, y el indice de remote_file_id
    // rechazaria el de la pasada anterior.
    await sequelize.query('DELETE FROM pergamo.document WHERE organization = :id;',
      { replacements: { id: OTHER }, type: QueryTypes.DELETE });
    await sequelize.query('DELETE FROM pergamo.organization WHERE id = :id;',
      { replacements: { id: OTHER }, type: QueryTypes.DELETE });

    await sequelize.query(
      `INSERT INTO pergamo.organization(id, name, password)
       VALUES (:id, :id, crypt('Pergamo0123#', gen_salt('bf')));`,
      { replacements: { id: OTHER }, type: QueryTypes.INSERT });

    const other = (await api.post('/api/organization/login', { name: OTHER, password: 'Pergamo0123#' })).data.token;
    const headers = { headers: { authorization: other } };

    await api.put('/api/drive/settings', { client_id: 'other.apps.googleusercontent.com', client_secret: SECRET }, headers);
    await driveConnectionRepository.save({
      organization: OTHER, googleAccount: 'a@example.com', sealedRefreshToken: 'sealed', scope: 'drive'
    });

    const folder = await driveFolderRepository.create({
      organization: OTHER, folderId: 'teardown', name: 'Teardown', indexDocuments: false
    });

    const metadata = { name: 'a.pdf', original_name: 'a.pdf', mimetype: 'application/pdf', extension: 'pdf', hash: 'drive:1', tags: [] };
    const scan = { scanStatus: 'pending' as const, scanSignature: null, scanEngine: null, scanDate: null };
    const document = await documentRepository.create(OTHER, metadata, scan, 'none', undefined,
      { source: 'drive', fileId: 'teardown-file', folder: folder.id, revision: '1' });

    expect((await api.delete('/api/drive', headers)).status).toBe(StatusCodes.NO_CONTENT);

    expect(await driveFolderRepository.list(OTHER)).toEqual([]);
    expect(await driveSettingsRepository.find(OTHER)).toBeNull();
    expect(await driveConnectionRepository.find(OTHER)).toBeNull();

    // Baja logica: fuera del listado, pero con su id, para que reviva si vuelve.
    expect(await documentRepository.findById(OTHER, document.id)).toBeNull();
    const state = await documentRepository.listRemoteState(OTHER, 'drive', null, 1000);
    expect(state.find((remote) => remote.id === document.id)).toMatchObject({ discharged: true });

    // La organizacion vecina no se entera.
    expect(await driveSettingsRepository.find('pergamo')).not.toBeNull();
  });

  it('Should reject an unknown field and a client of another organization', async () => {

    expect((await put({ client_id: 'id', extra: true })).status).toBe(StatusCodes.BAD_REQUEST);

    // La organizacion sale del token: no hay forma de nombrar otra.
    expect((await put({ client_id: 'id', organization: 'other' })).status).toBe(StatusCodes.BAD_REQUEST);
  });
});
