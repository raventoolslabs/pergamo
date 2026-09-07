import fs from "fs";
import path from "path";

import sequelize, { QueryTypes } from "./db";
import log from "./log";

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// Esquema que crea config/init.sql. Las instalaciones anteriores al runner ya
// lo tienen aplicado, asi que se marca en vez de volver a ejecutarlo.
const BASELINE_ID = '001_init';

const ensureMigrationsTable = async () => {

  await sequelize.query('CREATE SCHEMA IF NOT EXISTS pergamo;');

  await sequelize.query(`CREATE TABLE IF NOT EXISTS pergamo.schema_migrations(
    id VARCHAR(128) NOT NULL,
    applied_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT schema_migrations_pk PRIMARY KEY(id)
  );`);
}

const appliedMigrations = async () => {

  const rows:any = await sequelize.query('SELECT id FROM pergamo.schema_migrations;', {
    type: QueryTypes.SELECT
  });

  return new Set<string>(rows.map((row:any) => row.id));
}

const schemaAlreadyExists = async () => {

  const rows:any = await sequelize.query(
    "SELECT to_regclass('pergamo.document') IS NOT NULL AS present;", {
    type: QueryTypes.SELECT
  });

  return rows[0]?.present === true;
}

const markApplied = async (id:string, transaction?:any) => {

  await sequelize.query('INSERT INTO pergamo.schema_migrations(id) VALUES (:id);', {
    replacements: { id },
    type: QueryTypes.INSERT,
    transaction
  });
}

/**
 * Aplica en orden las migraciones pendientes, cada una en su propia transaccion
 * junto con su registro: o se aplica entera o no deja rastro.
 *
 * Se invoca tambien en instalaciones ya inicializadas: es el unico camino por
 * el que una base existente recibe cambios de esquema.
 */
export const runMigrations = async () => {

  await ensureMigrationsTable();

  const applied = await appliedMigrations();

  if(applied.size === 0 && await schemaAlreadyExists()) {
    await markApplied(BASELINE_ID);
    applied.add(BASELINE_ID);
    log.info(`Migration ${BASELINE_ID} recorded as applied (schema already present)`);
  }

  const exists = await fs.promises.access(MIGRATIONS_DIR).then(() => true).catch(() => false);

  if(!exists) return;

  const files = (await fs.promises.readdir(MIGRATIONS_DIR))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for(const file of files) {

    const id = path.basename(file, '.sql');

    if(applied.has(id)) continue;

    const script = await fs.promises.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const transaction = await sequelize.transaction();

    try {

      await sequelize.query(script, { transaction });
      await markApplied(id, transaction);
      await transaction.commit();

      log.info(`Migration applied: ${id}`);

    } catch(error:any) {

      await transaction.rollback();

      throw new Error(`Migration ${id} failed and was rolled back: ${error.message}`);
    }
  }
}

export default { runMigrations, BASELINE_ID };
