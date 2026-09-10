import axios from 'axios';
import path from 'path';
import fs from 'fs';
import FormData from 'form-data';
import { StatusCodes } from 'http-status-codes';

import { app } from '@/server';
import Config from '@/shared/config';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { sha256File } from '@/shared/hash';
import { verifyMimetype } from '@/infrastructure/files/filetype';
import { detectActiveContent } from '@/infrastructure/antivirus/active-content';

/**
 * Corpus de PDF con contenido activo (PayloadsAllThePDFs, Apache-2.0).
 *
 * De los once ficheros, ClamAV (1.4.3, firmas 28116) reconoce uno: los otros
 * diez son PDF validos que atacan al visor y entraban en el archivo sin que
 * nadie los senalara. De ahi la segunda capa —utils/activecontent.ts— y el
 * estado 'malicious', que estas pruebas fijan: el deposito no se rechaza, no se
 * entrega (423) y solo sale de ahi por una liberacion manual.
 *
 * Ver test/assets/payloads/README.md para el origen de cada fichero.
 */

const PAYLOADS = path.join(__dirname, 'assets', 'payloads');

const CORPUS = [
  'foxit-reader-poc.pdf',
  'payload1.pdf',
  'payload2.pdf',
  'payload3.pdf',
  'payload4.pdf',
  'payload5.pdf',
  'payload6.pdf',
  'payload7.pdf',
  'payload8.pdf',
  'payload9.pdf',
  'starter_pack.pdf'
];

/**
 * El unico del corpus con firma en ClamAV (`Html.Exploit.CVE_2016_3198-1`). Si
 * la prueba que lo usa falla, es que la base de firmas ha dejado de
 * reconocerlo: se comprueba con `clamscan test/assets/payloads/`.
 */
const SIGNED = 'payload1.pdf';

/**
 * El que ninguna firma reconoce: sin /JavaScript ni /OpenAction, inyecta el
 * codigo en un array /FontMatrix contra el parser del visor (CVE-2024-4367).
 * Lo retiene la regla FontMatrix, que mira el valor y no la clave.
 */
const FONT_MATRIX = 'payload8.pdf';

// it.skip y no un `if`: asi Jest informa de lo que no se ha ejercitado en vez
// de dar una cobertura aparente.
const itAntivirus = Config.enable_antivirus ? it : it.skip;

