import fs from "fs";
import zlib from "zlib";

const HEAD_BYTES = 128;

// Topes frente a un ZIP hostil: el [Content_Types].xml de un OOXML real son
// unos pocos kilobytes.
const MAX_ENTRY_BYTES = 1048576;

const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_STORED = 0;
const ZIP_DEFLATE = 8;
// Bit 3 de la mascara: los tamanos no estan en la cabecera, sino en un
// descriptor al final de la entrada.
const ZIP_DATA_DESCRIPTOR = 0x0008;

const OOXML_ENTRY = '[Content_Types].xml';

const isZip = (head:Buffer) =>
  head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;

/**
 * Un documento OpenDocument es un ZIP cuya primera entrada es, por
 * especificacion, un fichero "mimetype" sin comprimir: cabecera local de 30
 * bytes, seguida del nombre "mimetype" (8 bytes) y de su contenido. Un EPUB
 * usa exactamente la misma convencion.
 */
const isOpenDocument = (head:Buffer, mimetype:string) => {

  if(!isZip(head)) return false;
  if(head.subarray(30, 38).toString('latin1') !== 'mimetype') return false;

  return head.subarray(38, 38 + mimetype.length).toString('latin1') === mimetype;
}

/**
 * Devuelve el contenido de la primera entrada del ZIP si es el
 * [Content_Types].xml de OOXML, y null si no se puede afirmar.
 *
 * Hace falta descomprimirla porque la cabecera solo distingue la familia: que
 * sea DOCX, XLSX o PPTX lo dice el content type real, que viaja comprimido.
 */
const readContentTypes = async (filePath:string) => {

  const handle = await fs.promises.open(filePath, 'r');

  try {

    const header = Buffer.alloc(30);
    const { bytesRead } = await handle.read(header, 0, 30, 0);

    if(bytesRead < 30 || header.readUInt32LE(0) !== ZIP_LOCAL_HEADER) return null;

    const flags = header.readUInt16LE(6);
    const method = header.readUInt16LE(8);
    const compressedSize = header.readUInt32LE(18);
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);

    if(nameLength !== OOXML_ENTRY.length) return null;

    const name = Buffer.alloc(nameLength);
    await handle.read(name, 0, nameLength, 30);

    if(name.toString('latin1') !== OOXML_ENTRY) return null;

    // Sin tamano en la cabecera la entrada solo se puede leer recorriendo el
    // directorio central; fail-closed, se rechaza.
    if((flags & ZIP_DATA_DESCRIPTOR) || compressedSize === 0 || compressedSize > MAX_ENTRY_BYTES) return null;

    const entry = Buffer.alloc(compressedSize);
    await handle.read(entry, 0, compressedSize, 30 + nameLength + extraLength);

    if(method === ZIP_STORED) return entry.toString('latin1');
    if(method !== ZIP_DEFLATE) return null;

    return zlib.inflateRawSync(entry, { maxOutputLength: MAX_ENTRY_BYTES }).toString('latin1');

  } catch {
    // Un inflado que revienta o un desplazamiento fuera del fichero significan
    // que esto no es el OOXML que dice ser.
    return null;

  } finally {
    await handle.close();
  }
}

const isOoxml = async (head:Buffer, filePath:string, marker:string) => {

  if(!isZip(head)) return false;

  const contentTypes = await readContentTypes(filePath);

  return contentTypes !== null && contentTypes.includes(marker);
}

/**
 * Firma por mimetype. Devolver false es rechazar: verifyMimetype solo considera
 * verificable lo que aparezca aqui, y el llamante trata lo no verificable como
 * un 400.
 *
 * HTML, Markdown, CSV y texto plano no estan, y no es un olvido: no tienen
 * magic bytes, asi que no hay nada que contrastar con el mimetype declarado.
 * Anadirlos a VALID_MIMETYPE sin resolver esto los rechazaria con un 400
 * confuso.
 */
const SIGNATURES:{ [mimetype:string]: (head:Buffer, filePath:string) => boolean | Promise<boolean> } = {
  'application/pdf': (head) => head.subarray(0, 5).toString('latin1') === '%PDF-',
  'application/rtf': (head) => head.subarray(0, 6).toString('latin1') === '{\\rtf1',

  'application/vnd.oasis.opendocument.text': (head) =>
    isOpenDocument(head, 'application/vnd.oasis.opendocument.text'),
  'application/vnd.oasis.opendocument.spreadsheet': (head) =>
    isOpenDocument(head, 'application/vnd.oasis.opendocument.spreadsheet'),
  'application/vnd.oasis.opendocument.presentation': (head) =>
    isOpenDocument(head, 'application/vnd.oasis.opendocument.presentation'),
  'application/epub+zip': (head) =>
    isOpenDocument(head, 'application/epub+zip'),

  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (head, filePath) =>
    isOoxml(head, filePath, 'wordprocessingml.document.main+xml'),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (head, filePath) =>
    isOoxml(head, filePath, 'spreadsheetml.sheet.main+xml'),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': (head, filePath) =>
    isOoxml(head, filePath, 'presentationml.presentation.main+xml')
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

  return { verifiable: true, matches: await signature(await readHead(filePath), filePath) };
}

export default { verifyMimetype };
