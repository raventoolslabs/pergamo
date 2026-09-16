import sequelize from '@/infrastructure/db/client';
import Config from '@/shared/config';
import { open, seal } from '@/infrastructure/security/secret-box';
import { exchange } from '@/infrastructure/google/oauth.client';
import { driveClient } from '@/infrastructure/google/drive.client';
import { driveConnectionRepository } from '@/infrastructure/db/repositories/drive-connection.repository';
import { driveFolderRepository } from '@/infrastructure/db/repositories/drive-folder.repository';

jest.mock('@/infrastructure/google/oauth.client', () => ({
  ...jest.requireActual('@/infrastructure/google/oauth.client'),
  accessToken: async () => 'token',
  forget: () => {}
}));

/** Adaptadores de Drive sin llamar a Google: fetch se sustituye por un arbol en memoria. */
describe('Drive adapters', () => {

  const originalKey = Config.secret_key;
  const originalFetch = global.fetch;

  beforeAll(() => { Config.secret_key = Buffer.alloc(32, 7).toString('base64'); });

  afterAll(async () => {
    Config.secret_key = originalKey;
    global.fetch = originalFetch;
    await sequelize.close();
  });

  it('Should seal and refuse tampered or foreign envelopes', () => {

    const sealed = seal('refresh-token');
    expect(open(sealed)).toBe('refresh-token');

    const [iv, tag, data] = sealed.split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => open([iv, tag, flipped.toString('base64')].join(':'))).toThrow();

    const other = Config.secret_key;
    Config.secret_key = Buffer.alloc(32, 8).toString('base64');
    expect(() => open(sealed)).toThrow();
    Config.secret_key = other;
  });

  it('Should reject a forged or expired OAuth state', async () => {

    await expect(exchange('forged', 'code')).rejects.toMatchObject({ code: 'DRIVE_STATE_INVALID' });

    const expired = seal(JSON.stringify({ organization: 'pergamo', verifier: 'v', exp: Date.now() - 1 }));
    await expect(exchange(expired, 'code')).rejects.toMatchObject({ code: 'DRIVE_STATE_INVALID' });
  });

  it('Should keep the refresh token out of the connection and hide it once revoked', async () => {

    try {
      const connection = await driveConnectionRepository.save({
        organization: 'pergamo', googleAccount: 'a@example.com', sealedRefreshToken: 'sealed', scope: 'drive'
      });
      expect(connection).not.toHaveProperty('refreshToken');
      expect(await driveConnectionRepository.sealedRefreshToken('pergamo')).toBe('sealed');

      await driveConnectionRepository.markRevoked('pergamo');
      expect(await driveConnectionRepository.sealedRefreshToken('pergamo')).toBeNull();
      expect((await driveConnectionRepository.find('pergamo')).revokedDate).toBeInstanceOf(Date);

      await driveConnectionRepository.save({
        organization: 'pergamo', googleAccount: 'a@example.com', sealedRefreshToken: 'again', scope: 'drive'
      });
      expect(await driveConnectionRepository.sealedRefreshToken('pergamo')).toBe('again');
    } finally {
      await driveConnectionRepository.remove('pergamo');
    }
  });

  it('Should store folders per organization', async () => {

    const folder = await driveFolderRepository.create({
      organization: 'pergamo', folderId: 'test-adapters', name: 'Test', indexDocuments: true
    });

    try {
      expect(await driveFolderRepository.findById('other', folder.id)).toBeNull();
      await driveFolderRepository.recordSync(folder.id, new Date(), 'boom');
      expect((await driveFolderRepository.findById('pergamo', folder.id)).syncError).toBe('boom');
      expect(await driveFolderRepository.remove('other', folder.id)).toBe(false);
    } finally {
      expect(await driveFolderRepository.remove('pergamo', folder.id)).toBe(true);
    }
  });

  describe('walk', () => {

    const FOLDER = 'application/vnd.google-apps.folder';

    // root → a.pdf, sub/ ; sub → b (Doc), atajo a root (ciclo), atajo a un fichero
    const TREE:Record<string, any[]> = {
      root: [
        { id: 'a', name: 'a.pdf', mimeType: 'application/pdf', size: '10', version: '1', modifiedTime: 't' },
        { id: 'sub', name: 'sub', mimeType: FOLDER }
      ],
      sub: [
        { id: 'b', name: 'b', mimeType: 'application/vnd.google-apps.document', version: '3', modifiedTime: 't' },
        { id: 'loop', name: 'loop', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'root', targetMimeType: FOLDER } },
        { id: 'link', name: 'link', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'a', targetMimeType: 'application/pdf' } }
      ]
    };

    const drive = (existing:string[]) => {
      global.fetch = (async (url:string) => {
        const parsed = new URL(url);
        const q = parsed.searchParams.get('q');
        if(q) {
          const parent = q.match(/^'([^']+)'/)[1];
          return new Response(JSON.stringify({ files: TREE[parent] ?? [] }));
        }
        const id = parsed.pathname.split('/').pop();
        return existing.includes(id) ?
          new Response(JSON.stringify({ id, mimeType: FOLDER, trashed: false })) :
          new Response('{}', { status: 404 });
      }) as any;
    };

    const collect = async (folder:string) => {
      const files = [];
      for await (const file of driveClient.walk('pergamo', folder)) files.push(file);
      return files;
    };

    it('Should visit every level once and export native files as Office', async () => {

      drive(['root']);
      const files = await collect('root');

      expect(files.map((file) => file.id)).toEqual(['a', 'b']);
      expect(files[0].size).toBe(10);
      expect(files[1].mimetype).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    });

    // Sin esto, un permiso retirado listaria vacio y el diff daria de baja todo.
    it('Should abort when the root folder is gone', async () => {

      drive([]);
      await expect(collect('root')).rejects.toMatchObject({ code: 'DRIVE_FOLDER_NOT_FOUND' });
    });
  });
});
