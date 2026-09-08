import path from 'path';
import fs from 'fs';

import Config from '@/shared/config';
import { verifyMimetype } from '@/infrastructure/files/filetype';

const ASSETS = path.join(__dirname, 'assets');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const ODT = 'application/vnd.oasis.opendocument.text';
const EPUB = 'application/epub+zip';
const RTF = 'application/rtf';
const PDF = 'application/pdf';

const asset = (name:string) => path.join(ASSETS, name);

const verify = (file:string, mimetype:string) => verifyMimetype(asset(file), mimetype);

describe('Content signatures', () => {

  it.each([
    ['test.pdf', PDF],
    ['test.odt', ODT],
    ['test.docx', DOCX],
    ['test.xlsx', XLSX],
    ['test.pptx', PPTX],
    ['test.epub', EPUB],
    ['test.rtf', RTF]
  ])('Should verify %s against its own mimetype', async (file, mimetype) => {

    await expect(verify(file, mimetype)).resolves.toEqual({ verifiable: true, matches: true });
  });

  /**
   * Lo que justifica descomprimir el [Content_Types].xml: los tres OOXML
   * comparten cabecera, asi que verificar solo la familia dejaria pasar
   * cualquiera de ellos declarado como cualquier otro.
   */
  it.each([
    ['test.docx', XLSX],
    ['test.docx', PPTX],
    ['test.xlsx', DOCX],
    ['test.xlsx', PPTX],
    ['test.pptx', DOCX],
    ['test.pptx', XLSX]
  ])('Should reject %s declared as %s', async (file, mimetype) => {

    await expect(verify(file, mimetype)).resolves.toEqual({ verifiable: true, matches: false });
  });

  it.each([
    ['test.odt', DOCX],
    ['test.epub', DOCX],
    ['test.docx', ODT],
    ['test.epub', ODT],
    ['test.odt', EPUB],
    ['test.pdf', RTF],
    ['test.rtf', PDF]
  ])('Should reject %s declared as %s across families', async (file, mimetype) => {

    await expect(verify(file, mimetype)).resolves.toEqual({ verifiable: true, matches: false });
  });

  it('Should reject a ZIP that is not an office document', async () => {

    // Un ZIP cualquiera tiene la cabecera de un OOXML y de un ODF, y nada mas.
    const tmp = path.join(Config.tmp_base, `plain-zip-${Date.now()}.zip`);

    fs.writeFileSync(tmp, Buffer.concat([
      Buffer.from('PK\x03\x04', 'latin1'),
      Buffer.alloc(124)
    ]));

    try {
      for(const mimetype of [DOCX, XLSX, PPTX, ODT, EPUB]) {
        await expect(verifyMimetype(tmp, mimetype)).resolves.toEqual({ verifiable: true, matches: false });
      }
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  /**
   * No tienen magic bytes, asi que no hay nada que contrastar con el mimetype
   * declarado y quedan fuera de SIGNATURES. Fijarlo aqui evita que se anadan a
   * VALID_MIMETYPE por descuido: fail-closed los rechazaria con un 400 confuso.
   */
  it.each(['text/plain', 'text/html', 'text/csv', 'text/markdown', 'application/zip'])(
    'Should report %s as unverifiable', async (mimetype) => {

    await expect(verify('test.pdf', mimetype)).resolves.toEqual({ verifiable: false, matches: true });
  });

  it('Should have a signature for every permitted mimetype', async () => {

    const unverifiable:string[] = [];

    for(const mimetype of Config.valid_mimetype) {
      if(!(await verify('test.pdf', mimetype)).verifiable) unverifiable.push(mimetype);
    }

    expect(unverifiable).toEqual([]);
  });
});
