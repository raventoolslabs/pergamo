import fs from 'fs';
import zlib from 'zlib';

import Config from '@/shared/config';

/**
 * Deteccion de contenido activo en un PDF.
 *
 * ClamAV busca firmas de codigo malicioso conocido, y un PDF con `/OpenAction`
 * que ejecuta JavaScript no lo es: sobre el corpus de test/assets/payloads/
 * reconoce uno de once ficheros.
 *
 * Busca marcadores estructurales en los bytes, flujos Flate incluidos, pero no
 * interpreta el PDF: sin parser ni motor de JavaScript, un fichero preparado
 * para esquivarlo lo esquiva. Es un filtro, no un veredicto de seguridad.
 */

export interface ActiveContentResult {
  active: boolean;
  /** Nombres de regla disparados, ordenados. Van a scan_signature. */
  markers: string[];
}

/**
 * El nombre se guarda y se puede desactivar por configuracion
 * (MALICIOUS_ACTIVE_CONTENT_IGNORE): es parte del contrato.
 *
 * El patron exige que el nombre PDF acabe en delimitador, de modo que
 * `/AAAAAA` —un nombre de tipografia normal— no pase por `/AA`. Ese falso
 * positivo lo dan test/assets/test.pdf y test2.pdf.
 */
const NAME_END = '(?![A-Za-z0-9#])';

/**
 * Hay claves que condenan por estar y claves que solo condenan por lo que
 * valen. `pattern` encuentra a las candidatas; `refine`, cuando existe, decide.
 */
interface Rule {
  name: string;
  pattern: RegExp;
  refine?: (text:string) => boolean;
  why: string;
}

const RULES:Rule[] = [
  {
    name: 'JavaScript',
    pattern: new RegExp(`\\/(?:JavaScript|JS)${NAME_END}`),
    why: 'JavaScript embedded in the document'
  },
  {
    name: 'OpenAction',
    pattern: new RegExp(`\\/OpenAction${NAME_END}`),
    refine: (text) => openActionExecutes(text),
    why: 'action triggered when the document is opened'
  },
  {
    name: 'AdditionalAction',
    pattern: new RegExp(`\\/AA${NAME_END}`),
    why: 'additional actions bound to pages, fields or annotations'
  },
  {
    name: 'Launch',
    pattern: new RegExp(`\\/Launch${NAME_END}`),
    why: 'launches an external application'
  },
  {
    name: 'EmbeddedFile',
    pattern: new RegExp(`\\/EmbeddedFiles?${NAME_END}`),
    why: 'file embedded inside the document'
  },
  {
    name: 'RichMedia',
    pattern: new RegExp(`\\/RichMedia${NAME_END}`),
    why: 'executable multimedia content (Flash, scripted video)'
  },
  {
    name: 'RemoteGoTo',
    pattern: new RegExp(`\\/GoTo(?:R|E)${NAME_END}`),
    why: 'jump to a destination in another file'
  },
  {
    name: 'SubmitForm',
    pattern: new RegExp(`\\/(?:SubmitForm|ImportData)${NAME_END}`),
    why: 'form data submission or import'
  },
  {
    name: 'XFA',
    pattern: new RegExp(`\\/XFA${NAME_END}`),
    why: 'XFA form, which carries its own logic'
  },
  {
    name: 'JavaScriptURI',
    // Sin NAME_END: no es un nombre PDF sino el esquema de una URI.
    pattern: /javascript:/i,
    why: 'URI with a javascript: scheme'
  }
];

// Subtipos de accion que no ejecutan nada dentro del visor: abrir un enlace es
// lo que hace un documento normal.
const INERT_ACTIONS = ['URI', 'URL'];

const OPEN_ACTION = new RegExp(`\\/OpenAction${NAME_END}\\s*`, 'g');

/**
 * `/OpenAction` no es contenido activo por si sola: `/OpenAction[1 0 R /XYZ
 * null null 0]` es un DESTINO —«abrete en esta pagina»— y lo emite cualquier
 * suite ofimatica. Lo ejecutable es el diccionario `/OpenAction<</S/...>>`, y
 * ahi manda su subtipo.
 *
 * Ante una referencia indirecta se marca: seguirla exige un parser, y este
 * modulo no lo tiene. Falso positivo antes que falso negativo.
 *
 * Que el refinamiento se equivoque a la baja no abre un agujero: los subtipos
 * que de verdad ejecutan —JavaScript, Launch, SubmitForm, XFA— tienen cada uno
 * su propia regla por presencia.
 */
