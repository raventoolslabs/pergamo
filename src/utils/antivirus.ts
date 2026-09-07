import fs from 'fs';
import NodeClam from 'clamscan';

import log from './log';
import Config from '../config';
import { StatusCodes, ValidationError } from '../middleware/error.middleware';

// El escaner no esta disponible. Se distingue de una infeccion porque la
// respuesta es otra: la infeccion es un 400 al cliente, esto no es culpa suya.
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
   * Conexion explicita: por defecto NodeClam ejecuta el binario local en vez de
   * abrir conexion, y con clamd en su propio contenedor eso no funciona.
   *
   * `localFallback: false` importa lo mismo: con el fallback activo, un clamd
   * que no responde cae al binario `clamscan`, que carga la base de firmas
   * entera por fichero. No falla, se degrada en silencio.
   */
  private options() {
    return {
      // Nunca true: el reescaneo opera sobre documentos ya almacenados, y ahi
      // esto borraria del archivo un falso positivo. El reescaneo marca.
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
   * Conecta y cachea la version del motor y de las firmas, que es lo que
   * identifica con que se escaneo cada documento.
   *
   * Se reintenta porque clamd tarda decenas de segundos en cargar las firmas:
   * sin esto, un arranque simultaneo de la pila deja la API en crash-loop.
   */
  async init() {

    if(this.clamscan) return;

    const attempts = Config.antivirus.init_retries + 1;

    // NodeClam devuelve el error de conexion sin mensaje: sin esto los logs no
    // dicen con quien se estaba intentando hablar.
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

  /** Va a scan_engine, y es lo que define que hay que reescanear cuando las
      firmas avanzan. */
  get engine() {
    return this.engineVersion ? this.engineVersion.substring(0, 64) : null;
  }

  /**
   * Devuelve el veredicto sin lanzar por infeccion. Por INSTREAM y no por ruta:
   * clamd corre en otro contenedor y no ve el sistema de ficheros, que es
   * ademas por lo que StreamMaxLength es el limite critico de clamd.conf.
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

      // Un fallo aqui es ausencia de veredicto, no un veredicto: se propaga
      // como tal para que nadie lo confunda con «limpio».
      throw new ScannerUnavailableError(
        `Scan failed for ${filePath} against ${Config.antivirus.socket || `${Config.antivirus.host}:${Config.antivirus.port}`}: ${error.message || error.name || 'connection refused'}`);

    } finally {
      stream.destroy();
    }
  }

  /** Variante para las subidas: una infeccion corta la peticion con un 400; la
      indisponibilidad se propaga y la decide el controlador. */
  scan = async (filePath:string, req:any):Promise<ScanResult> => {

    const result = await this.check(filePath);

    if(result.infected) throw new ValidationError(StatusCodes.BAD_REQUEST,
      'FILE_CORRUPT', `File is infected with ${result.signature}`, req);

    return result;
  }
}

export default new Antivirus();
