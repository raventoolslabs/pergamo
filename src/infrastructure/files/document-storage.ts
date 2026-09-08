import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

import Config from '@/shared/config';
import log from '@/shared/logger';
import FilesUtils from '@/infrastructure/files/storage';
import { FileStorage, StoredVersion } from '@/app/ports/services/file-storage.service';

const REGEX_VERSION = /\.\d+$/;

const versionOf = (file:string) => Number.parseInt(file.match(REGEX_VERSION)[0].replace('.', ''));

export const documentStorage:FileStorage = {

  // El trigger new_document() deja document.path relativo a la organizacion: la
  // raiz y la organizacion las pone quien lee.
  resolve(organization, relative) {
    return path.join(Config.path_base, organization, relative);
  },

  async move(from, to) {
    await FilesUtils.mvAsync(from, to);
  },

  /**
   * Desplaza las versiones existentes un numero hacia arriba y comprime la
   * actual como `.1`, descartando lo que exceda MAX_VERSION_FILES.
   */
  async archiveVersion(id, filePath) {

    const directory = path.dirname(filePath);

    const versions = (await fs.promises.readdir(directory))
      .filter((file) => file.match(REGEX_VERSION))
      .map((file) => ({ version: versionOf(file), file }))
      .sort((a, b) => b.version - a.version);

    for(const version of versions) {
      if((version.version + 1) <= Config.max_version_file) {
        await FilesUtils.mvAsync(
          path.join(directory, version.file),
          `${filePath}.${version.version + 1}`);
      }
    }

    const readStream = fs.createReadStream(filePath);
    const writeStream = fs.createWriteStream(`${filePath}.1`);
    const archive = archiver('zip', { zlib: { level: 9 } });

    const archived = new Promise<void>((resolve, reject) => {
      writeStream.on('close', () => {
        log.debug(`Archived version of document ${id}: ${archive.pointer()} bytes`);
        resolve();
      });
      archive.on('error', reject);
      archive.pipe(writeStream);
    });

    archive.append(readStream, { name: id });
    archive.finalize();

    await archived;
  },

  async listVersions(filePath):Promise<StoredVersion[]> {

    const directory = path.dirname(filePath);

    const files = (await fs.promises.readdir(directory))
      .filter((file) => file.match(REGEX_VERSION));

    const versions:StoredVersion[] = [];

    for(const file of files) {
      versions.push({
        version: versionOf(file),
        createdAt: (await fs.promises.stat(path.join(directory, file))).birthtime
      });
    }

    return versions.sort((a, b) => a.version - b.version);
  },

  async removeDocument(organization, relative) {
    await FilesUtils.rmdir(
      path.join(Config.path_base, organization),
      path.dirname(this.resolve(organization, relative)));
  },

  async removeTemp(filePath) {
    if(filePath && fs.existsSync(filePath)) await fs.promises.unlink(filePath);
  }
};
