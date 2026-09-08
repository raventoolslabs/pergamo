import type { ChunkContentType } from '../api/types';

/**
 * Renderiza el markdown de un trozo. Devuelve nodos de React y nunca toca
 * `innerHTML`: el texto sale de documentos de clientes, y en un gestor que ya
 * rechaza contenido activo no se abre esa puerta.
 *
 * Propio y no una librería por el mismo motivo por el que el troceador se
 * escribió en vez de traerse langchain: el conversor
 * (`src/infrastructure/indexing/converters/officeparser.converter.ts`) emite
 * una gramática de tres construcciones —tabla de tuberías, lista de guiones y
 * párrafo—, y no hay encabezados, negritas, enlaces ni vallas de código. El día
 * que el conversor enriquezca su salida, esto se amplía o se cambia por la
 * librería.
 */

const BREADCRUMB = ' > ';

// La fila que separa cabecera de cuerpo en una tabla markdown: '| --- | --- |'.
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

/**
 * El contenido guardado lleva la ruta de encabezados por delante. En la vista
 * formateada sobra, porque va como dato de la cabecera del trozo; se quita el
 * prefijo exacto y no se adivina.
 */
export const withoutBreadcrumb = (content: string, headingPath: string[]) => {
  if (!headingPath.length) return content;

  const prefix = `${headingPath.join(BREADCRUMB)}\n\n`;
  return content.startsWith(prefix) ? content.slice(prefix.length) : content;
};

/**
 * Corta por las tuberías que no vienen escapadas. El conversor escapa como
 * `\|` las que había dentro de una celda, así que partir por `|` a secas
 * rompería esa celda en dos.
 */
const cellsOf = (row: string) => {
  const cells: string[] = [];
  let current = '';

  for (let index = 0; index < row.length; index += 1) {
    if (row[index] === '\\' && row[index + 1] === '|') { current += '|'; index += 1; continue; }
    if (row[index] === '|') { cells.push(current); current = ''; continue; }
    current += row[index];
  }

  cells.push(current);

  // Las tuberías de los extremos dejan una celda vacía a cada lado.
  if (!cells[0].trim()) cells.shift();
  if (cells.length && !cells[cells.length - 1].trim()) cells.pop();

  return cells.map((cell) => cell.trim());
};

/**
 * Un trozo es un fragmento: el corte duro puede dejar una tabla sin su última
 * fila o partir un párrafo a media palabra. Nada de esto puede reventar, así
 * que lo que no encaje se pinta como texto.
 */
const Table = ({ text }: { text: string }) => {
  const rows = text.split('\n').filter((line) => line.trim());
  const body = rows.filter((row) => !TABLE_SEPARATOR.test(row)).map(cellsOf);

  if (!body.length) return <Paragraphs text={text} />;

  const [head, ...rest] = body;
  const width = Math.max(...body.map((row) => row.length));

  const pad = (row: string[]) => [...row, ...Array(Math.max(0, width - row.length)).fill('')];

  return (
    <div className="scroller">
      <table className="md-table">
        <thead>
          <tr>{pad(head).map((cell, index) => <th key={index}>{cell}</th>)}</tr>
        </thead>
        <tbody>
          {rest.map((row, rowIndex) => (
            <tr key={rowIndex}>{pad(row).map((cell, index) => <td key={index}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Listas planas de un solo nivel: es lo único que el conversor produce. */
const List = ({ text }: { text: string }) => {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const items = lines.filter((line) => line.startsWith('- ')).map((line) => line.slice(2));
  const loose = lines.filter((line) => !line.startsWith('- '));

  return (
    <>
      {loose.map((line, index) => <p key={`loose-${index}`}>{line}</p>)}
      {items.length ? (
        <ul className="md-list">
          {items.map((item, index) => <li key={index}>{item}</li>)}
        </ul>
      ) : null}
    </>
  );
};

const Paragraphs = ({ text }: { text: string }) => (
  <>
    {text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
      .map((paragraph, index) => <p key={index}>{paragraph}</p>)}
  </>
);

export const ChunkContent = ({ content, kind, headingPath }: {
  content: string;
  kind: ChunkContentType;
  headingPath: string[];
}) => {

  const body = withoutBreadcrumb(content, headingPath);

  if (kind === 'table') return <Table text={body} />;
  if (kind === 'list') return <List text={body} />;
  // El conversor guarda el código sin vallas y no hay resaltado: se respeta el
  // espaciado, que es lo único que aporta información aquí.
  if (kind === 'code') return <pre className="md-code">{body}</pre>;

  return <Paragraphs text={body} />;
};
