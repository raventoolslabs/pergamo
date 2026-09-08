import fs from "fs";

const HEAD_BYTES = 128;

/**
 * Un documento OpenDocument es un ZIP cuya primera entrada es, por
 * especificacion, un fichero "mimetype" sin comprimir: cabecera local de 30
 * bytes, seguida del nombre "mimetype" (8 bytes) y de su contenido.
 */
const isOpenDocument = (head:Buffer, mimetype:string) => {

  // Firma de cabecera local de ZIP: 50 4B 03 04
  if(head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) return false;
  if(head.subarray(30, 38).toString('latin1') !== 'mimetype') return false;

  return head.subarray(38, 38 + mimetype.length).toString('latin1') === mimetype;
}

const SIGNATURES:{ [mimetype:string]: (head:Buffer) => boolean } = {
  'application/pdf': (head) => head.subarray(0, 5).toString('latin1') === '%PDF-',
  'application/vnd.oasis.opendocument.text': (head) =>
    isOpenDocument(head, 'application/vnd.oasis.opendocument.text'),
  'application/vnd.oasis.opendocument.spreadsheet': (head) =>
    isOpenDocument(head, 'application/vnd.oasis.opendocument.spreadsheet'),
  'application/vnd.oasis.opendocument.presentation': (head) =>
    isOpenDocument(head, 'application/vnd.oasis.opendocument.presentation')
}

const readHead = async (filePath:string) => {

  const handle = await fs.promises.open(filePath, 'r');

  try {

    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);

    return buffer.subarray(0, bytesRead);

  } finally {
    await handle.close();
  }
}

/**
 * El mimetype declarado sale del Content-Type de la peticion, asi que es
 * manipulable: aqui se contrasta con el contenido real.
 *
 * Sin firma conocida devuelve verifiable=false y decide el llamante, para no
 * romper en silencio un VALID_MIMETYPE ampliado por configuracion.
 */
export const verifyMimetype = async (filePath:string, mimetype:string) => {

  const signature = SIGNATURES[mimetype];

  if(!signature) return { verifiable: false, matches: true };

  return { verifiable: true, matches: signature(await readHead(filePath)) };
}

export default { verifyMimetype };
