import { Sequelize, QueryTypes, DataTypes } from 'sequelize';
import pg from 'pg'
import Config from '@/shared/config';

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