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
 * Campos cuyo valor es, por definicion, un array de numeros. Cada uno es una
 * regla con su nombre, para que la firma diga cual fue y para que un despliegue
 * pueda desactivar solo el que le estorbe.
 */
const NUMBER_ARRAYS = ['FontMatrix', 'BBox', 'Matrix', 'Coords', 'Rect'];

/**
 * Hay claves que condenan por estar y claves que solo condenan por lo que
 * valen. `pattern` encuentra a las candidatas; `refine`, cuando existe, decide.
 */
interface Rule {
  name: string;
  pattern: RegExp;
  refine?: (text:string) => boolean;
  /** 'strings' para lo que vive DENTRO de una cadena, como el esquema de una
      URI. El resto lee la vista sin cadenas, donde un nombre PDF si es un
      token. */
  reads?: 'strings';
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
    pattern: new RegExp(`\\/(?:SubmitForm|ImportData|ResetForm)${NAME_END}`),
    why: 'form data submission, import or reset'
  },
  {
    name: 'XFA',
    pattern: new RegExp(`\\/XFA${NAME_END}`),
    why: 'XFA form, which carries its own logic'
  },
  {
    name: 'JavaScriptURI',
    // Sin NAME_END: no es un nombre PDF sino el esquema de una URI, y por eso
    // se lee el texto con sus cadenas.
    pattern: /javascript:/i,
    reads: 'strings',
    why: 'URI with a javascript: scheme'
  },
  {
    name: 'DataURI',
    // Un `data:text/html` es una pagina entera dentro del enlace: en un visor
    // web se abre en el origen del propio visor.
    pattern: /data:text\/html/i,
    reads: 'strings',
    why: 'URI that carries an HTML document inline'
  },
  {
    name: 'MediaAction',
    // Anclada en `/S`, que es donde vive el subtipo de una accion. Sin el ancla,
    // un enlace a `https://wiki.debian.org/Sound` bastaria para retener un
    // manual entero: el nombre tambien aparece dentro de las cadenas.
    pattern: /\/S\s*\/(?:Movie|Sound|Rendition|SetOCGState|GoTo3DView)(?![A-Za-z0-9#])/,
    why: 'action that plays media or changes the viewer state'
  },
  ...NUMBER_ARRAYS.map((field):Rule => ({
    name: field,
    pattern: new RegExp(`\\/${field}${NAME_END}`),
    refine: (text) => arrayCarriesMore(text, field),
    why: `${field} array with something other than numbers, which the viewer runs`
  }))
];

// Subtipos de accion que no ejecutan nada dentro del visor: abrir un enlace es
// lo que hace un documento normal.
const INERT_ACTIONS = ['URI', 'URL'];

const OPEN_ACTION = new RegExp(`\\/OpenAction${NAME_END}\\s*`, 'g');

const INDIRECT = /^(\d+)\s+(\d+)\s+R(?![A-Za-z0-9])/;

/**
 * Sigue una referencia indirecta buscando su `N M obj` en el texto. No es un
 * parser: si el objeto vive dentro de un flujo de objetos no lleva cabecera y
 * no aparece, y entonces devuelve null.
 */
const resolve = (text:string, value:string) => {

  const reference = INDIRECT.exec(value);

  if(!reference) return null;

  const object = new RegExp(`(?:^|[^0-9])${reference[1]}\\s+${reference[2]}\\s+obj\\s*`, 'm').exec(text);

  return object ? text.slice(object.index + object[0].length, object.index + object[0].length + 512) : null;
}

/**
 * `/OpenAction` no es contenido activo por si sola: `/OpenAction[1 0 R /XYZ
 * null null 0]` es un DESTINO —«abrete en esta pagina»— y lo emite cualquier
 * suite ofimatica. Lo ejecutable es el diccionario `/OpenAction<</S/...>>`, y
 * ahi manda su subtipo.
 *
 * Una referencia indirecta se sigue, y si no se puede seguir no se marca: LaTeX
 * escribe `/OpenAction 98 0 R` para decir por que pagina abrirse, y condenarlo
 * retenia manuales enteros. No abre un agujero, porque los subtipos que de
 * verdad ejecutan —JavaScript, Launch, SubmitForm, XFA, los de MediaAction—
 * tienen cada uno su regla por presencia.
 */
const openActionExecutes = (text:string) => {

  for(const match of text.matchAll(OPEN_ACTION)) {

    const direct = text.slice(match.index + match[0].length, match.index + match[0].length + 512);
    const value = INDIRECT.test(direct) ? resolve(text, direct) : direct;

    if(value === null || value.startsWith('[')) continue;

    if(value.startsWith('<<')) {

      const subtype = value.match(/\/S\s*\/([A-Za-z0-9#]+)/);

      if(subtype && INERT_ACTIONS.includes(subtype[1])) continue;
    }

    return true;
  }

  return false;
}

// Numeros con signo, decimales y exponente. Nada mas.
const ONLY_NUMBERS = /^[\s\d.+\-eE]*$/;

const FIELD_PATTERN = new Map(NUMBER_ARRAYS.map((field) =>
  [field, new RegExp(`\\/${field}${NAME_END}\\s*`, 'g')]));

/**
 * Estas claves las lleva cualquier documento —`/Rect` va en cada anotacion—,
 * asi que condena el valor y no la clave: lo que no sea un array de numeros
 * llega al codigo que el visor genera con ellos, que es CVE-2024-4367 y su
 * familia. `payload8.pdf` del corpus ejecuta asi, sin `/JavaScript` ni
 * `/OpenAction`.
 *
 * Una referencia indirecta tambien se marca: sobre PDF corrientes estas claves
 * aparecieron 5.073 veces y ninguna lo era, y sin parser que la siga, mover el
 * array a otro objeto esquivaria la regla con una linea.
 */
const arrayCarriesMore = (text:string, field:string) => {

  const pattern = FIELD_PATTERN.get(field)!;

  pattern.lastIndex = 0;

  for(const match of text.matchAll(pattern)) {

    const value = text.slice(match.index + match[0].length, match.index + match[0].length + 512);

    if(!value.startsWith('[')) return true;

    const close = value.indexOf(']');

    if(close === -1 || !ONLY_NUMBERS.test(value.slice(1, close))) return true;
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
 * Una imagen o una tipografia son ruido: entre sus bytes cae `/JS` por azar, y
 * eso retenia un manual de Debian. Se mira si el contenido parece texto —donde
 * viven los diccionarios, los flujos de objetos y el propio JavaScript— y lo
 * que no lo parezca no se examina.
 */
const looksTextual = (part:string) => {

  const sample = part.slice(0, 4096);

  if(!sample.length) return false;

  let printable = 0;

  for(let index = 0; index < sample.length; index += 1) {

    const code = sample.charCodeAt(index);

    if(code === 9 || code === 10 || code === 13 || (code >= 32 && code < 127)) printable += 1;
  }

  return printable / sample.length >= .85;
};

const inflated = (content:Buffer, room:number) => {

  for(const inflate of [zlib.inflateSync, zlib.inflateRawSync]) {

    try {
      return inflate(content, { maxOutputLength: room }).toString('latin1');
    } catch {
      // Ni zlib ni deflate crudo: o no esta comprimido, o no nos incumbe.
    }
  }

  return null;
};

/**
 * El texto que se examina: todo lo que hay fuera de los flujos —diccionarios,
 * xref, trailer— mas el contenido de cada flujo que parezca texto, inflado si
 * viene comprimido. Sin inflar, payload8.pdf del corpus pasa limpio; sin
 * descartar lo binario, pasan por contenido activo documentos que no lo son.
 */
const readableParts = (buffer:Buffer) => {

  const parts:string[] = [];

  let total = 0;
  let cursor = 0;
  let plain = 0;

  while(cursor < buffer.length && total < MAX_INFLATED_TOTAL) {

    const start = buffer.indexOf(STREAM_OPEN, cursor);

    if(start === -1) break;

    const end = buffer.indexOf(STREAM_CLOSE, start);

    if(end === -1) break;

    parts.push(buffer.toString('latin1', plain, start + STREAM_OPEN.length));

    cursor = end + STREAM_CLOSE.length;
    plain = end;

    // Tras la palabra 'stream' va EOL: CRLF o LF, nunca CR solo.
    let data = start + STREAM_OPEN.length;

    if(buffer[data] === 0x0d) data++;
    if(buffer[data] === 0x0a) data++;

    if(end - data <= 0 || end - data > MAX_STREAM_INPUT) continue;

    const content = buffer.subarray(data, end);
    const readable = inflated(content, MAX_INFLATED_TOTAL - total) ?? content.toString('latin1');

    if(!looksTextual(readable)) continue;

    total += readable.length;
    parts.push(readable);
  }

  parts.push(buffer.toString('latin1', plain));

  return parts.join('\n');
};

// Una cadena literal larguisima sin cerrar es un fichero roto, no una cadena:
// tragarse el resto del documento por ella seria perder lo que queda por mirar.
const MAX_STRING = 64 * 1024;

/**
 * Vacia las cadenas literales. Un nombre PDF es un token y no puede estar
 * dentro de una: `(https://es.wikipedia.org/wiki/JavaScript)` es un enlace en
 * un manual, y con el se retenia el manual entero.
 */
const withoutStrings = (text:string) => {

  const parts:string[] = [];

  let cursor = 0;

  while(cursor < text.length) {

    const open = text.indexOf('(', cursor);

    if(open === -1) { parts.push(text.slice(cursor)); break; }

    parts.push(text.slice(cursor, open + 1));

    let index = open + 1;
    let depth = 1;

    while(index < text.length && depth && index - open < MAX_STRING) {

      const char = text[index];

      if(char === '\\') index += 2;
      else { if(char === '(') depth += 1; else if(char === ')') depth -= 1; index += 1; }
    }

    // Sin cierre a la vista se toma el parentesis por un byte cualquiera.
    cursor = depth ? open + 1 : index;

    if(!depth) parts.push(')');
  }

  return parts.join('');
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
  const text = decodeNameEscapes(readableParts(buffer));
  const tokens = withoutStrings(text);

  const ignored = Config.malicious_active_content_ignore;

  const markers = RULES
    .filter((rule) => {

      const source = rule.reads === 'strings' ? text : tokens;

      return !ignored.includes(rule.name) && rule.pattern.test(source)
        && (!rule.refine || rule.refine(source));
    })
    .map((rule) => rule.name);

  return { active: markers.length > 0, markers };
};

/** Texto de la firma que se guarda en scan_signature. */
export const activeContentSignature = (markers:string[]) => `ACTIVE_CONTENT: ${markers.join(', ')}`;

export const activeContentRules = () => RULES.map(({ name, why }) => ({ name, why }));

export default { detectActiveContent, activeContentSignature, activeContentRules };
