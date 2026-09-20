import fs from 'fs';

import Config from '@/shared/config';
import { ChunkContentType, ConvertedDocument, DocumentBlock } from '@/domain/entities/chunk';
import { MARKDOWN_MIMETYPE } from '@/domain/entities/github';
import { ConversionUnsupportedError } from '@/domain/exceptions/indexing.exception';
import { DocumentConverter } from '@/app/ports/services/document-converter.service';

const MIMETYPES = [MARKDOWN_MIMETYPE, 'text/x-markdown'];

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^(```|~~~)/;
const LIST = /^\s{0,3}([-*+]|\d+[.)])\s+/;
const TABLE = /^\s{0,3}\|/;
const FRONT_MATTER = /^---\s*$/;

/**
 * El Markdown ya es el formato de salida del conversor, asi que aqui no hay que
 * convertir nada: hay que trocearlo conservando de que encabezado cuelga cada
 * parte, que es lo unico que aplanarlo a una cadena perderia.
 *
 * A mano y sin libreria: distinguir parrafo, lista, tabla y bloque de codigo son
 * cuatro expresiones regulares, y un arbol completo de Markdown no aporta nada
 * mas a un troceado que solo necesita el texto y sus migas.
 */
const blocksOf = (markdown:string):DocumentBlock[] => {

  const blocks:DocumentBlock[] = [];
  const headings:{ level:number; title:string }[] = [];

  let buffer:string[] = [];
  let kind:ChunkContentType = 'text';

  const flush = () => {

    const text = buffer.join('\n').trim();
    buffer = [];

    if(text) blocks.push({ markdown: text, kind, headingPath: headings.map((heading) => heading.title) });
  };

  const lines = markdown.split(/\r?\n/);
  let index = 0;

  // El front matter es metadatos del fichero, no cuerpo del documento.
  if(lines.length && FRONT_MATTER.test(lines[0])) {
    index = lines.findIndex((line, position) => position > 0 && FRONT_MATTER.test(line));
    index = index < 0 ? lines.length : index + 1;
  }

  for(; index < lines.length; index++) {

    const line = lines[index];

    // El bloque de codigo se toma entero y sin interpretar: dentro hay
    // almohadillas y guiones que no son encabezados ni listas.
    if(FENCE.test(line)) {

      flush();
      kind = 'code';
      buffer.push(line);

      for(index++; index < lines.length && !FENCE.test(lines[index]); index++) buffer.push(lines[index]);

      if(index < lines.length) buffer.push(lines[index]);

      flush();
      kind = 'text';
      continue;
    }

    const heading = HEADING.exec(line);

    if(heading) {

      flush();
      kind = 'text';

      const level = heading[1].length;
      // Pila de niveles: al entrar un encabezado se cierran sus hermanos y
      // descendientes, y lo que queda es la ruta de ancestros.
      while(headings.length && headings[headings.length - 1].level >= level) headings.pop();

      const title = heading[2].replace(/#+\s*$/, '').trim();
      if(title) headings.push({ level, title });

      continue;
    }

    if(!line.trim()) {
      flush();
      kind = 'text';
      continue;
    }

    const current:ChunkContentType = TABLE.test(line) ? 'table' : LIST.test(line) ? 'list' : 'text';

    // Una linea suelta de una lista o de una tabla no vale por si sola: se
    // acumulan con las suyas, y un cambio de tipo cierra lo anterior.
    if(buffer.length && current !== kind) flush();

    kind = buffer.length ? kind : current;
    buffer.push(line);
  }

  flush();

  return blocks;
};

export const markdownConverter:DocumentConverter = {

  name: 'markdown',

  supports: (mimetype) => MIMETYPES.includes(mimetype),

  async convert(filePath):Promise<ConvertedDocument> {

    const { size } = await fs.promises.stat(filePath);

    // Entrada no confiable, como en el resto de conversores: un fichero mayor
    // del tope no se carga en memoria para trocearlo.
    if(size > Config.max_file_size) throw new ConversionUnsupportedError(
      `The markdown file exceeds MAX_FILE_SIZE (${size} bytes)`);

    return { converter: this.name, blocks: blocksOf(await fs.promises.readFile(filePath, 'utf8')) };
  }
};
