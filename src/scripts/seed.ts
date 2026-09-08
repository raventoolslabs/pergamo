import fs from 'fs';
import path from 'path';
import http from 'http';

import Config from '@/shared/config';
import log from '@/shared/logger';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { app } from '@/server';

/**
 * Siembra de documentos de ejemplo, uno por cada estado de analisis.
 *
 * Uso: npm run dev:seed              (anade los cinco)
 *      npm run dev:seed -- --clean   (borra los que sembro y sale)
 *
 * Tres de los estados no se pueden provocar desde fuera sin un ClamAV con
 * firmas reales, asi que sin este script revisar la interfaz en desarrollo
 * significaba mirar siempre el unico caso comodo.
 *
 * Levanta la aplicacion en un puerto efimero y sube por su propia API:
 * replicar aqui la escritura en disco, el hash y el path derivado del uuid
 * seria una segunda implementacion de utils/files.ts. Lo unico que se fuerza
 * por SQL es el veredicto.
 *
 * No es una herramienta de produccion: se niega a correr contra una base de
 * datos cuyo nombre no delate un entorno de desarrollo o prueba.
 */

const MARK = 'pergamo:seed';

const ASSETS = path.join(__dirname, '..', '..', 'test', 'assets');

/**
 * Cadena inventada a proposito: scan_engine es lo que decide que hay que
 * reescanear (`npm run rescan` selecciona por `scan_engine <> :engine`), de modo
 * que un valor antiguo deja los documentos de ejemplo en la cola del primer
 * reescaneo real.
 */
const ENGINE = 'ClamAV 0.0.0/0';

interface Seed {
  file: string;
  name: string;
  description: string;
  tags: string[];
  scan_status: string;
  scan_signature: string|null;
  scan_engine: string|null;
  /** El estado 'error' significa que el fichero no esta en disco, asi que se
      borra de verdad: un 'error' con el fichero en su sitio seria un decorado. */
  removeFile?: boolean;
  /** El estado lo produce el propio deposito y no se fuerza. Si el deposito no
      lo produce, el script avisa en vez de disimularlo. */
  natural?: boolean;
}

const SEEDS:Seed[] = [
  {
    file: 'test.pdf',
    name: 'acta-analizada',
    description: 'Analizado sin hallazgos: se descarga con normalidad.',
    tags: ['ejemplo', 'analizado'],
    scan_status: 'clean',
    scan_signature: null,
    scan_engine: ENGINE
  },
  {
    file: 'test2.pdf',
    name: 'informe-sin-veredicto',
    description: 'Aceptado mientras el escaner no respondia: se entrega igual, y el proximo analisis le dara veredicto.',
    tags: ['ejemplo', 'pendiente'],
    scan_status: 'pending',
    scan_signature: null,
    scan_engine: null
  },
  {
    // payload1.pdf es el unico del corpus que ClamAV reconoce, asi que este
    // documento lleva dentro exactamente lo que dice su scan_signature. Con el
    // antivirus activo lo rechaza la subida, y el script lo dice y sigue.
    file: path.join('payloads', 'payload1.pdf'),
    name: 'expediente-con-firma-virica',
    description: 'Una firma de ClamAV lo senalo. Bloqueado para descarga.',
    tags: ['ejemplo', 'cuarentena'],
    scan_status: 'infected',
    scan_signature: 'Html.Exploit.CVE_2016_3198-1',
    scan_engine: ENGINE
  },
  {
    // Este no se fuerza: el propio deposito lo deja en 'malicious', que es lo
    // que interesa mirar por la interfaz.
    file: path.join('payloads', 'payload3.pdf'),
    name: 'contrato-con-contenido-activo',
    description: 'PDF con JavaScript y accion al abrir. Solo sale de aqui por revision manual.',
    tags: ['ejemplo', 'cuarentena'],
    scan_status: 'malicious',
    scan_signature: null,
    scan_engine: null,
    natural: true
  },
  {
    file: 'test.pdf',
    name: 'memoria-sin-fichero',
    description: 'La fila describe un contenido que no esta en el almacen: hay que revisar el volumen de datos.',
    tags: ['ejemplo', 'error'],
    scan_status: 'error',
    scan_signature: 'FILE_MISSING',
    scan_engine: ENGINE,
    removeFile: true
  }
];

/**
 * Este script escribe documentos de mentira e invalida ficheros en disco: un
 * despiste de .env apuntando a produccion no puede costar eso, y el nombre de
 * la base es la senal que siempre esta disponible.
 */
const checkEnvironment = () => {

  const name = Config.db.name || '';

  if(/(_dev|_test|_local)$/.test(name) || process.argv.includes('--force')) return;

  throw new Error(
    `DB_NAME "${name}" does not look like a development environment (expected a _dev, _test or _local suffix). ` +
    'Repeat with --force to seed there anyway.');
};

const call = (server:http.Server, method:string, route:string, headers:any, body?:Buffer):Promise<any> =>
  new Promise((resolve, reject) => {

    const request = http.request({
      host: '127.0.0.1',
      port: (server.address() as any).port,
      method,
      path: route,
      headers
    }, (response) => {

      const chunks:Buffer[] = [];

      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {

        const text = Buffer.concat(chunks).toString();

        resolve({
          status: response.statusCode,
          body: text ? JSON.parse(text) : null
        });
      });
    });

    request.on('error', reject);

    if(body) request.write(body);

    request.end();
  });

/**
 * Cuerpo multipart a mano: form-data es dependencia de desarrollo y este script
 * corre tambien desde dist/, donde puede no estar instalada.
 */
