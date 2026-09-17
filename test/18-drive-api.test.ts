import axios from 'axios';
import { StatusCodes } from 'http-status-codes';

import { app } from '@/server';
import sequelize from '@/infrastructure/db/client';
import Config from '@/shared/config';
import { seal } from '@/infrastructure/security/secret-box';
import { driveSettingsRepository } from '@/infrastructure/db/repositories/drive-settings.repository';

/**
 * Lo que la API de Drive hace sin llamar a Google: el callback publico y su
 * state, la bandera de despliegue y las validaciones previas.
 */
describe('Drive API', () => {

  const original = { drive: { ...Config.drive }, secret_key: Config.secret_key };

  let api;
  let server;
  let token;

  const auth = () => ({ headers: { authorization: token } });

  beforeAll(async () => {

    server = await app(0);
    api = axios.create({ baseURL: `http://localhost:${server.address().port}`, validateStatus: () => true, maxRedirects: 0 });

    token = (await api.post('/api/organization/login', { name: 'pergamo', password: Config.password_master })).data.token;

    // Despues de arrancar: con Drive activo el servidor levantaria el worker contra Redis.
    Object.assign(Config.drive, { enabled: true, redirect_uri: 'http://localhost/api/drive/callback' });
    Config.secret_key = Buffer.alloc(32, 3).toString('base64');

    // Despues de la clave: el repositorio sella el secreto con ella.
    await driveSettingsRepository.save({ organization: 'pergamo', clientId: 'client', clientSecret: 'secret' });
  });

  afterAll(async () => {
    await driveSettingsRepository.remove('pergamo');
    Object.assign(Config.drive, original.drive);
    Config.secret_key = original.secret_key;
    server.close();
    await sequelize.close();
  });

  it('Should publish drive_enabled in the config', async () => {
    const response = await api.get('/api/config', auth());
    expect(response.data.drive_enabled).toBe(true);
  });

  it('Should answer DRIVE_DISABLED when the deployment has no Drive', async () => {

    Config.drive.enabled = false;
    try {
      const response = await api.get('/api/drive', auth());
      expect(response.status).toBe(StatusCodes.BAD_REQUEST);
      expect(response.data.code).toBe('DRIVE_DISABLED');
    } finally {
      Config.drive.enabled = true;
    }
  });

  it('Should require authentication everywhere but the callback', async () => {
    expect((await api.get('/api/drive')).status).toBe(StatusCodes.UNAUTHORIZED);
    expect((await api.get('/api/drive/folders')).status).toBe(StatusCodes.UNAUTHORIZED);
    expect((await api.post('/api/drive/connect')).status).toBe(StatusCodes.UNAUTHORIZED);
  });

  it('Should hand out a Google authorization URL with PKCE and offline access', async () => {

    const response = await api.post('/api/drive/connect', null, auth());
    expect(response.status).toBe(StatusCodes.OK);

    const url = new URL(response.data.url);
    expect(url.hostname).toBe('accounts.google.com');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // Sellado: la organizacion no viaja legible.
    expect(url.searchParams.get('state')).not.toContain('pergamo');
  });

  it('Should reject a forged, expired or foreign state without a token', async () => {

    const expired = seal(JSON.stringify({ organization: 'pergamo', verifier: 'v', exp: Date.now() - 1 }));

    const key = Config.secret_key;
    Config.secret_key = Buffer.alloc(32, 4).toString('base64');
    const foreign = seal(JSON.stringify({ organization: 'pergamo', verifier: 'v', exp: Date.now() + 60000 }));
    Config.secret_key = key;

    for(const state of ['forged', expired, foreign]) {
      const response = await api.get('/api/drive/callback', { params: { code: 'code', state, scope: 'openid https://www.googleapis.com/auth/drive.readonly', authuser: '0' } });
      expect(response.status).toBe(StatusCodes.UNAUTHORIZED);
      expect(response.data.code).toBe('DRIVE_STATE_INVALID');
    }
  });

  it('Should send the browser back to the interface when the user declines', async () => {
    const response = await api.get('/api/drive/callback', { params: { error: 'access_denied' } });
    expect(response.status).toBe(StatusCodes.MOVED_TEMPORARILY);
    expect(response.headers.location).toBe('/drive?error=access_denied');
  });

  it('Should not store a grant without the Drive scope', async () => {
    const scope = 'openid https://www.googleapis.com/auth/userinfo.email';
    const response = await api.get('/api/drive/callback', { params: { code: 'code', state: 'forged', scope } });
    expect(response.status).toBe(StatusCodes.MOVED_TEMPORARILY);
    expect(response.headers.location).toBe('/drive?error=scope_missing');
  });

  it('Should report no connection and no folders', async () => {
    expect((await api.get('/api/drive', auth())).data).toMatchObject({ connected: false, google_account: null });
    expect((await api.get('/api/drive/folders', auth())).data).toEqual([]);
  });

  it('Should validate a new folder before calling Google', async () => {

    const unknown = await api.post('/api/drive/folders', { folder_id: 'x', extra: true }, auth());
    expect(unknown.status).toBe(StatusCodes.BAD_REQUEST);

    if(!Config.indexing.enabled) {
      const index = await api.post('/api/drive/folders', { folder_id: 'x', index: true }, auth());
      expect(index.data.code).toBe('INDEXING_DISABLED');
    }

    // Sin conexion no hay a quien preguntar por la carpeta.
    const disconnected = await api.post('/api/drive/folders', { folder_id: 'x' }, auth());
    expect(disconnected.status).toBe(StatusCodes.UNAUTHORIZED);
    expect(disconnected.data.code).toBe('DRIVE_NOT_CONNECTED');
  });

  it('Should answer DRIVE_NOT_CONFIGURED when the organization has no OAuth client', async () => {

    await driveSettingsRepository.remove('pergamo');
    try {
      const response = await api.post('/api/drive/connect', null, auth());
      expect(response.status).toBe(StatusCodes.BAD_REQUEST);
      expect(response.data.code).toBe('DRIVE_NOT_CONFIGURED');
    } finally {
      await driveSettingsRepository.save({ organization: 'pergamo', clientId: 'client', clientSecret: 'secret' });
    }
  });

  it('Should answer 404 for a folder that does not exist', async () => {
    const response = await api.get('/api/drive/folders/00000000-0000-0000-0000-000000000000/sync', auth());
    expect(response.status).toBe(StatusCodes.NOT_FOUND);
  });
});
