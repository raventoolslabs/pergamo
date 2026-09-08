import fs from "fs";
import fs_extra from "fs-extra";
import path from "path";
import mv from "mv";

import Config from '@/shared/config'

const mvAsync = async (origen, destino) => {
  return new Promise((resolve, reject) => {
    mv(origen, destino, { mkdirp: true }, (error) => {
      if (error) {
        reject(error);
      } 
      resolve({});
    });
  });
}

const pathFile = (metadata:any) => {

  const { uuid_sha256, extension, organization } = metadata;

  let pathFile = 
    '/' + uuid_sha256.substring(0,2) + 
    '/' + uuid_sha256.substring(2,6) + 
    '/' + uuid_sha256.substring(6,14) + 
    '/' + uuid_sha256.substring(14) + 
    '/' + uuid_sha256 + '.' + extension;

  return path.join(Config.path_base, organization, pathFile);
}

const mkdir = async (destinationDir) => {

  const dirExists = await fs.promises.access(destinationDir).then(() => true).catch(() => false);

  if (!dirExists) {
    await fs.promises.mkdir(destinationDir, { recursive: true });
  }
}

const rmdir = async (path_base:string, directory:string) => {

  await fs_extra.remove(directory);

  let levels = directory.split(path.sep);
  levels.pop();
  directory = levels.join(path.sep);

  let finish = false;
  while(directory !== path.join(path_base) && !finish) {
    const files = await fs.promises.readdir(directory)
    if (files.length === 0) {
      await fs.promises.rmdir(directory);
      levels = directory.split(path.sep);
      levels.pop();
      directory = levels.join(path.sep);
    } else {
      finish = true;
    }
  }
}


/**
 * multer escribe en data/tmp antes de que el controlador decida nada. En el
 * camino normal el fichero se mueve o se borra, pero un proceso que muere a
 * mitad de peticion deja el temporal ahi para siempre.
 */
const cleanTmp = async (directory:string, maxAgeMs:number) => {

  const exists = await fs.promises.access(directory).then(() => true).catch(() => false);

  if(!exists) return 0;

  const now = Date.now();
  let removed = 0;

  for(const entry of await fs.promises.readdir(directory)) {

    const file = path.join(directory, entry);

    try {

      const stats = await fs.promises.stat(file);

      if(!stats.isFile() || (now - stats.mtimeMs) < maxAgeMs) continue;

      await fs.promises.unlink(file);
      removed++;

    } catch(error) {
      // Una subida en curso puede mover el fichero entre el readdir y el stat:
      // no es un fallo, el objetivo de la limpieza ya se cumple.
      continue;
    }
  }

  return removed;
}

export default {
  pathFile,
  cleanTmp,
  mvAsync,
  mkdir,
  rmdir
}

export { cleanTmp };
