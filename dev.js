#!/usr/bin/env node
/**
 * Arranque de desarrollo: `npm run dev`.
 *
 * Levanta la API con ts-node y la interfaz con Vite, ya enlazadas, y deja el
 * esquema al dia. Antes esto eran tres comandos en dos terminales y un `.env`
 * que nadie sabia como rellenar.
 *
 * Sin dependencias nuevas: solo child_process. Meter un `concurrently` para
 * lanzar dos procesos seria pagar un arbol de dependencias por veinte lineas.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const RAIZ = __dirname;
const ENV_FILE = path.join(RAIZ, '.env');
const EJEMPLO = '.env.example';

const rojo = (texto) => `\x1b[31m${texto}\x1b[0m`;
const verde = (texto) => `\x1b[32m${texto}\x1b[0m`;
const gris = (texto) => `\x1b[90m${texto}\x1b[0m`;
const fuerte = (texto) => `\x1b[1m${texto}\x1b[0m`;

const morir = (mensaje, ayuda) => {
  console.error(`\n${rojo('✗')} ${mensaje}`);
  if (ayuda) console.error(`\n${ayuda}\n`);
  process.exit(1);
};

/* --------------------------------------------------------------- entorno -- */

if (!fs.existsSync(ENV_FILE)) {
  morir(
    'No hay .env, y la configuracion se valida al arrancar.',
    `  cp ${EJEMPLO} .env\n\n` +
    `  Despues rellena DB_PASSWORD. ${EJEMPLO} explica como preparar\n` +
    '  la base de datos de desarrollo, que es un paso de una sola vez.'
  );
}

/**
 * Lectura minima del .env, solo para saber a que puerto y a que base apuntar.
 * La configuracion de verdad la carga la aplicacion con dotenv; aqui no se
 * interpreta nada mas de lo necesario.
 */
const entorno = {};

