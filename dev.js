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
const EJEMPLO = '.env.dev.example';

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

const PUERTO_API = Number.parseInt(entorno.PORT || '3000', 10);
const PUERTO_WEB = Number.parseInt(process.env.PERGAMO_DEV_WEB_PORT || '5173', 10);

// Por defecto solo el equipo local. Abrirlo a la red no basta con esto: el
// firewall del host tiene politica DROP y solo admite 22, 80 y 443.
const HOST = process.env.PERGAMO_DEV_HOST || '127.0.0.1';

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

  for (const [puerto, quien] of [[PUERTO_API, 'la API'], [PUERTO_WEB, 'la interfaz']]) {
    if (!(await puertoLibre(puerto))) {
      morir(
        `El puerto ${puerto} ya esta ocupado, y lo necesita ${quien}.`,
        `  ss -ltnp 'sport = :${puerto}'\n\n` +
        '  Puede ser un arranque anterior que no llego a morir, u otro servicio\n' +
        `  del host. El 3000, por ejemplo, lo tiene el contenedor de produccion.`
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

  const init = spawnSync('npx', ['ts-node', 'src/init.ts'], {
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
  const lanzar = (nombre, comando, argumentos, extra = {}, directorio = RAIZ) => {
    const hijo = spawn(comando, argumentos, {
      cwd: directorio,
      stdio: 'inherit',
      detached: true,
      env: { ...process.env, ...extra }
    });

    hijo.on('exit', (codigo, senal) => {
      if (cerrando) return;
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

  lanzar('La API', path.join(RAIZ, 'node_modules', '.bin', 'ts-node'), ['src/index.ts']);

  // PERGAMO_API es lo que hace que el proxy de Vite hable con ESTA API y no con
  // la de produccion, que escucha en el 3000 por defecto.
  lanzar(
    'La interfaz',
    path.join(RAIZ, 'web', 'node_modules', '.bin', 'vite'),
    ['--host', HOST, '--port', String(PUERTO_WEB), '--strictPort'],
    { PERGAMO_API: `http://127.0.0.1:${PUERTO_API}` },
    path.join(RAIZ, 'web')
  );

  console.log(`
${fuerte('Pergamo en desarrollo')}

  Interfaz   ${verde(`http://${HOST}:${PUERTO_WEB}`)}
  API        ${gris(`http://${HOST}:${PUERTO_API}`)}
  Base       ${gris(`${entorno.DB_NAME} en ${dbHost}:${dbPort}`)}
  Antivirus  ${gris(entorno.ENABLE_ANTIVIRUS === 'true' ? 'activado' : 'desactivado')}

  Entra como ${fuerte(entorno.USER_MASTER || 'master')} para administrar organizaciones,
  o como ${fuerte('pergamo')} para trabajar con documentos. Ctrl+C para parar.
`);
};

arrancar().catch((error) => morir(error.message));
