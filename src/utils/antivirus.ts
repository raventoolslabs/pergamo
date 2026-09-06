import fs from 'fs';
import NodeClam from 'clamscan';

import log from './log';
import Config from '../config';
import { StatusCodes, ValidationError } from '../middleware/error.middleware';

/**
 * El escaner no esta disponible (clamd caido, inalcanzable o incapaz de
 * procesar el fichero).
 *
 * Se distingue de una infeccion porque la respuesta correcta es distinta: una
 * infeccion es un 400 al cliente, un escaner ausente no es culpa suya. Antes
 * ambos casos acababan igual, en un 500 opaco.
 */
export class ScannerUnavailableError extends Error {
  constructor(message:string) {
    super(message);
    this.name = 'ScannerUnavailableError';
  }
}

export interface ScanResult {
  infected: boolean;
  signature?: string;
  engine: string;
}

const sleep = (ms:number) => new Promise((resolve) => setTimeout(resolve, ms));

class Antivirus {

  private clamscan;
  private engineVersion:string;

  /**
   * Opciones de conexion explicitas.
   *
   * Los defaults de NodeClam son `socket: false, host: false, port: false`, con
   * lo que ejecuta el binario `clamdscan` local en vez de abrir conexion: con
   * clamd en su propio contenedor eso no funciona.
   *
   * `localFallback: false` es igual de importante. Con el fallback activo (su
   * valor por defecto), si clamd no responde NodeClam cae al binario `clamscan`,
   * que carga la base de firmas completa en cada fichero: segundos de latencia y
   * ~1 GB de RAM por invocacion. No falla, se degrada en silencio. Preferimos
   * que falle y que la politica de indisponibilidad se aplique de forma visible.
   */
  private options() {
    return {
      // NUNCA true. Hoy solo se escanean temporales de subida, que el propio
      // controlador ya borra en su catch, asi que no aporta nada; pero la ruta
      // de reescaneo opera sobre documentos YA ALMACENADOS, y ahi un
      // removeInfected borraria el fichero del archivo ante un falso positivo.
      // El reescaneo marca; nunca borra.
      removeInfected: false,
      preference: 'clamdscan',
      clamdscan: {
        host: Config.antivirus.host,
        port: Config.antivirus.port,
        socket: Config.antivirus.socket,
        timeout: Config.antivirus.timeout,
        localFallback: false,
        active: true
      }
    };
  }

  /**
   * Conecta con clamd y deja cacheada la version del motor y de la base de
   * firmas, que es lo que identifica "con que se escaneo" cada documento.
   *
   * Se reintenta con espera fija porque clamd tarda decenas de segundos en
   * cargar las firmas: sin reintentos, un arranque simultaneo de la pila deja a
   * la API en un crash-loop hasta que el escaner termina de levantar.
   */
  async init() {

    if(this.clamscan) return;

    const attempts = Config.antivirus.init_retries + 1;

    // NodeClam devuelve el error de conexion con el mensaje vacio, asi que sin
    // esto los logs de arranque no dicen a donde se estaba intentando hablar.
    const target = Config.antivirus.socket ?
      Config.antivirus.socket : `${Config.antivirus.host}:${Config.antivirus.port}`;

    for(let attempt = 1; attempt <= attempts; attempt++) {

      try {

        const clamscan = await new NodeClam().init(this.options() as any);

        this.engineVersion = (await clamscan.getVersion()).trim();
        this.clamscan = clamscan;

        log.info(`Antivirus: ${this.engineVersion}`);

        return;

      } catch(error:any) {

        if(attempt === attempts) {
          throw new ScannerUnavailableError(
            `Antivirus unavailable at ${target} after ${attempts} attempt(s): ${error.message || error.name || 'connection refused'}`);
        }

        log.warn(`Antivirus at ${target} not ready (attempt ${attempt}/${attempts}): ${error.message || error.name || 'connection refused'}`);

        await sleep(Config.antivirus.init_retry_delay_ms);
      }
    }
  }

  /**
   * Identificador del motor y la base de firmas con que se escaneo. Se guarda
   * en la columna scan_engine y es lo que define que hay que reescanear cuando
   * las firmas avanzan.
   */
  get engine() {
    return this.engineVersion ? this.engineVersion.substring(0, 64) : null;
  }

  /**
   * Analiza un fichero y devuelve el veredicto, sin lanzar por infeccion.
   *
   * Se escanea por INSTREAM (`scanStream`) y no por ruta: clamd corre en otro
   * contenedor y no ve el sistema de ficheros de la aplicacion. Es tambien el
   * motivo por el que StreamMaxLength es el limite critico de clamd.conf.
   */
  check = async (filePath:string):Promise<ScanResult> => {

    await this.init();

    const stream = fs.createReadStream(filePath);

    try {

      const { isInfected, viruses } = await this.clamscan.scanStream(stream);

      return {
        infected: !!isInfected,
        signature: viruses?.length ? viruses.join(', ') : undefined,
        engine: this.engine
      };

    } catch(error:any) {

      // Un fallo aqui no es un veredicto: es ausencia de veredicto. Se propaga
      // como tal para que el llamante no lo confunda con "limpio".
      throw new ScannerUnavailableError(
        `Scan failed for ${filePath} against ${Config.antivirus.socket || `${Config.antivirus.host}:${Config.antivirus.port}`}: ${error.message || error.name || 'connection refused'}`);

    } finally {
      stream.destroy();
    }
  }

  /**
   * Variante para las rutas de subida: una infeccion corta la peticion con un
   * 400. La indisponibilidad del escaner se propaga como ScannerUnavailableError
   * y la decide el controlador.
   */
  scan = async (filePath:string, req:any):Promise<ScanResult> => {

    const result = await this.check(filePath);

    if(result.infected) throw new ValidationError(StatusCodes.BAD_REQUEST,
      'FILE_CORRUPT', `File is infected with ${result.signature}`, req);

    return result;
  }
}

export default new Antivirus();
