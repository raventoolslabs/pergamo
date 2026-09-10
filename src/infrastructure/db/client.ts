import { Sequelize, QueryTypes, DataTypes } from 'sequelize';
import pg from 'pg'
import Config from '@/shared/config';

/**
 * Las columnas TIMESTAMP WITHOUT TIME ZONE guardan UTC —CURRENT_TIMESTAMP sobre
 * un servidor en UTC—, pero el driver las lee como hora local del proceso. Con
 * la API fuera de UTC eso desplaza cada fecha por el desfase del equipo y el
 * error solo se ve cuando dos fechas de la misma operacion aparecen juntas.
 */
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP,
  (value:string) => value === null ? null : new Date(`${value.replace(' ', 'T')}Z`));

const configDatabase:any = {
  username: Config.db.username,
  password: Config.db.password,
  port: Config.db.port,
  host: Config.db.host,
  database: Config.db.name,
  dialect: 'postgres',
  protocol: 'postgres',
  logging: false,
  define: {
    timestamps: false,
  },
  // Explicito en lugar de heredar los valores por defecto de Sequelize, para
  // que el dimensionamiento sea una decision visible y ajustable.
  pool: {
    max: process.env.DB_POOL_MAX ? Number.parseInt(process.env.DB_POOL_MAX) : 10,
    min: process.env.DB_POOL_MIN ? Number.parseInt(process.env.DB_POOL_MIN) : 0,
    acquire: 35000,
    idle: 10000
  },
  dialectOptions: {
    dialectModule: pg,
    connectTimeout: 35000,
    multipleStatements: true,
  }
}

if(Config.db.ssl) {
  configDatabase.dialectOptions.ssl = {
    require: Config.db.ssl,
    rejectUnauthorized: false
  }
}

export default new Sequelize(configDatabase)

export { QueryTypes, DataTypes };