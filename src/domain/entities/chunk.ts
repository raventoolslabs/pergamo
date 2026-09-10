export type ChunkContentType = 'text' | 'table' | 'code' | 'list';

/**
 * Un bloque del documento convertido, con su procedencia.
 *
 * El conversor no devuelve una cadena de markdown sino esto, porque la pagina y
 * la ruta de encabezados no sobreviven a aplanarlo: son lo que despues permite
 * citar de donde salio cada trozo.
 */
export interface DocumentBlock {
  markdown: string;
  kind: ChunkContentType;
  page?: number;
  headingPath: string[];
}

export interface ConvertedDocument {
  converter: string;
  blocks: DocumentBlock[];
}

export interface Chunk {
  position: number;
  // Ya lleva las migas de pan por delante: es el mismo texto que se guarda y
  // que se embebe, para que no haya dos versiones de lo indexado.
  content: string;
  page?: number;
  section?: string;
  headingPath: string[];
  contentType: ChunkContentType;
}

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}