const openActionExecutes = (text:string) => {

  for(const match of text.matchAll(OPEN_ACTION)) {

    const value = text.slice(match.index + match[0].length).slice(0, 512);

    if(value.startsWith('[')) continue;

    if(value.startsWith('<<')) {

      const subtype = value.match(/\/S\s*\/([A-Za-z0-9#]+)/);

      if(subtype && INERT_ACTIONS.includes(subtype[1])) continue;
    }

    return true;
  }

  return false;
}

// `/J#61vaScript` es `/JavaScript` para cualquier visor: sin deshacer los
// escapes hexadecimales, el filtro se esquiva cambiando una letra por su codigo.
const decodeNameEscapes = (text:string) =>
  text.replace(/#([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

// Tope frente a bombas de descompresion. El fichero no se rechaza por pasarse
// —seguiria siendo un PDF valido—, pero lo que no cabe aqui no se examina.
const MAX_STREAM_INPUT = 8 * 1024 * 1024;
const MAX_INFLATED_TOTAL = 64 * 1024 * 1024;

const STREAM_OPEN = Buffer.from('stream', 'latin1');
const STREAM_CLOSE = Buffer.from('endstream', 'latin1');

/**
 * Descomprime los flujos Flate y devuelve su contenido concatenado. No se
 * localizan los objetos: se recorren los pares stream/endstream y se intenta
 * inflar cada bloque en sus dos formas. Lo que no infla se descarta: un flujo
 * JPEG tampoco es contenido activo.
 *
 * Sin esta pasada, payload8.pdf del corpus pasa limpio.
 */
const inflateStreams = (buffer:Buffer) => {

  const parts:string[] = [];

  let total = 0;
  let cursor = 0;

  while(cursor < buffer.length && total < MAX_INFLATED_TOTAL) {

    const start = buffer.indexOf(STREAM_OPEN, cursor);

    if(start === -1) break;

    const end = buffer.indexOf(STREAM_CLOSE, start);

    if(end === -1) break;

    cursor = end + STREAM_CLOSE.length;

    // Tras la palabra 'stream' va EOL: CRLF o LF, nunca CR solo.
    let data = start + STREAM_OPEN.length;

    if(buffer[data] === 0x0d) data++;
    if(buffer[data] === 0x0a) data++;

    if(end - data <= 0 || end - data > MAX_STREAM_INPUT) continue;

    const compressed = buffer.subarray(data, end);

    for(const inflate of [zlib.inflateSync, zlib.inflateRawSync]) {

      try {

        const output = inflate(compressed, { maxOutputLength: MAX_INFLATED_TOTAL - total });

        total += output.length;
        parts.push(output.toString('latin1'));

        break;

      } catch {
        // Ni zlib ni deflate crudo: no era un flujo que nos incumba.
      }
    }
  }

  return parts.join('\n');
};

/**
 * Solo se examinan los mimetypes cuya estructura se sabe leer. Para el resto
 * `active: false` no significa «no tiene contenido activo» sino «aqui no se ha
 * mirado»: un ODT puede llevar macros y todavia no se buscan.
 */
export const detectActiveContent = async (filePath:string, mimetype:string):Promise<ActiveContentResult> => {

  if(mimetype !== 'application/pdf') return { active: false, markers: [] };

  const buffer = await fs.promises.readFile(filePath);

  // latin1 mapea byte a caracter sin perder ninguno, que es lo que hace falta
  // para buscar marcadores ASCII sobre datos binarios.
  const text = decodeNameEscapes(buffer.toString('latin1')) + '\n' +
    decodeNameEscapes(inflateStreams(buffer));

  const ignored = Config.malicious_active_content_ignore;

  const markers = RULES
    .filter((rule) => !ignored.includes(rule.name) && rule.pattern.test(text)
      && (!rule.refine || rule.refine(text)))
    .map((rule) => rule.name);

  return { active: markers.length > 0, markers };
};

/** Texto de la firma que se guarda en scan_signature. */
export const activeContentSignature = (markers:string[]) => `ACTIVE_CONTENT: ${markers.join(', ')}`;

export const activeContentRules = () => RULES.map(({ name, why }) => ({ name, why }));

export default { detectActiveContent, activeContentSignature, activeContentRules };
