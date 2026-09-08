import fs from "fs";
import path from "path";
import crypto from "crypto";

import FilesUtils from '@/infrastructure/files/storage';
import Config from '@/shared/config';
import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { runMigrations } from '@/infrastructure/db/migration-runner';
import log from '@/shared/logger';

const createSchema = async () => {

  const script = fs.readFileSync(path.join(__dirname, 'infrastructure', 'db', 'sql', 'init.sql')).toString();
  const transaction = await sequelize.transaction();

  try {

    await sequelize.query(script, {
      transaction
    });

    log.info('Create database');

    await sequelize.query(
      `INSERT INTO pergamo.organization(id, name, password)
      VALUES (:id, :name, crypt(:password, gen_salt('bf')))
      RETURNING *;`, {
      replacements: {
        id: 'pergamo',
        name: 'pergamo',
        password: Config.password_master
      },
      transaction,
      type: QueryTypes.INSERT
    });

    log.info('Create first organization');

    await transaction.commit();

  } catch(error:any) {

    await transaction.rollback();

    // Se propaga: si el esquema no queda creado no deben escribirse las claves,
    // porque su presencia marca la instalacion como ya inicializada y el
    // esquema no volveria a crearse en arranques posteriores.
    throw new Error(`Fail to create database: ${error.message}`);
  }
}

const createKeys = async (pathKey:string) => {

  await FilesUtils.mkdir(pathKey);
  await fs.promises.chmod(pathKey, 0o700);
  log.info('Created key directory:', Config.path_base);

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  await fs.promises.writeFile(`${pathKey}/private-key.pem`, privateKey, { mode: 0o600 });
  await fs.promises.writeFile(`${pathKey}/public-key.pem`, publicKey, { mode: 0o644 });
  log.info('Created pair keys');
}

const init = async () => {

  const pathKey = path.join(Config.path_base, '.key');

  const exists = await fs.promises.access(pathKey).then(() => true).catch(() => false)

  await FilesUtils.mkdir(Config.path_base);
  await FilesUtils.mkdir(Config.tmp_base);

  if(!exists) {

    log.info('Creating data directory...');
    log.info('Created data directory:', Config.path_base);
    log.info('Created data temp directory:', Config.tmp_base);

    await createSchema();
    await createKeys(pathKey);

  } else {

    log.info('App already initialized');
  }

  // Siempre: es la unica via por la que una instalacion existente recibe
  // cambios de esquema posteriores a su creacion.
  await runMigrations();
}

init()
  .then(async () => {
    await sequelize.close();
    process.exit(0);
  })
  .catch(async (error:any) => {
    log.error(`Initialization failed: ${error.message}`);
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
