import config from '@/shared/config';
import { configSchema } from '@/shared/validation';

const KEY = Buffer.alloc(32, 1).toString('base64');
const REDIRECT = 'http://localhost/api/drive/callback';

const parse = (drive:object, secret_key?:string) =>
  configSchema.safeParse({ ...config, secret_key, drive: { ...config.drive, ...drive } });

describe('Drive configuration', () => {
  test('disabled needs nothing', () => {
    expect(parse({ enabled: false }).success).toBe(true);
  });

  // El cliente OAuth ya no esta aqui: va por organizacion en la base.
  test('enabled requires the redirect URI', () => {
    expect(parse({ enabled: true, redirect_uri: undefined }, KEY).success).toBe(false);
    expect(parse({ enabled: true, redirect_uri: REDIRECT }, KEY).success).toBe(true);
  });

  test('enabled requires SECRET_KEY', () => {
    expect(parse({ enabled: true, redirect_uri: REDIRECT }).success).toBe(false);
  });

  test('SECRET_KEY must be 32 bytes', () => {
    expect(parse({ enabled: false }, Buffer.alloc(16).toString('base64')).success).toBe(false);
  });
});
