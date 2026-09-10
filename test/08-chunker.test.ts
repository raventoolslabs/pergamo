import Config from '@/shared/config';
import { chunker } from '@/infrastructure/indexing/chunker';
import { ConversionUnsupportedError } from '@/domain/exceptions/indexing.exception';
import { ChunkContentType, ConvertedDocument, DocumentBlock } from '@/domain/entities/chunk';

const block = (markdown:string, headingPath:string[] = [], kind:ChunkContentType = 'text', page?:number):DocumentBlock =>
  ({ markdown, headingPath, kind, page });

const document = (...blocks:DocumentBlock[]):ConvertedDocument =>
  ({ converter: 'test', blocks });

// El chunker lee los tamanos de la configuracion en cada llamada: fijarlos aqui
// mantiene las pruebas independientes del .env con el que se ejecuten.
const withSizes = <T>(size:number, overlap:number, max:number, run:() => T):T => {

  const original = { ...Config.indexing };

  Object.assign(Config.indexing, { chunk_size: size, chunk_overlap: overlap, max_chunks: max });

  try {
    return run();
  } finally {
    Object.assign(Config.indexing, original);
  }
}

const split = (doc:ConvertedDocument, size = 300, overlap = 50, max = 2000) =>
  withSizes(size, overlap, max, () => chunker.split(doc));

describe('Chunker', () => {

  it('Should return nothing for an empty document', () => {

    expect(split(document())).toEqual([]);
    expect(split(document(block('   \n  ')))).toEqual([]);
  });

  it('Should keep a small document in a single chunk', () => {

    const chunks = split(document(block('Un parrafo corto.', ['Guia'])));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].position).toBe(0);
    expect(chunks[0].section).toBe('Guia');
    expect(chunks[0].headingPath).toEqual(['Guia']);
  });

  it('Should prefix every chunk with its heading path', () => {

    const chunks = split(document(block('Texto.', ['Guia', 'Instalacion', 'Docker'])));

    expect(chunks[0].content).toBe('Guia > Instalacion > Docker\n\nTexto.');
  });

  it('Should not prefix anything when there is no heading', () => {

    expect(split(document(block('Texto suelto.')))[0].content).toBe('Texto suelto.');
  });

  it('Should start a new chunk when the section changes', () => {

    const chunks = split(document(
      block('Primero.', ['A']),
      block('Segundo.', ['B'])));

    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.section)).toEqual(['A', 'B']);
    expect(chunks.map((chunk) => chunk.position)).toEqual([0, 1]);
  });

  it('Should pack consecutive blocks of the same section', () => {

    const chunks = split(document(
      block('Primero.', ['A']),
      block('Segundo.', ['A'])));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('A\n\nPrimero.\n\nSegundo.');
  });

  it('Should respect the size budget, breadcrumbs included', () => {

    const paragraphs = Array.from({ length: 40 }, (_, i) => `Parrafo numero ${i} con algo de relleno.`);
    const chunks = split(document(block(paragraphs.join('\n\n'), ['Seccion'])));

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => expect(chunk.content.length).toBeLessThanOrEqual(300));
  });

  it('Should cut a paragraph that does not fit and overlap the cut', () => {

    const giant = 'x'.repeat(1000);
    const chunks = split(document(block(giant, [])), 300, 50);

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => expect(chunk.content.length).toBeLessThanOrEqual(300));

    // El solapamiento es lo que evita que una frase partida se pierda entre dos
    // trozos: el final de uno vuelve a aparecer al principio del siguiente.
    const total = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
    expect(total).toBeGreaterThan(giant.length);
  });

  it('Should split a table by rows and repeat the header', () => {

    const rows = Array.from({ length: 30 }, (_, i) => `| fila ${i} | valor ${i} |`);
    const table = ['| Concepto | Importe |', '|---|---|', ...rows].join('\n');

    const chunks = split(document(block(table, ['Cuentas'], 'table')), 300, 50);

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      expect(chunk.content).toContain('| Concepto | Importe |');
      expect(chunk.content).toContain('|---|---|');
      expect(chunk.contentType).toBe('table');
    });
  });

  it('Should not mix a table with prose in the same chunk', () => {

    const chunks = split(document(
      block('Introduccion.', ['A']),
      block('| a | b |\n|---|---|\n| 1 | 2 |', ['A'], 'table')));

    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.contentType)).toEqual(['text', 'table']);
  });

  it('Should carry the page of each chunk', () => {

    const chunks = split(document(
      block('Uno.', ['A'], 'text', 3),
      block('Dos.', ['B'], 'text', 7)));

    expect(chunks.map((chunk) => chunk.page)).toEqual([3, 7]);
  });

  /**
   * `page` es una cita. Un trozo que cruzase la frontera solo podria citar una
   * de las dos paginas, y una cita incorrecta es peor que un trozo mas corto.
   */
  it('Should never let a chunk span two pages', () => {

    const chunks = split(document(
      block('Final de la primera.', [], 'text', 1),
      block('Principio de la segunda.', [], 'text', 2)));

    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.page)).toEqual([1, 2]);
    expect(chunks[0].content).not.toContain('segunda');
  });

  it('Should number positions densely and in order', () => {

    const blocks = Array.from({ length: 12 }, (_, i) => block(`Texto ${i}.`, [`S${i}`]));
    const chunks = split(document(...blocks));

    expect(chunks.map((chunk) => chunk.position)).toEqual([...Array(12).keys()]);
  });

  it('Should refuse a document that produces more chunks than the cap', () => {

    const blocks = Array.from({ length: 20 }, (_, i) => block(`Texto ${i}.`, [`S${i}`]));

    expect(() => split(document(...blocks), 300, 50, 5)).toThrow(ConversionUnsupportedError);
  });

  it('Should keep a deeply nested heading path usable', () => {

    // Con migas de pan larguisimas el presupuesto se agotaria: por debajo del
    // minimo se prefiere un trozo mas largo a uno sin texto.
    const deep = Array.from({ length: 8 }, (_, i) => `Nivel numero ${i} de la jerarquia`);
    const chunks = split(document(block('Contenido real.', deep)), 300, 50);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('Contenido real.');
  });
});
