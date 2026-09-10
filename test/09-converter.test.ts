import path from 'path';

import { officeParserConverter } from '@/infrastructure/indexing/converters/officeparser.converter';
import { ConversionUnsupportedError } from '@/domain/exceptions/indexing.exception';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const asset = (name:string) => path.join(__dirname, 'assets', name);

const convert = (name:string, mimetype:string) => officeParserConverter.convert(asset(name), mimetype);

describe('Document converter', () => {

  it('Should support every format the deployment can verify', () => {

    ['application/pdf', 'application/rtf', 'application/epub+zip',
     'application/vnd.oasis.opendocument.text',
     'application/vnd.oasis.opendocument.spreadsheet',
     'application/vnd.oasis.opendocument.presentation',
     DOCX,
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation']
      .forEach((mimetype) => expect(officeParserConverter.supports(mimetype)).toBe(true));
  });

  it('Should not support a mimetype it cannot convert', () => {

    expect(officeParserConverter.supports('image/png')).toBe(false);
    expect(officeParserConverter.supports('application/zip')).toBe(false);
  });

  it('Should refuse a mimetype with no converter', async () => {

    await expect(convert('test.pdf', 'image/png')).rejects.toThrow(ConversionUnsupportedError);
  });

  it('Should refuse a file that is not what it claims to be', async () => {

    await expect(convert('test.rtf', DOCX)).rejects.toThrow(ConversionUnsupportedError);
  });

  /**
   * La razon de recorrer el AST en vez de pedir el markdown ya montado: la
   * pagina vive en los nodos contenedores y se pierde al aplanar el documento.
   */
  it('Should carry the real page of a multi-page PDF', async () => {

    const { blocks } = await convert('multipage.pdf', 'application/pdf');

    expect(blocks.length).toBeGreaterThanOrEqual(4);
    expect([...new Set(blocks.map((block) => block.page))]).toEqual([1, 2]);

    const second = blocks.find((block) => block.markdown.includes('pagina segunda'));

    expect(second.page).toBe(2);
  });

  it('Should build the heading path with a level stack', async () => {

    const { blocks } = await convert('structured.docx', DOCX);
    const paths = blocks.map((block) => block.headingPath);

    expect(paths).toContainEqual(['Guia de Pergamo']);
    expect(paths).toContainEqual(['Guia de Pergamo', 'Instalacion', 'Docker']);
  });

  /**
   * El defecto que hace que no se pueda portar el troceado de markbot: casa la
   * seccion por titulo literal, asi que dos «Requisitos» en ramas distintas
   * reciben la misma ruta. Aqui la pila las distingue por posicion.
   */
  it('Should distinguish two headings with the same title in different branches', async () => {

    const { blocks } = await convert('structured.docx', DOCX);

    const requirements = blocks
      .filter((block) => block.headingPath[block.headingPath.length - 1] === 'Requisitos')
      .map((block) => block.headingPath);

    expect(requirements).toHaveLength(2);
    expect(requirements[0]).toEqual(['Guia de Pergamo', 'Instalacion', 'Docker', 'Requisitos']);
    expect(requirements[1]).toEqual(['Guia de Pergamo', 'Cuentas', 'Requisitos']);
  });

  it('Should render a table as markdown rows', async () => {

    const { blocks } = await convert('structured.docx', DOCX);
    const table = blocks.find((block) => block.kind === 'table');

    expect(table).toBeDefined();
    expect(table.markdown.split('\n')).toEqual([
      '| Concepto | Importe |',
      '| --- | --- |',
      '| Alta | 100 |',
      '| Baja | 250 |'
    ]);
    expect(table.headingPath).toEqual(['Guia de Pergamo', 'Cuentas']);
  });

  it('Should report which converter produced the document', async () => {

    await expect(convert('test.odt', 'application/vnd.oasis.opendocument.text'))
      .resolves.toMatchObject({ converter: 'officeparser' });
  });
});
