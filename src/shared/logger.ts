import Config from "@/shared/config";

const pino = require('pino')

// pino-pretty formatea cada linea para lectura humana, con un coste por linea
// que no interesa en produccion: alli se emite JSON estructurado, que es
// ademas lo que esperan los agregadores de logs.
const log = process.env.NODE_ENV === 'production' ?
  pino() :
  pino(pino.transport({
    target: 'pino-pretty',
    options: { destination: 1 }
  }));

if(Config.debug) log.level =  'debug';

export default log;
