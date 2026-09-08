import crypto from "crypto";
import fs from "fs";

export const sha256 = async(str:string ) => {

  const hash = crypto.createHash('sha256');
  hash.update(str);
  return hash.digest('hex');
}

/**
 * Compara dos cadenas en tiempo constante. Ambas se reducen antes a un digest
 * de longitud fija para no filtrar la longitud del secreto y para que
 * timingSafeEqual no falle con entradas de distinto tamaño.
 */
export const timingSafeEqualStr = (a:string, b:string) => {

  const digestA = crypto.createHash('sha256').update(String(a)).digest();
  const digestB = crypto.createHash('sha256').update(String(b)).digest();

  return crypto.timingSafeEqual(digestA, digestB);
}

export const sha256File = async(filePath:string ) => {

  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);
    const hash = crypto.createHash('sha256');

    fileStream.on('data', (data) => {
      hash.update(data);
    });

    fileStream.on('end', () => {
      const fileHash = hash.digest('hex');
      resolve(fileHash);
    });

    fileStream.on('error', (error) => {
      reject(error);
    });
  });
}