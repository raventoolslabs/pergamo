import axios from 'axios';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import archiver from 'archiver';
import { Readable } from 'stream';
import FormData from 'form-data';
import mime from 'mime-types';

import { app } from '../src/app';
import Config from '../src/config'
import { sha256File } from '../src/utils/hash';
import { verifyMimetype } from '../src/utils/filetype';
import FilesUtils from "../src/utils/files";

const EICAR = `X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`;

// Las pruebas que necesitan un veredicto real del escaner se declaran con
// it.skip cuando el antivirus esta desactivado, en lugar de envolverse en un
// `if`: asi Jest las REPORTA como omitidas. Un bloque `if` desaparece del
// informe y da la impresion de una cobertura que no existe.
const itAntivirus = Config.enable_antivirus ? it : it.skip;

const sha256Buffer = (buffer:Buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

describe('Document Tests', () => {

  let api;
  let server;
  let token;
  let id;

  beforeAll(async () => {
    server = await app(0);

    api = axios.create({
      baseURL: `http://localhost:${server.address().port}`,
      validateStatus: () => { return true; }
    });

    const response = await api.post(`/organization/login`, {
      name: 'pergamo',
      password: Config.password_master,
    });

    token = response.data.token;
  });

  afterAll(async() => {
    server.close();
  });

  it('Should upload a document', async () => {

    const pathPdf = path.join(__dirname, 'assets', 'test.pdf');

    const form = new FormData();
    form.append('document', fs.createReadStream(pathPdf));

    const response = await api.post('/document', form, {
      headers: {
        'authorization': token,
        ...form.getHeaders()
      },
    });

    const hash =  await sha256File(pathPdf)

    expect(response.status).toBe(200);
    expect(response.data.name).toBe('test');
    expect(response.data.extension).toBe('pdf');
    expect(response.data.original_name).toBe('test.pdf');
    expect(response.data.mimetype).toBe('application/pdf');
    expect(response.data.hash).toBe(hash);

    id = response.data.uuid;
  });

  itAntivirus('Should not upload a virus', async () => {

    // El contenido es EICAR exacto: la firma de ClamAV para este fichero es un
    // hash del contenido completo, asi que cualquier byte anadido la anula.
    //
    // Que llegue al escaner pese a no ser un PDF valido no es casualidad: en
    // upload el analisis antivirico va DELIBERADAMENTE antes de la verificacion
    // de contenido. Si fuera al reves, este fichero se rechazaria por firma de
    // contenido y la prueba pasaria sin haber ejercitado el antivirus, que es
    // exactamente el defecto que tenia antes con ENABLE_ANTIVIRUS a false.
    const form = new FormData();
    form.append('document', Buffer.from(EICAR), {
      filename: 'virus.pdf',
      contentType: 'application/pdf',
    });

    const response = await api.post('/document', form, {
      headers: {
        'authorization': token,
        ...form.getHeaders()
      },
    });

    expect(response.status).toBe(400);
    // Sin el nombre exacto de la firma: depende de la version de la base de
    // datos de ClamAV y convertia una actualizacion de firmas en un fallo.
    expect(response.data.error).toContain('File is infected');
  });

  itAntivirus('Should scan a file up to MAX_FILE_SIZE', async () => {

    // Esta es la prueba que detecta que los limites de clamav/clamd.conf
    // (MaxFileSize, MaxScanSize, StreamMaxLength) se han quedado por debajo de
    // MAX_FILE_SIZE. Cuando eso ocurre, ClamAV deja de analizar el fichero por
    // completo y —con AlertExceedsMax desactivado— lo da por bueno: la subida
    // devolveria 200 en lugar de 400.
    //
    // El payload es un ODT (que es un ZIP) de tamano cercano al limite con un
    // eicar.com dentro. Tiene que ser asi: la firma de EICAR es un hash del
    // fichero exacto, de modo que rellenar un fichero plano con EICAR al final
    // no lo detecta nadie. Dentro de un archivo comprimido, en cambio, ClamAV
    // desempaqueta y encuentra la entrada intacta.
    const mimetypeOdt = 'application/vnd.oasis.opendocument.text';

    if(!Config.valid_mimetype.includes(mimetypeOdt)) {
      return console.warn(`VALID_MIMETYPE no incluye ${mimetypeOdt}; se omite`);
    }

    const target = Config.max_file_size - (1024 * 1024);
    const bigPath = path.join(Config.tmp_base, `big-infected-${Date.now()}.odt`);

    // Sin compresion, para que el tamano en disco sea el que se quiere probar.
    const archive = archiver('zip', { zlib: { level: 0 }, store: true });
    const output = fs.createWriteStream(bigPath);
    const done = new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      archive.on('error', reject);
    });

    archive.pipe(output);
    archive.append(Buffer.from(mimetypeOdt), { name: 'mimetype' });

    let produced = 0;
    const chunk = Buffer.alloc(1024 * 1024, 0x41);
    archive.append(new Readable({
      read() {
        if(produced >= target) return this.push(null);
        produced += chunk.length;
        this.push(chunk);
      }
    }), { name: 'relleno.bin' });

    archive.append(Buffer.from(EICAR), { name: 'eicar.com' });
    archive.finalize();

    await done;

    try {

      const size = fs.statSync(bigPath).size;

      expect(size).toBeGreaterThan(Config.max_file_size / 2);
      expect(size).toBeLessThanOrEqual(Config.max_file_size);

      const form = new FormData();
      form.append('document', fs.createReadStream(bigPath), {
        filename: 'grande-infectado.odt',
        contentType: mimetypeOdt,
        knownLength: size
      });

      const response = await api.post('/document', form, {
        headers: { 'authorization': token, ...form.getHeaders() },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });

      expect(response.status).toBe(400);
      expect(response.data.error).toContain('File is infected');

    } finally {
      fs.unlinkSync(bigPath);
    }
  }, 180000);

  it('Should preserve a signed PDF byte for byte', async () => {

    // Regresion del principio central del diseno: en un archivo, la integridad
    // del byte original es un requisito, no una preferencia. Cualquier etapa que
    // reescriba el documento (un saneador de PDF, una "normalizacion") invalida
    // la firma electronica y rompe metadata.hash, que es la identidad de
    // registro. Este fichero lleva a proposito lo que un CDR eliminaria:
    // /ByteRange, /Contents, /AcroForm con /SigFlags, un /EmbeddedFile y una
    // actualizacion incremental con dos %%EOF.
    const pathSigned = path.join(__dirname, 'assets', 'signed.pdf');
    const original = fs.readFileSync(pathSigned);

    const form = new FormData();
    form.append('document', fs.createReadStream(pathSigned));

    const upload = await api.post('/document', form, {
      headers: { 'authorization': token, ...form.getHeaders() }
    });

    expect(upload.status).toBe(200);
    expect(upload.data.hash).toBe(await sha256File(pathSigned));

    const signedId = upload.data.uuid;

    const download = await api.get(`/document/${signedId}/file`, {
      headers: { 'authorization': token },
      responseType: 'arraybuffer'
    });

    expect(download.status).toBe(200);

    const downloaded = Buffer.from(download.data);

    expect(sha256Buffer(downloaded)).toBe(sha256Buffer(original));
    expect(downloaded.equals(original)).toBeTruthy();
    // Comprobaciones explicitas de lo que un saneador se llevaria por delante.
    expect(downloaded.includes(Buffer.from('/ByteRange'))).toBeTruthy();
    expect(downloaded.includes(Buffer.from('/EmbeddedFile'))).toBeTruthy();
    expect(downloaded.toString('latin1').split('%%EOF').length - 1).toBe(2);

    await api.delete(`/document/${signedId}`, { headers: { 'authorization': token } });
  });

  it('Should upload an OpenDocument text file', async () => {

    // Hasta ahora no habia ningun .odt en test/assets, de modo que la rama
    // isOpenDocument de utils/filetype.ts no se ejercitaba nunca.
    const pathOdt = path.join(__dirname, 'assets', 'test.odt');
    const mimetypeOdt = 'application/vnd.oasis.opendocument.text';

    if(!Config.valid_mimetype.includes(mimetypeOdt)) {
      return console.warn(`VALID_MIMETYPE no incluye ${mimetypeOdt}; se omite`);
    }

    const form = new FormData();
    form.append('document', fs.createReadStream(pathOdt), { contentType: mimetypeOdt });

    const response = await api.post('/document', form, {
      headers: { 'authorization': token, ...form.getHeaders() }
    });

    expect(response.status).toBe(200);
    expect(response.data.mimetype).toBe(mimetypeOdt);
    expect(response.data.hash).toBe(await sha256File(pathOdt));

    await api.delete(`/document/${response.data.uuid}`, { headers: { 'authorization': token } });
  });

  it('Should reject a permitted mimetype that has no content signature', async () => {

    // verifyMimetype es ahora fail-closed: un mimetype presente en
    // VALID_MIMETYPE pero sin firma conocida ya no se acepta con un simple
    // aviso, porque de su contenido no se puede afirmar nada.
    //
    // Solo tiene sentido si la configuracion de este entorno incluye alguno; en
    // caso contrario se informa y se omite, en vez de dar por probado algo que
    // no se ha ejercitado.
    const tmp = path.join(Config.tmp_base, `signature-probe-${Date.now()}`);
    fs.writeFileSync(tmp, 'contenido arbitrario');

    let unverifiable:string;

    try {
      for(const mimetype of Config.valid_mimetype) {
        if(!(await verifyMimetype(tmp, mimetype)).verifiable) {
          unverifiable = mimetype;
          break;
        }
      }
    } finally {
      fs.unlinkSync(tmp);
    }

    if(!unverifiable) {
      return console.warn('Todos los VALID_MIMETYPE tienen firma de contenido; nada que comprobar');
    }

    const form = new FormData();
    form.append('document', Buffer.from('contenido arbitrario'), {
      filename: 'sin-firma.bin',
      contentType: unverifiable
    });

    const response = await api.post('/document', form, {
      headers: { 'authorization': token, ...form.getHeaders() }
    });

    expect(response.status).toBe(400);
    expect(response.data.error).toContain('No content signature available');
  });

  it('Should get a metadata of document', async () => {

    const response = await api.get(`/document/${id}`, {
      headers: {
        'authorization': token
      }
    });

    expect(response.status).toBe(200);
    expect(response.data.name).toBe('test');
    expect(response.data.extension).toBe('pdf');
    expect(response.data.original_name).toBe('test.pdf');
    expect(response.data.mimetype).toBe('application/pdf');
    expect(response.data.uuid).toBe(id);
  });

  it('Should get a file of document', async () => {

    const response = await api.get(`/document/${id}/file`, {
      headers: {
        'authorization': token
      }
    });

    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();
  });

  it('Should modify a metadata of document', async () => {

    const tags = ['test'];
    const response = await api.put(`/document/${id}`, { tags }, {
      headers: {
        'authorization': token,
        'Content-Type': mime.contentType('json')
      }
    });

    expect(response.status).toBe(200);
    expect(response.data.tags.includes('test')).toBeTruthy();
  });

  it('Should modify a file of document', async () => {

    const pathPdf = path.join(__dirname, 'assets', 'test2.pdf');

    const form = new FormData();
    form.append('document', fs.createReadStream(pathPdf));

    const response = await api.put(`/document/${id}/file`, form, {
      headers: {
        'authorization': token,
        ...form.getHeaders()
      },
    });

    const hash =  await sha256File(pathPdf)

    expect(response.status).toBe(200);
    expect(response.data.name).toBe('test2');
    expect(response.data.extension).toBe('pdf');
    expect(response.data.original_name).toBe('test2.pdf');
    expect(response.data.mimetype).toBe('application/pdf');
    expect(response.data.hash).toBe(hash);
  });

  itAntivirus('Should not replace a file with an infected one', async () => {

    // PUT /document/:id/file no tenia ninguna cobertura con contenido
    // infectado, pese a ser la segunda via de entrada de ficheros al sistema.
    const form = new FormData();
    form.append('document', Buffer.from(EICAR), {
      filename: 'virus.pdf',
      contentType: 'application/pdf'
    });

    const response = await api.put(`/document/${id}/file`, form, {
      headers: { 'authorization': token, ...form.getHeaders() }
    });

    expect(response.status).toBe(400);
    expect(response.data.error).toContain('File is infected');

    // El documento conserva el contenido anterior: un intento fallido no debe
    // dejarlo a medias.
    const after = await api.get(`/document/${id}`, { headers: { 'authorization': token } });

    expect(after.status).toBe(200);
    expect(after.data.original_name).toBe('test2.pdf');
  });

  if(Config.max_version_file > 1) {
    it('Should return saved versions of a document', async () => {

      let response = await api.get(`/document/${id}/versions`, {
        headers: {
          'authorization': token
        }
      });
  
      expect(response.status).toBe(200);
      expect(response.data.length).toBe(1);
      expect(response.data[0].version).toBe(1);
    });
  }
  
  it('Should remove a document', async () => {

    let response = await api.get(`/document/${id}`, {
      headers: {
        'authorization': token
      }
    });

    const pathFile = FilesUtils.pathFile(response.data);

    response = await api.delete(`/document/${id}`, {
      headers: {
        'authorization': token
      }
    });

    expect(response.status).toBe(200);
    expect(response.data.message).toBe(`Document with id ${id} deleted`);
    expect(!fs.existsSync(pathFile)).toBeTruthy();
  });
});