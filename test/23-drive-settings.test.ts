import axios from 'axios';
import { StatusCodes } from 'http-status-codes';

import { app } from '@/server';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import Config from '@/shared/config';
import { driveConnectionRepository } from '@/infrastructure/db/repositories/drive-connection.repository';
import { driveSettingsRepository } from '@/infrastructure/db/repositories/drive-settings.repository';

const SECRET = 'GOCSPX-super-secret';

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

  it('Should reject an unknown field and a client of another organization', async () => {

    expect((await put({ client_id: 'id', extra: true })).status).toBe(StatusCodes.BAD_REQUEST);

    // La organizacion sale del token: no hay forma de nombrar otra.
    expect((await put({ client_id: 'id', organization: 'other' })).status).toBe(StatusCodes.BAD_REQUEST);
  });
});
