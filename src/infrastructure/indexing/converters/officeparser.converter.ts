import { parseOffice, OfficeContentNode, OfficeParserAST, SupportedFileType } from 'officeparser';

import Config from '@/shared/config';
import { ChunkContentType, ConvertedDocument, DocumentBlock } from '@/domain/entities/chunk';
import { ConversionUnsupportedError } from '@/domain/exceptions/indexing.exception';
import { DocumentConverter } from '@/app/ports/services/document-converter.service';

/**
 * Se recorre el AST en vez de pedirle a officeParser el markdown ya montado.
 *
 * La pagina de un PDF, la diapositiva de un PPTX y el nombre de hoja de un XLSX
 * viven en nodos contenedores ('page', 'slide', 'sheet') y desaparecen al
 * aplanar el documento a una cadena. Es lo unico que permite decir despues de
 * que pagina salio cada trozo, y por eso no se usa ast.to('md') ni su troceado
 * nativo, cuyo closestHeading es un titulo suelto y no la ruta de ancestros.
 */
const FILE_TYPE:Record<string, SupportedFileType> = {
  'application/pdf': 'pdf',
  'application/rtf': 'rtf',
  'application/epub+zip': 'epub',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
};

// Aportan ruido y no cuerpo del documento: se repiten en cada pagina o son
// anotaciones de quien lo edito.
const IGNORED = new Set(['header', 'footer', 'comment', 'note', 'slideMaster', 'image', 'chart', 'drawing', 'break']);

interface Heading {
  level: number;
  title: string;
}

interface Walk {
  page?: number;
  headings: Heading[];
}

const clean = (text?:string) => (text || '').replace(/\s+/g, ' ').trim();

/**
 * Pila de niveles: al entrar un encabezado se desapila todo lo que tenga nivel
 * igual o mayor, que es cerrar sus hermanos y descendientes. El resto de la
 * pila es la ruta de ancestros.
 */
const pushHeading = (headings:Heading[], level:number, title:string) => {

  while(headings.length && headings[headings.length - 1].level >= level) headings.pop();

  if(title) headings.push({ level, title });
}

const cellsOf = (row:OfficeContentNode) =>
  (row.children || [])
    .filter((child) => child.type === 'cell')
    .map((cell) => clean(cell.text).replace(/\|/g, '\\|'));

const renderTable = (node:OfficeContentNode) => {

  const rows = (node.children || []).filter((child) => child.type === 'row').map(cellsOf);

  if(!rows.length) return '';

  const width = Math.max(...rows.map((row) => row.length));

  if(!width) return '';

  const line = (row:string[]) =>
    `| ${[...row, ...Array(width - row.length).fill('')].join(' | ')} |`;

  return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
}

const renderList = (node:OfficeContentNode) =>
  (node.children || [])
    .map((child) => clean(child.text))
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join('\n');

const collect = (nodes:OfficeContentNode[], walk:Walk, blocks:DocumentBlock[]) => {

  for(const node of nodes || []) {

    if(IGNORED.has(node.type)) continue;

    const add = (markdown:string, kind:ChunkContentType) => {
      if(markdown.trim()) blocks.push({ markdown, kind, page: walk.page, headingPath: walk.headings.map((h) => h.title) });
    };

    switch(node.type) {

      case 'page':
        walk.page = node.metadata?.pageNumber ?? walk.page;
        collect(node.children, walk, blocks);
        break;

      case 'slide':
        walk.page = node.metadata?.slideNumber ?? walk.page;
        collect(node.children, walk, blocks);
        break;

      // Una hoja es una seccion con nombre, y ademas la unidad por la que se
      // pagina un libro de calculo.
      case 'sheet':
        pushHeading(walk.headings, 1, clean(node.metadata?.sheetName));
        collect(node.children, walk, blocks);
        break;

      case 'heading':
        pushHeading(walk.headings, node.metadata?.level || 1, clean(node.text));
        break;

      case 'table':
        add(renderTable(node), 'table');
        break;

      case 'list':
        add(renderList(node), 'list');
        break;

      case 'code':
        add(node.text || '', 'code');
        break;

      case 'paragraph':
        add(clean(node.text), 'text');
        break;

      default:
        if(node.children?.length) collect(node.children, walk, blocks);
        else add(clean(node.text), 'text');
    }
  }
}

export const officeParserConverter:DocumentConverter = {

  name: 'officeparser',

  supports: (mimetype) => mimetype in FILE_TYPE,

  async convert(filePath, mimetype):Promise<ConvertedDocument> {

    const fileType = FILE_TYPE[mimetype];

    if(!fileType) throw new ConversionUnsupportedError(`No converter for mimetype "${mimetype}"`);

    let ast:OfficeParserAST;

    try {

      ast = await parseOffice(filePath, {
        // El fichero ya paso el antivirus y el filtro de contenido activo, pero
        // sigue siendo entrada no confiable: se le pone tope de tiempo y de
        // descompresion, que es lo que la propia libreria pide hacer.
        fileType,
        abortSignal: AbortSignal.timeout(Config.indexing.convert_timeout),
        decompressionLimits: { maxUncompressedBytes: 268435456, maxZipEntries: 5000 },
        ignoreNotes: true,
        ignoreComments: true,
        ignoreHeadersAndFooters: true,
        outputErrorToConsole: false
      });

    } catch(error:any) {
      throw new ConversionUnsupportedError(
        `Could not parse the document as ${fileType}: ${error.message || error.name}`);
    }

    const blocks:DocumentBlock[] = [];

    collect(ast.content, { headings: [] }, blocks);

    return { converter: this.name, blocks };
  }
};
