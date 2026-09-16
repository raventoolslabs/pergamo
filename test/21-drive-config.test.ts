import config from '@/shared/config';
import { configSchema } from '@/shared/validation';

const KEY = Buffer.alloc(32, 1).toString('base64');
const CREDENTIALS = { client_id: 'id', client_secret: 'secret', redirect_uri: 'http://localhost/api/drive/callback' };

const parse = (drive:object, secret_key?:string) =>
  configSchema.safeParse({ ...config, secret_key, drive: { ...config.drive, ...drive } });

describe('Drive configuration', () => {
  test('disabled needs nothing', () => {
    expect(parse({ enabled: false }).success).toBe(true);
  });

  test('enabled requires the OAuth client', () => {
    expect(parse({ enabled: true, client_id: undefined, client_secret: 'secret', redirect_uri: CREDENTIALS.redirect_uri }, KEY).success).toBe(false);
  });

  test('enabled requires SECRET_KEY', () => {
    expect(parse({ enabled: true, ...CREDENTIALS }).success).toBe(false);
    expect(parse({ enabled: true, ...CREDENTIALS }, KEY).success).toBe(true);
  });

  test('SECRET_KEY must be 32 bytes', () => {
    expect(parse({ enabled: false }, Buffer.alloc(16).toString('base64')).success).toBe(false);
  });
});