for (const linea of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const pareja = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linea);
  if (!pareja) continue;
  entorno[pareja[1]] = pareja[2].trim().replace(/^["']|["']$/g, '');
}

const PUERTO_API = Number.parseInt(entorno.PORT || '3001', 10);

/**
 * Los mismos defectos que shared/config: vacio es 127.0.0.1:3310, y el worker va
 * embebido salvo que se diga lo contrario.
 *
 * El entorno gana al fichero porque dotenv hace justo eso —no pisa lo que ya
 * esta en process.env—, y asi `ENABLE_ANTIVIRUS=true npm run dev` prueba una
 * configuracion sin editar el .env.
 */
const ajuste = (clave) => process.env[clave] ?? entorno[clave];

const ANTIVIRUS = ajuste('ENABLE_ANTIVIRUS') === 'true';
const CLAMAV_HOST = ajuste('CLAMAV_HOST') || '127.0.0.1';
const CLAMAV_PORT = Number.parseInt(ajuste('CLAMAV_PORT') || '3310', 10);
const CLAMAV_SOCKET = ajuste('CLAMAV_SOCKET') || '';

const INDEXA = ajuste('INDEXING_ENABLED') === 'true';
const WORKER_EMBEBIDO = ajuste('INDEXING_WORKER_EMBEDDED') !== 'false';

// El 3000 es la puerta de entrada: la misma que publica el contenedor, para
// que el proxy inverso apunte siempre ahi y no haya que tocarlo al cambiar de
// entorno. Aqui lo ocupa Vite, y la API se va al 3001.
const PUERTO_WEB = Number.parseInt(process.env.PERGAMO_DEV_WEB_PORT || entorno.PERGAMO_DEV_WEB_PORT || '3000', 10);

// Por defecto solo el equipo local. Abrirlo a la red no basta con esto: el
// firewall del host tiene politica DROP y solo admite 22, 80 y 443. El proxy
// inverso llega por host networking, asi que alcanza este 127.0.0.1.
const HOST = process.env.PERGAMO_DEV_HOST || entorno.PERGAMO_DEV_HOST || '127.0.0.1';

// Host publico con el que se sirve la interfaz detras del proxy inverso. Vite
// lo necesita para no bloquear la peticion por el 'Host' y para dirigir ahi el
// websocket del HMR.
const WEB_HOST = process.env.PERGAMO_WEB_HOST || entorno.PERGAMO_WEB_HOST || '';

/* -------------------------------------------------------------- comprobar -- */

const puedeConectar = (host, puerto, timeout = 2000) => new Promise((resolve) => {
  const socket = new net.Socket();
  const cerrar = (resultado) => { socket.destroy(); resolve(resultado); };

  socket.setTimeout(timeout);
  socket.once('connect', () => cerrar(true));
  socket.once('timeout', () => cerrar(false));
  socket.once('error', () => cerrar(false));
  socket.connect(puerto, host);
});

const puertoLibre = async (puerto) => !(await puedeConectar('127.0.0.1', puerto, 400));

const arrancar = async () => {

  const dbHost = entorno.DB_HOST || '127.0.0.1';
  const dbPort = Number.parseInt(entorno.DB_PORT || '5432', 10);

  if (!(await puedeConectar(dbHost, dbPort))) {
    morir(
      `No responde PostgreSQL en ${dbHost}:${dbPort} (base ${entorno.DB_NAME || '?'}).`,
      '  docker start postgres\n\n' +
      `  Si la base de desarrollo no existe todavia, ${EJEMPLO} explica como crearla.`
    );
  }

  // Lo que la configuracion promete tiene que estar antes de arrancar. Sin esto
  // el fallo aparece mas tarde y disfrazado: sin clamd, cada subida queda
  // 'pending' sin decir por que; sin Redis, se deposita y no se encola nada.

  if (ANTIVIRUS && CLAMAV_SOCKET && !fs.existsSync(CLAMAV_SOCKET)) {
    morir(
      `No existe el socket ${CLAMAV_SOCKET}, y ENABLE_ANTIVIRUS=true.`,
      '  systemctl status clamav-daemon\n\n' +
      '  El paquete de Debian lo pone en /run/clamav/clamd.ctl; comprueba la\n' +
      '  ruta en LocalSocket de /etc/clamav/clamd.conf.'
    );
  }

  if (ANTIVIRUS && !CLAMAV_SOCKET && !(await puedeConectar(CLAMAV_HOST, CLAMAV_PORT))) {
    morir(
      `No responde clamd en ${CLAMAV_HOST}:${CLAMAV_PORT}, y ENABLE_ANTIVIRUS=true.`,
      '  Un clamav-daemon instalado en el sistema NO escucha en TCP: el paquete\n' +
      '  de Debian declara solo LocalSocket. Si lo tienes, apunta ahi:\n\n' +
      '    CLAMAV_SOCKET=/run/clamav/clamd.ctl\n\n' +
      '  ENABLE_ANTIVIRUS=false   para seguir sin antivirus (los depositos\n' +
      '                           quedan «Analisis pendiente», que se entrega).\n\n' +
      '  La pila de docker/ NO publica el 3310 al host a proposito: clamd no\n' +
      '  autentica. Para alcanzarlo por red hay que publicarlo en\n' +
      '  docker/docker-compose.yml.'
    );
  }

  if (INDEXA) {

    let redis;

    try {
      redis = new URL(ajuste('REDIS_URL') || 'redis://127.0.0.1:6379');
    } catch {
      morir(`REDIS_URL no es una URL valida: ${ajuste('REDIS_URL')}`);
    }

    const puerto = Number.parseInt(redis.port || '6379', 10);

    if (!(await puedeConectar(redis.hostname, puerto))) {
      morir(
        `No responde Redis en ${redis.hostname}:${puerto}, y INDEXING_ENABLED=true.`,
        '  docker start redis\n\n' +
        '  Sin cola, un documento se deposita bien pero nunca llega a indexarse:\n' +
        '  se queda en «En cola» hasta que un barrido lo recoja.\n' +
        '  INDEXING_ENABLED=false   para trabajar sin indice.'
      );
    }
  }

  // La API y la interfaz no pueden pedir el mismo puerto. Pasa en cuanto un
  // .env se copia de un despliegue, donde PORT es 3000 porque ahi la aplicacion
  // sirve las dos cosas a la vez; aqui son dos procesos.
  if (PUERTO_API === PUERTO_WEB) {
    morir(
      `La API y la interfaz piden las dos el puerto ${PUERTO_API}.`,
      `  PORT=3001   en ${path.basename(ENV_FILE)}\n\n` +
      '  El 3000 es la puerta de entrada y lo ocupa la interfaz, que es a donde\n' +
      '  apunta el proxy inverso; la API va detras, en el 3001.'
    );
  }

  for (const [puerto, quien] of [[PUERTO_API, 'la API'], [PUERTO_WEB, 'la interfaz']]) {
    if (!(await puertoLibre(puerto))) {
      morir(
        `El puerto ${puerto} ya esta ocupado, y lo necesita ${quien}.`,
        `  ss -ltnp 'sport = :${puerto}'\n\n` +
        '  Puede ser un arranque anterior que no llego a morir, u otro servicio\n' +
        '  del host. El 3000 lo comparten a proposito este entorno y el\n' +
        '  contenedor, para que el proxy inverso apunte siempre al mismo sitio:\n' +
        '  si lo tiene el contenedor, `docker stop pergamo` y vuelve a probar.'
      );
    }
  }

  /* ------------------------------------------------------------ migrar -- */
  //
  // src/init.ts es idempotente: crea esquema y claves solo si no existe
  // data/.key, y siempre aplica las migraciones pendientes. Ejecutarlo en cada
  // arranque es lo que evita el clasico "me falla algo raro" despues de un pull
  // que trae una migracion nueva.

  console.log(gris('→ Preparando esquema y claves…'));

  const init = spawnSync('npx', ['ts-node', '-r', 'tsconfig-paths/register', 'src/init.ts'], {
    cwd: RAIZ,
    stdio: 'inherit',
    env: process.env
  });

  if (init.status !== 0) morir('La preparacion del esquema ha fallado (ver el error arriba).');

  /* ----------------------------------------------------------- procesos -- */

  const hijos = [];
  let cerrando = false;

  /**
   * Cada hijo va en su PROPIO grupo de procesos (detached), y se mata el grupo
   * entero, no el proceso.
   *
   * ts-node y vite son scripts que lanzan a su vez el node de verdad: una senal
   * al proceso directo deja al nieto escuchando en el puerto, y el siguiente
   * arranque falla con «puerto ocupado» sin que se vea quien lo tiene.
   *
   * Efecto secundario deseado: con el hijo en otro grupo, un Ctrl+C en la
   * terminal llega solo a este lanzador, que es quien decide como se cierra
   * todo y en que orden.
   */
  const lanzar = (nombre, comando, argumentos, extra = {}, directorio = RAIZ, critico = true) => {
    const hijo = spawn(comando, argumentos, {
      cwd: directorio,
      stdio: 'inherit',
      detached: true,
      env: { ...process.env, ...extra }
    });

    hijo.on('exit', (codigo, senal) => {
      if (cerrando) return;

      // El worker es auxiliar: si se cae —la maquina de inferencia no responde,
      // el esquema del indice no cuadra— la API y la interfaz siguen sirviendo.
      // Tumbarlas por eso convertiria un fallo del indice en uno del archivo.
      if (!critico) {
        console.error(`\n${rojo('✗')} ${nombre} ha terminado (${senal || `codigo ${codigo}`}). El resto sigue.`);
        return;
      }

      // Si uno cae, el otro no tiene sentido: se cierra todo. De lo contrario
      // queda un ts-node huerfano ocupando el puerto y el siguiente arranque
      // falla sin motivo aparente.
      console.error(`\n${rojo('✗')} ${nombre} ha terminado (${senal || `codigo ${codigo}`}). Cerrando el resto.`);
      apagar(codigo === null ? 1 : codigo);
    });

    hijos.push(hijo);
    return hijo;
  };

  const matarGrupo = (hijo, senal) => {
    try {
      // El negativo es lo que convierte esto en «al grupo entero».
      process.kill(-hijo.pid, senal);
    } catch (error) {
      // ESRCH: ya no queda nadie en el grupo. Es el caso normal en el segundo
      // barrido, no un fallo.
      if (error.code !== 'ESRCH') throw error;
    }
  };

  const apagar = (codigo = 0) => {
    if (cerrando) return;
    cerrando = true;

    for (const hijo of hijos) matarGrupo(hijo, 'SIGTERM');

    // Margen para que cierren solos; despues se insiste sin preguntar. El
    // temporizador NO se desreferencia a proposito: los hijos van detached y no
    // mantienen vivo a este proceso, asi que sin el se saldria antes del
    // segundo barrido.
    setTimeout(() => {
      for (const hijo of hijos) matarGrupo(hijo, 'SIGKILL');
      process.exit(codigo);
    }, 2000);
  };

  process.on('SIGINT', () => apagar(0));
  process.on('SIGTERM', () => apagar(0));

  lanzar('La API', path.join(RAIZ, 'node_modules', '.bin', 'ts-node'), ['-r', 'tsconfig-paths/register', 'src/index.ts']);

  // PERGAMO_API es lo que hace que el proxy de Vite hable con ESTA API y no con
  // otra. PERGAMO_WEB_HOST es lo que permite que la interfaz se sirva por el
  // dominio publico: sin el, Vite responde «Blocked request» a todo lo que no
  // llegue como localhost (ver web/vite.config.ts).
  lanzar(
    'La interfaz',
    path.join(RAIZ, 'web', 'node_modules', '.bin', 'vite'),
    ['--host', HOST, '--port', String(PUERTO_WEB), '--strictPort'],
    { PERGAMO_API: `http://127.0.0.1:${PUERTO_API}`, PERGAMO_WEB_HOST: WEB_HOST },
    path.join(RAIZ, 'web')
  );

  // Con el worker embebido lo arranca la propia API (server.ts). Sin el, no lo
  // arrancaba nadie: la cola crecia y los documentos se quedaban en 'pending'
  // sin ningun aviso, que es como se pierde una tarde.
  if (INDEXA && !WORKER_EMBEBIDO) {
    lanzar(
      'El worker de indexacion',
      path.join(RAIZ, 'node_modules', '.bin', 'ts-node'),
      ['-r', 'tsconfig-paths/register', 'src/worker.ts'],
      {}, RAIZ, false
    );
  }

  const indexacion = !INDEXA ? 'desactivada'
    : `activada  ${WORKER_EMBEBIDO ? '(worker en la API)' : '(worker aparte)'}`;

  console.log(`
${fuerte('Pergamo en desarrollo')}

  Interfaz   ${verde(`http://${HOST}:${PUERTO_WEB}`)}${WEB_HOST ? gris(`  ·  https://${WEB_HOST}`) : ''}
  API        ${gris(`http://${HOST}:${PUERTO_API}`)}
  Base       ${gris(`${entorno.DB_NAME} en ${dbHost}:${dbPort}`)}
  Antivirus  ${gris(ANTIVIRUS ? `activado  (${CLAMAV_SOCKET || `${CLAMAV_HOST}:${CLAMAV_PORT}`})` : 'desactivado')}
  Indexacion ${gris(indexacion)}

  Entra como ${fuerte(entorno.USER_MASTER || 'master')} para administrar organizaciones,
  o como ${fuerte('pergamo')} para trabajar con documentos. Ctrl+C para parar.
`);
};

arrancar().catch((error) => morir(error.message));
