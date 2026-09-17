import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import Config from '@/shared/config';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

// La longitud la garantiza la validacion de configuracion al arrancar.
const key = () => {

  if(!Config.secret_key) throw new Error('SECRET_KEY is not configured');

  return Buffer.from(Config.secret_key, 'base64');
};

/** AES-256-GCM en formato `iv:tag:data`, cada parte en base64. */
export const seal = (plain:string):string => {

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join(':');
};

// Con otra clave o un texto manipulado la etiqueta GCM no cuadra y final() lanza.
export const open = (sealed:string):string => {

  const [iv, tag, data] = sealed.split(':').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
};