describe('Active-content PDF corpus', () => {

  let api;
  let server;
  let token;

  const deposited:string[] = [];

  const upload = async (file:string) => {

    const form = new FormData();
    form.append('document', fs.createReadStream(path.join(PAYLOADS, file)), {
      filename: file,
      contentType: 'application/pdf'
    });

    const response = await api.post('/document', form, {
      headers: { authorization: token, ...form.getHeaders() }
    });

    if(response.status === StatusCodes.OK) deposited.push(response.data.uuid);

    return response;
  };

  const status = async (id:string):Promise<any> => {

    const rows:any = await sequelize.query(
      'SELECT scan_status, scan_signature, scan_engine FROM pergamo.document WHERE id = :id;', {
      replacements: { id },
      type: QueryTypes.SELECT
    });

    return rows[0];
  };

  beforeAll(async () => {

    server = await app(0);

    api = axios.create({
      baseURL: `http://localhost:${server.address().port}`,
      validateStatus: () => true
    });

    const login = await api.post('/organization/login', {
      name: 'pergamo',
      password: Config.password_master
    });

    token = login.data.token;
  });

  afterAll(async () => {

    // El corpus no se queda en el fondo: estas pruebas corren contra la base
    // configurada, que en desarrollo es la misma que se mira por la interfaz.
    for(const id of deposited) {
      await api.delete(`/document/${id}`, { headers: { authorization: token } });
    }

    server.close();
    await sequelize.close();
  });

  it('Should ship the whole corpus', () => {

    // Un antivirus con vigilancia en tiempo real puede haberse llevado
    // payload1.pdf del clon: sin esto, la prueba que lo usa falla con un ENOENT
    // dentro de un stream y cuesta entender por que.
    const missing = CORPUS.filter((file) => !fs.existsSync(path.join(PAYLOADS, file)));

    expect(missing).toEqual([]);
  });

  it('Should accept every payload as a structurally valid PDF', async () => {

    // La verificacion de contenido dice si el fichero es lo que declara ser, no
    // si es inofensivo: que los acepte todos es la frontera entre las capas.
    for(const file of CORPUS) {

      const type = await verifyMimetype(path.join(PAYLOADS, file), 'application/pdf');

      expect({ file, ...type }).toMatchObject({ verifiable: true, matches: true });
    }
  });

  it('Should flag every payload of the corpus as active content', async () => {

    // La medida de la capa, sin pasar por la API: si un fichero deja de
    // marcarse, esta prueba lo dice por su nombre.
    const flagged:string[] = [];

    for(const file of CORPUS) {

      const result = await detectActiveContent(path.join(PAYLOADS, file), 'application/pdf');

      if(result.active) flagged.push(file);
    }

    expect(flagged).toEqual(CORPUS);
  });

  /**
   * El unico que entra por el valor de una clave corriente: la lleva cualquier
   * tipografia Type1 o Type3, y lo que condena es que dentro del array haya algo
   * que no es un numero. El visor lo concatena en el codigo que genera.
   */
  it('Should flag a font matrix that carries something other than numbers', async () => {

    const result = await detectActiveContent(path.join(PAYLOADS, FONT_MATRIX), 'application/pdf');

    expect(result).toEqual({ active: true, markers: ['FontMatrix'] });
  });

  it('Should not flag a font matrix of six numbers', async () => {

    // La otra mitad: una Type3 corriente declara su matriz y no por eso queda
    // retenida.
    const result = await detectActiveContent(
      path.join(__dirname, 'assets', 'font-matrix-numbers.pdf'), 'application/pdf');

    expect(result).toEqual({ active: false, markers: [] });
  });

  it('Should not flag the ordinary documents of the test corpus', async () => {

    // Un filtro que marca todo no filtra nada. Estos dos PDF corrientes llevan
    // `/AAAAAA` (un nombre de tipografia) y darian positivo con una busqueda
    // por subcadena de `/AA`.
    for(const file of ['test.pdf', 'test2.pdf']) {

      const result = await detectActiveContent(path.join(__dirname, 'assets', file), 'application/pdf');

      expect({ file, ...result }).toMatchObject({ active: false });
    }
  });

  /**
   * `/OpenAction[3 0 R /XYZ null null 0]` es un destino —«abrete en esta pagina
   * con este encuadre»— y lo emite cualquier suite ofimatica. Marcarlo dejaba en
   * cuarentena a media biblioteca por decir donde abrirse.
   */
  it('Should not flag an OpenAction that is only a destination', async () => {

    const result = await detectActiveContent(
      path.join(__dirname, 'assets', 'open-action-destination.pdf'), 'application/pdf');

    expect(result).toEqual({ active: false, markers: [] });
  });

  /**
   * La otra mitad, sin la cual lo anterior seria un agujero. El subtipo es
   * '/Movie' a proposito: ninguna otra regla lo mira, asi que lo que se prueba
   * es el refinamiento de OpenAction y no el solapamiento con '/JavaScript'.
   */
  it('Should flag an OpenAction that carries an action dictionary', async () => {

    const result = await detectActiveContent(
      path.join(__dirname, 'assets', 'open-action-dictionary.pdf'), 'application/pdf');

    // Dos marcadores y no uno: '/S /Movie' es ademas el subtipo que MediaAction
    // reconoce alli donde este colgado, y no solo bajo /OpenAction.
    expect(result).toEqual({ active: true, markers: ['OpenAction', 'MediaAction'] });
  });

  /**
   * LaTeX escribe `/OpenAction 98 0 R` para decir por que pagina abrirse. Se
   * sigue la referencia, y lo que hay al otro lado es un destino: marcarla por
   * no poder seguirla retenia manuales enteros.
   */
  it('Should not flag an indirect OpenAction that resolves to a destination', async () => {

    const result = await detectActiveContent(
      path.join(__dirname, 'assets', 'open-action-indirect.pdf'), 'application/pdf');

    expect(result).toEqual({ active: false, markers: [] });
  });

  /**
   * Un nombre PDF es un token y no puede vivir dentro de una cadena. Sin esto,
   * un enlace a la pagina «JavaScript» de la Wikipedia —que lleva cualquier
   * manual— daba positivo por `/JavaScript`.
   */
  it('Should not flag a name that only appears inside a string', async () => {

    const result = await detectActiveContent(
      path.join(__dirname, 'assets', 'link-to-a-javascript-page.pdf'), 'application/pdf');

    expect(result).toEqual({ active: false, markers: [] });
  });

  /**
   * Entre los bytes de una imagen cae `/JS` por azar. Un flujo que no parece
   * texto no se examina: ahi no hay estructura que leer, y marcarlo retenia
   * documentos por el contenido de una fotografia.
   */
  it('Should not flag a marker that falls inside a binary stream', async () => {

    const result = await detectActiveContent(
      path.join(__dirname, 'assets', 'binary-stream-noise.pdf'), 'application/pdf');

    expect(result).toEqual({ active: false, markers: [] });
  });

  /**
   * La misma via de payload8 en otra clave: `/Rect` va en cada anotacion, y por
   * eso la regla condena el valor y no la clave.
   */
  it('Should flag any numeric array that carries something else', async () => {

    const result = await detectActiveContent(
      path.join(__dirname, 'assets', 'rect-with-a-string.pdf'), 'application/pdf');

    expect(result).toEqual({ active: true, markers: ['Rect'] });
  });

  it('Should quarantine an active-content deposit instead of rejecting it', async () => {

    // Lo que separa esto del antivirus: un fichero infectado no entra (400),
    // pero el contenido activo si se deposita. El documento se guarda y lo que
    // se retiene es la entrega.
    const response = await upload('payload3.pdf');

    expect(response.status).toBe(StatusCodes.OK);

    const row = await status(response.data.uuid);

    expect(row.scan_status).toBe('malicious');
    expect(row.scan_signature).toContain('JavaScript');

    const download = await api.get(`/document/${response.data.uuid}/file`, {
      headers: { authorization: token }
    });

    expect(download.status).toBe(StatusCodes.LOCKED);
    expect(download.data.error).toContain('active content');
    // Y se dice que esperar no sirve: es la unica forma de que quien lo recibe
    // sepa que hay que hacer algo.
    expect(download.data.error).toContain('manual review');
  });

  it('Should still serve the metadata of an active-content document', async () => {

    const uploaded = await upload('payload5.pdf');

    const response = await api.get(`/document/${uploaded.data.uuid}`, {
      headers: { authorization: token }
    });

    // Los metadatos son como el cliente descubre por que esta bloqueado: el
    // gate esta en getFile y solo ahi.
    expect(response.status).toBe(StatusCodes.OK);
    expect(response.data.uuid).toBe(uploaded.data.uuid);

    const scan = await api.get(`/document/${uploaded.data.uuid}/scan`, {
      headers: { authorization: token }
    });

    expect(scan.data.scan_status).toBe('malicious');
    expect(scan.data.scan_signature).toContain('ACTIVE_CONTENT');
  });

  it('Should only leave quarantine through a manual release', async () => {

    const uploaded = await upload('payload9.pdf');
    const id = uploaded.data.uuid;

    expect((await status(id)).scan_status).toBe('malicious');

    // El reescaneo no mira estas filas. Se reproduce aqui su seleccion exacta:
    // es la garantia de que un barrido no libera en lote lo que se retuvo.
    const queue:any = await sequelize.query(
      `SELECT id FROM pergamo.document
      WHERE (scan_engine IS NULL OR scan_engine <> :engine)
        AND scan_status <> 'malicious' AND id = :id;`, {
      replacements: { engine: 'any-engine', id },
      type: QueryTypes.SELECT
    });

    expect(queue).toHaveLength(0);

    // La liberacion manual es la de scripts/release.ts: pasa a 'clean'
    // conservando la firma, para que quede trazado que se libero y por que.
    await sequelize.query(
      `UPDATE pergamo.document SET scan_status = 'clean', scan_date = CURRENT_TIMESTAMP WHERE id = :id;`, {
      replacements: { id },
      type: QueryTypes.UPDATE
    });

    const download = await api.get(`/document/${id}/file`, { headers: { authorization: token } });

    expect(download.status).toBe(StatusCodes.OK);
    expect((await status(id)).scan_signature).toContain('ACTIVE_CONTENT');
  });

  it('Should quarantine the payload that no signature recognises', async () => {

    // Ninguna firma lo reconoce y no lleva /JavaScript: lo retiene el valor de
    // su /FontMatrix, y se retiene igual que el resto —se deposita y no se
    // entrega—, porque la politica la fija la capa, no el marcador.
    const uploaded = await upload(FONT_MATRIX);

    expect(uploaded.status).toBe(StatusCodes.OK);

    const row = await status(uploaded.data.uuid);

    expect(row.scan_status).toBe('malicious');
    expect(row.scan_signature).toContain('FontMatrix');

    const download = await api.get(`/document/${uploaded.data.uuid}/file`,
      { headers: { authorization: token } });

    expect(download.status).toBe(StatusCodes.LOCKED);
  });

  itAntivirus('Should reject the payload ClamAV recognises before it is stored', async () => {

    // La otra capa y su otra politica: una firma corta la peticion con un 400 y
    // el fichero no llega a depositarse.
    const response = await upload(SIGNED);

    expect(response.status).toBe(StatusCodes.BAD_REQUEST);
    // Sin el nombre de la firma: depende de la version de la base de datos y
    // convertiria una actualizacion de firmas en un fallo.
    expect(response.data.error).toContain('File is infected');
  });

  it('Should serve a released payload as an attachment and byte for byte', async () => {

    // La defensa que no depende de las dos capas: el contenido activo es inocuo
    // mientras nadie lo renderice. Se entrega como adjunto, con nosniff y tal
    // cual entro: sanear un PDF destruiria su huella y su firma electronica.
    const file = 'starter_pack.pdf';
    const source = path.join(PAYLOADS, file);

    const uploaded = await upload(file);

    expect(uploaded.status).toBe(StatusCodes.OK);
    expect(uploaded.data.hash).toBe(await sha256File(source));

    await sequelize.query("UPDATE pergamo.document SET scan_status = 'clean' WHERE id = :id;", {
      replacements: { id: uploaded.data.uuid },
      type: QueryTypes.UPDATE
    });

    const download = await api.get(`/document/${uploaded.data.uuid}/file`, {
      headers: { authorization: token },
      responseType: 'arraybuffer'
    });

    expect(download.status).toBe(StatusCodes.OK);
    expect(download.headers['content-disposition']).toMatch(/^attachment;/);
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(download.data).equals(fs.readFileSync(source))).toBe(true);
  });
});