const multipart = (filename:string, content:Buffer) => {

  const boundary = `----pergamo-seed-${Date.now()}`;

  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="document"; filename="${filename}"\r\n` +
    'Content-Type: application/pdf\r\n\r\n');

  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);

  return {
    boundary,
    body: Buffer.concat([header, content, footer])
  };
};

const clean = async () => {

  const rows:any = await sequelize.query(
    `SELECT id, organization, path FROM pergamo.document WHERE metadata->>'origin' = :mark;`, {
    replacements: { mark: MARK },
    type: QueryTypes.SELECT
  });

  for(const row of rows) {

    const filePath = path.join(Config.path_base, row.organization, row.path);

    if(fs.existsSync(filePath)) await fs.promises.unlink(filePath);

    await sequelize.query('DELETE FROM pergamo.document WHERE id = :id;', {
      replacements: { id: row.id },
      type: QueryTypes.DELETE
    });
  }

  log.info(`Seed: ${rows.length} sample document(s) removed`);
};

const seed = async () => {

  const server = await app(0);

  try {

    // Se entra como organizacion y no como maestro: el token del maestro no
    // lleva organizacion, y un documento pertenece siempre a una. La que crea
    // `npm run dev:init` se llama como el despliegue y comparte la contrasena
    // maestra; con --org=<nombre> se siembra en otra.
    const argument = process.argv.find((value) => value.startsWith('--org='));
    const organization = argument ? argument.slice('--org='.length) : (process.env.SEED_ORGANIZATION || 'pergamo');

    const login = await call(server, 'POST', '/organization/login',
      { 'content-type': 'application/json' },
      Buffer.from(JSON.stringify({ name: organization, password: Config.password_master })));

    const token = login.body?.token;

    if(!token) throw new Error(
      `Could not sign in to organization "${organization}" with PASSWORD_MASTER ` +
      `(${login.status}: ${login.body?.error}). Check the .env, that "npm run dev:init" has run, ` +
      'or pass another one with --org=<name>.');

    for(const item of SEEDS) {

      const source = path.join(ASSETS, item.file);

      if(!fs.existsSync(source)) {
        log.warn(`Seed: missing ${source}; skipping "${item.name}"`);
        continue;
      }

      const { boundary, body } = multipart(`${item.name}.pdf`, await fs.promises.readFile(source));

      const upload = await call(server, 'POST', '/document', {
        authorization: token,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': body.length
      }, body);

      // Con ENABLE_ANTIVIRUS activo el documento en cuarentena es rechazado en
      // la subida, que es lo que debe pasar: ahi el escaner real ya provee el
      // caso y no hace falta simularlo.
      if(upload.status !== 200) {
        log.warn(`Seed: "${item.name}" rejected on upload (${upload.status}: ${upload.body?.error}); skipping`);
        continue;
      }

      const id = upload.body.uuid;

      await call(server, 'PUT', `/document/${id}`, {
        authorization: token,
        'content-type': 'application/json'
      }, Buffer.from(JSON.stringify({
        name: item.name,
        description: item.description,
        tags: item.tags
      })));

      const stored:any = await sequelize.query(
        'SELECT scan_status FROM pergamo.document WHERE id = :id;', {
        replacements: { id },
        type: QueryTypes.SELECT
      });

      const force = !item.natural;

      if(item.natural && stored[0].scan_status !== item.scan_status) {
        log.warn(`Seed: "${item.name}" should have landed on ${item.scan_status} by itself and is on ${stored[0].scan_status}: check the active content filter (MALICIOUS_ACTIVE_CONTENT_IGNORE)`);
      }

      // La marca va en metadata y no en una tabla aparte para que --clean
      // encuentre exactamente lo que sembro este script y nada mas.
      await sequelize.query(
        `UPDATE pergamo.document
        SET scan_status = CASE WHEN :force THEN :scan_status ELSE scan_status END,
            scan_signature = CASE WHEN :force THEN :scan_signature ELSE scan_signature END,
            scan_engine = CASE WHEN :force THEN :scan_engine ELSE scan_engine END,
            scan_date = CASE WHEN :force AND :scan_engine::varchar IS NULL THEN NULL
                             WHEN :force THEN CURRENT_TIMESTAMP
                             ELSE scan_date END,
            metadata = jsonb_set(metadata, '{origin}', to_jsonb(:mark::text))
        WHERE id = :id;`, {
        replacements: {
          id,
          mark: MARK,
          force,
          scan_status: item.scan_status,
          scan_signature: item.scan_signature,
          scan_engine: item.scan_engine
        },
        type: QueryTypes.UPDATE
      });

      if(item.removeFile) {

        const rows:any = await sequelize.query(
          'SELECT organization, path FROM pergamo.document WHERE id = :id;', {
          replacements: { id },
          type: QueryTypes.SELECT
        });

        await fs.promises.unlink(path.join(Config.path_base, rows[0].organization, rows[0].path));
      }

      log.info(`Seed: "${item.name}" (${id}) on status ${item.scan_status}${force ? '' : ' (set by the deposit itself)'}`);
    }

  } finally {
    server.close();
  }
};

const main = async () => {

  checkEnvironment();

  if(process.argv.includes('--clean')) return clean();

  // Sembrar dos veces no debe dar diez documentos: primero se retira lo que
  // dejo la ejecucion anterior.
  await clean();

  await seed();
};

main()
  .then(() => sequelize.close())
  .then(() => process.exit(0))
  .catch(async (error) => {
    log.error(`Seed failed: ${error.message}`);
    await sequelize.close().catch(() => undefined);
    process.exit(1);
  });
