import path from 'path';
import { randomUUID } from 'crypto';

import Config from '@/shared/config';
import { DocumentContent } from '@/app/ports/services/document-content.service';
import { documentStorage } from '@/infrastructure/files/document-storage';
import { driveClient } from '@/infrastructure/google/drive.client';

export const documentContent:DocumentContent = {

  async fetch(document) {

    if(document.source === 'disk') {

      const filePath = documentStorage.resolve(document.organization, document.path);

      return await documentStorage.exists(filePath) ? { filePath, release: async () => {} } : null;
    }

    // En tmp_base: si el proceso cae antes del release, lo recoge la limpieza de huerfanos.
    const filePath = path.join(Config.tmp_base, `drive-${randomUUID()}`);
    const release = () => documentStorage.removeTemp(filePath);

    try {
      if(await driveClient.download(document.organization, document.remote.fileId, filePath)) {
        return { filePath, release };
      }
    } catch(error) {
      await release().catch(() => {});
      throw error;
    }

    await release();
    return null;
  }
};
