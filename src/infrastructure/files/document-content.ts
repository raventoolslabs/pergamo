import path from 'path';
import { randomUUID } from 'crypto';

import Config from '@/shared/config';
import { Document } from '@/domain/entities/document';
import { parseGitHubFileId } from '@/domain/entities/github';
import { DocumentContent } from '@/app/ports/services/document-content.service';
import { documentStorage } from '@/infrastructure/files/document-storage';
import { driveClient } from '@/infrastructure/google/drive.client';
import { githubClient } from '@/infrastructure/github/github.client';

// Se baja a tmp_base: si el proceso cae antes del release, lo recoge la limpieza
// de huerfanos.
const download = async (document:Document, filePath:string) => {

  if(document.source === 'drive') {
    return driveClient.download(document.organization, document.remote.fileId, filePath);
  }

  const ref = parseGitHubFileId(document.remote.fileId);

  // Por el sha del blob, que es lo que se guardo como revision: el contenido es
  // exactamente el que se archivo, aunque la rama haya avanzado.
  return githubClient.download(document.organization, ref.owner, ref.repository, document.remote.revision, filePath);
};

export const documentContent:DocumentContent = {

  async fetch(document) {

    // La copia en Pergamo: la de un documento de disco siempre, y la de uno
    // remoto cuando su origen pidio guardarla. Sin ella se baja de la API.
    const stored = documentStorage.resolve(document.organization, document.path);

    if(await documentStorage.exists(stored)) return { filePath: stored, release: async () => {} };

    if(document.source === 'disk') return null;

    const filePath = path.join(Config.tmp_base, `${document.source}-${randomUUID()}`);
    const release = () => documentStorage.removeTemp(filePath);

    try {
      if(await download(document, filePath)) return { filePath, release };
    } catch(error) {
      await release().catch(() => {});
      throw error;
    }

    await release();
    return null;
  }
};
