import fs from 'fs';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

import Config from '@/shared/config';
import { NotFoundError, ValidationError } from '@/domain/exceptions/domain.exception';
import { DriveNotConnectedError, DriveUnavailableError } from '@/domain/exceptions/drive.exception';
import { DriveEntry, DriveFile } from '@/domain/entities/drive';
import { DriveClient } from '@/app/ports/services/drive.service';
import { accessToken, authUrl, exchange, forget } from '@/infrastructure/google/oauth.client';

const API = 'https://www.googleapis.com/drive/v3';
const REQUEST_TIMEOUT_MS = 60000;
const DOWNLOAD_TIMEOUT_MS = 300000;
const PAGE_SIZE = 1000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = 1000;

const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';

// Los nativos no tienen binario: se exportan a Office, que el conversor si lee.
const EXPORT:Record<string, string> = {
  'application/vnd.google-apps.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.google-apps.presentation': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

const FILE_FIELDS = 'id,name,mimeType,size,md5Checksum,version,modifiedTime,webViewLink,shortcutDetails';

const sleep = (ms:number) => new Promise((resolve) => setTimeout(resolve, ms));

const rateLimited = async (response:Response) => {

  if(response.status === 429) return true;
  if(response.status !== 403) return false;

  const body:any = await response.clone().json().catch(() => null);
  const reason = body?.error?.errors?.[0]?.reason;

  return reason === 'userRateLimitExceeded' || reason === 'rateLimitExceeded';
};

/**
 * Espera exponencial acotada ante limites de cuota; agotada, DriveUnavailableError.
 * Los 404 se devuelven: que falte algo lo decide quien llama.
 */
const request = async (organization:string, url:string, timeout = REQUEST_TIMEOUT_MS):Promise<Response> => {

  for(let attempt = 1; ; attempt++) {

    const token = await accessToken(organization);

    let response:Response;
    try {
      response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeout)
      });
    } catch(error:any) {
      throw new DriveUnavailableError(`Drive request failed: ${error.message}`);
    }

    if(response.ok || response.status === 404) return response;

    if(response.status === 401) {
      forget(organization);
      throw new DriveNotConnectedError(`Drive rejected the credentials of organization ${organization}`);
    }

    if(await rateLimited(response) && attempt < MAX_ATTEMPTS) {
      await response.body?.cancel();
      await sleep(BACKOFF_MS * 2 ** (attempt - 1));
      continue;
    }

    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new DriveUnavailableError(`Drive answered ${response.status}: ${detail}`);
  }
};

const json = async (organization:string, pathAndQuery:string) => {

  const response = await request(organization, `${API}${pathAndQuery}`);

  return response.status === 404 ? null : response.json() as Promise<any>;
};

// Con unidades compartidas: sin estos parametros sus ficheros no aparecen.
const listQuery = (q:string, fields:string, pageToken?:string) => '/files?' + new URLSearchParams({
  q,
  fields: `nextPageToken,files(${fields})`,
  pageSize: String(PAGE_SIZE),
  supportsAllDrives: 'true',
  includeItemsFromAllDrives: 'true',
  ...(pageToken ? { pageToken } : {})
});

async function* list(organization:string, q:string, fields:string):AsyncGenerator<any> {

  let pageToken:string;

  do {
    const page = await json(organization, listQuery(q, fields, pageToken));
    if(!page) return;
    yield* page.files;
    pageToken = page.nextPageToken;
  } while(pageToken);
}

// Los ids de Drive son alfanumericos, pero van dentro de una consulta: se escapan.
const inParents = (folderId:string) => `'${folderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents and trashed = false`;

const toDriveFile = (file:any):DriveFile => ({
  id: file.id,
  name: file.name,
  mimetype: EXPORT[file.mimeType] ?? file.mimeType,
  size: file.size === undefined ? undefined : Number(file.size),
  md5Checksum: file.md5Checksum,
  version: file.version,
  modifiedTime: file.modifiedTime,
  viewLink: file.webViewLink
});

const metadataOf = (organization:string, fileId:string, fields:string) =>
  json(organization, `/files/${encodeURIComponent(fileId)}?` + new URLSearchParams({ fields, supportsAllDrives: 'true' }));

export const driveClient:DriveClient = {

  authUrl,
  exchange,

  async folder(organization, folderId) {

    const file = await metadataOf(organization, folderId, 'id,name,mimeType');

    if(!file) throw new NotFoundError('DRIVE_FOLDER_NOT_FOUND', `Drive folder ${folderId} not found`);
    if(file.mimeType !== FOLDER) throw new ValidationError('DRIVE_NOT_A_FOLDER', `Drive item ${folderId} is not a folder`);

    return { id: file.id, name: file.name };
  },

  async children(organization, folderId = 'root') {

    const entries:DriveEntry[] = [];

    for await (const file of list(organization, `${inParents(folderId)} and mimeType = '${FOLDER}'`, 'id,name')) {
      entries.push({ id: file.id, name: file.name });
    }

    return entries.sort((a, b) => a.name.localeCompare(b.name));
  },

  /**
   * En anchura, con los visitados apuntados: un acceso directo a una carpeta
   * superior cerraria un ciclo. Los accesos directos a ficheros no se siguen:
   * el fichero vive en otra carpeta y alli se sincroniza.
   */
  async *walk(organization, folderId) {

    // Una carpeta raiz inaccesible listaria vacio, y el diff daria de baja todo
    // lo importado: tiene que abortar el recorrido.
    const root = await metadataOf(organization, folderId, 'id,mimeType,trashed');

    if(!root || root.trashed || root.mimeType !== FOLDER) {
      throw new NotFoundError('DRIVE_FOLDER_NOT_FOUND', `Drive folder ${folderId} not found`);
    }

    const pending = [folderId];
    const visited = new Set(pending);

    while(pending.length) {

      const current = pending.shift();

      for await (const file of list(organization, inParents(current), FILE_FIELDS)) {

        const target = file.mimeType === SHORTCUT && file.shortcutDetails?.targetMimeType === FOLDER ?
          file.shortcutDetails.targetId : file.mimeType === FOLDER ? file.id : null;

        if(target) {
          if(!visited.has(target)) {
            visited.add(target);
            pending.push(target);
          }
        } else if(file.mimeType !== SHORTCUT) {
          yield toDriveFile(file);
        }
      }
    }
  },

  async download(organization, fileId, target) {

    const file = await metadataOf(organization, fileId, 'id,mimeType,size,trashed');

    if(!file || file.trashed) return false;

    if(file.size !== undefined && Number(file.size) > Config.max_file_size) {
      throw new ValidationError('FILE_TOO_LARGE', `Drive file ${fileId} exceeds MAX_FILE_SIZE`);
    }

    const exported = EXPORT[file.mimeType];
    const id = encodeURIComponent(fileId);
    const url = exported ?
      `${API}/files/${id}/export?` + new URLSearchParams({ mimeType: exported }) :
      `${API}/files/${id}?` + new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });

    const response = await request(organization, url, DOWNLOAD_TIMEOUT_MS);

    if(response.status === 404) return false;

    // Un exportado no declara tamano: el tope se aplica tambien mientras llega.
    let received = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        callback(received > Config.max_file_size ?
          new ValidationError('FILE_TOO_LARGE', `Drive file ${fileId} exceeds MAX_FILE_SIZE`) : null, chunk);
      }
    });

    await pipeline(Readable.fromWeb(response.body as any), limit, fs.createWriteStream(target));

    return true;
  }
};
