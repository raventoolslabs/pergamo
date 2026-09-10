import Config from '@/shared/config';
import { Chunk, ChunkContentType, ConvertedDocument, DocumentBlock } from '@/domain/entities/chunk';
import { ConversionUnsupportedError } from '@/domain/exceptions/indexing.exception';
import { Chunker } from '@/app/ports/services/chunker.service';

/**
 * Propio y versionado, y sobre los bloques del AST en vez de sobre una cadena
 * de markdown: aplanar el documento pierde la pagina y la ruta de encabezados,
 * que es justo lo que permite citar de donde salio cada trozo.
 *
 * Cambiar esta constante marca los documentos existentes como reindexables.
 */
export const CHUNKER_VERSION = 'v1';

const BREADCRUMB = ' > ';
const JOIN = '\n\n';

// De mayor a menor: parrafo, linea, palabra. Agotados, corte duro.
const SEPARATORS = [JOIN, '\n', ' '];

// Con encabezados muy anidados las migas se comen el presupuesto entero; por
// debajo de esto se prefiere un trozo mas largo a uno sin texto.
const MIN_BUDGET = 200;

const sameSection = (a:string[], b:string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const withBreadcrumb = (headingPath:string[], body:string) =>
  headingPath.length ? `${headingPath.join(BREADCRUMB)}${JOIN}${body}` : body;

const budgetFor = (headingPath:string[], size:number) => {
  const cost = headingPath.length ? headingPath.join(BREADCRUMB).length + JOIN.length : 0;
  return Math.max(MIN_BUDGET, size - cost);
}

const hardCut = (text:string, budget:number, overlap:number) => {

  const pieces:string[] = [];
  const step = Math.max(1, budget - overlap);

  for(let start = 0; start < text.length; start += step) {
    pieces.push(text.slice(start, start + budget));
    if(start + budget >= text.length) break;
  }

  return pieces;
}

/**
 * Corte recursivo: se prueba el separador mas grande, y lo que aun no quepa se
 * reintenta con el siguiente. El solapamiento solo se aplica en el corte duro,
 * que es el unico que parte por un sitio arbitrario; entre parrafos la
 * frontera ya es natural y repetirlos solo duplica texto.
 */
const splitText = (text:string, budget:number, overlap:number, separators = SEPARATORS):string[] => {

  const trimmed = text.trim();

  if(!trimmed) return [];
  if(trimmed.length <= budget) return [trimmed];

  const [separator, ...rest] = separators;

  if(separator === undefined) return hardCut(trimmed, budget, overlap);

  const parts = trimmed.split(separator);

  if(parts.length === 1) return splitText(trimmed, budget, overlap, rest);

  const pieces:string[] = [];
  let buffer = '';

  const flush = () => {
    if(buffer.trim()) pieces.push(buffer.trim());
    buffer = '';
  };

  for(const part of parts) {

    if(part.length > budget) {
      flush();
      pieces.push(...splitText(part, budget, overlap, rest));
      continue;
    }

    const candidate = buffer ? buffer + separator + part : part;

    if(candidate.length <= budget) {
      buffer = candidate;
      continue;
    }

    flush();
    buffer = part;
  }

  flush();

  return pieces;
}

const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

/**
 * Una tabla se parte por filas REPITIENDO la cabecera: partirla sin ella
 * produce trozos de numeros sin nombre, que no significan nada ni para quien
 * busca ni para el modelo.
 */
const splitTable = (markdown:string, budget:number, overlap:number) => {

  const lines = markdown.split('\n').filter((line) => line.trim().length);
  const separator = lines.findIndex((line) => TABLE_SEPARATOR.test(line));

  // Sin fila de separadores no es una tabla que sepamos partir.
  if(separator < 1) return splitText(markdown, budget, overlap);

  const header = lines.slice(0, separator + 1).join('\n');
  const rows = lines.slice(separator + 1);

  if(header.length >= budget) return splitText(markdown, budget, overlap);

  const pieces:string[] = [];
  let current = header;

  for(const row of rows) {

    if(current !== header && current.length + 1 + row.length > budget) {
      pieces.push(current);
      current = header;
    }

    current += `\n${row}`;
  }

  if(current !== header) pieces.push(current);

  return pieces.length ? pieces : [header];
}

interface Pending {
  headingPath: string[];
  page?: number;
  kind: ChunkContentType;
  text: string;
}

const pieceOf = (block:DocumentBlock, budget:number, overlap:number) => {

  const body = block.markdown.trim();

  if(!body) return [];
  if(body.length <= budget) return [body];

  return block.kind === 'table' ?
    splitTable(body, budget, overlap) :
    splitText(body, budget, overlap);
}

export const chunker:Chunker = {

  name: 'pergamo',
  version: CHUNKER_VERSION,

  split(document:ConvertedDocument):Chunk[] {

    const { chunk_size: size, chunk_overlap: overlap, max_chunks: max } = Config.indexing;

    const chunks:Chunk[] = [];
    let pending:Pending = null;

    const push = () => {

      if(!pending) return;

      if(chunks.length >= max) throw new ConversionUnsupportedError(
        `Document produces more than ${max} chunks: raise INDEX_MAX_CHUNKS or review the extraction`);

      chunks.push({
        position: chunks.length,
        content: withBreadcrumb(pending.headingPath, pending.text),
        page: pending.page,
        section: pending.headingPath.length ? pending.headingPath[pending.headingPath.length - 1] : undefined,
        headingPath: pending.headingPath,
        contentType: pending.kind
      });

      pending = null;
    };

    for(const block of document.blocks) {

      const budget = budgetFor(block.headingPath, size);

      // Cambiar de seccion cierra el trozo: mezclar dos secciones en uno deja
      // migas de pan que no describen la mitad del texto.
      //
      // Cambiar de pagina tambien, y por un motivo distinto: `page` es una
      // cita. Un trozo que cruza la frontera solo puede citar una de las dos, y
      // una cita incorrecta es peor que un trozo mas corto.
      if(pending && (!sameSection(pending.headingPath, block.headingPath) || pending.page !== block.page)) push();

      for(const piece of pieceOf(block, budget, overlap)) {

        const joinable = pending &&
          pending.kind === block.kind &&
          pending.text.length + JOIN.length + piece.length <= budget;

        if(joinable) {
          pending.text += JOIN + piece;
          continue;
        }

        push();

        // La pagina del trozo es la del primer bloque que lo compone: es de
        // donde empieza a leerse.
        pending = { headingPath: block.headingPath, page: block.page, kind: block.kind, text: piece };
      }
    }

    push();

    return chunks;
  }
};
