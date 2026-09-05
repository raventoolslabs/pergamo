
import fs from 'fs';
import mime from 'mime-types';
import path from 'path';
import archiver from 'archiver';

import log from '../utils/log';
import Config from "../config";
import antivirus from "../utils/antivirus";
import FilesUtils from "../utils/files";
import { verifyMimetype } from "../utils/filetype";
import { metadataValueSchema } from "../utils/validation";
import { sha256File } from "../utils/hash";
import sequelize, { QueryTypes } from "../utils/db";
import Document from "../models/document.models";
import { ValidationError, StatusCodes } from "../middleware/error.middleware";

const upload = async (req, res, next) => {
  
  try {

    if(!req.file) throw new ValidationError(StatusCodes.BAD_REQUEST, 
        'FIELD_REQUIRED', 'Value "document" is required', req);

    const { file } = req;

    const { organization } = req.user;

    log.debug(`${req.method} ${req.originalUrl} - ${req.id} | Request file: ${JSON.stringify(file)}`);

    if(Config.enable_antivirus) {
      await antivirus.scan(file.path, req);
    }

    if(!Config.valid_mimetype.includes(file.mimetype)) throw new ValidationError(StatusCodes.BAD_REQUEST,
      'INVALID_MIMETYPE', `Invalid mimetype "${file.mimetype}"`, req);

    const fileType = await verifyMimetype(file.path, file.mimetype);

    if(fileType.verifiable && !fileType.matches) throw new ValidationError(StatusCodes.BAD_REQUEST,
      'INVALID_MIMETYPE', `File content does not match the declared mimetype "${file.mimetype}"`, req);

    if(!fileType.verifiable) log.warn(`${req.method} ${req.originalUrl} - ${req.id} | No content signature available for mimetype "${file.mimetype}"`);

    const metadata = {
      name: path.parse(file.originalname).name,
      original_name: file.originalname,
      mimetype: file.mimetype,
      extension: mime.extension(file.mimetype),
      hash: await sha256File(file.path),
      tags: []
    }

    const result = await sequelize.query("INSERT INTO pergamo.document(metadata, organization) VALUES (:metadata::jsonb, :organization) RETURNING *;", {
      replacements: { metadata: JSON.stringify(metadata), organization },
      type: QueryTypes.INSERT
    });

    const document:Document = result[0][0];

    log.debug(`${req.method} ${req.originalUrl} - ${req.id} | Document: ${JSON.stringify(document)}`);

    const filePath = path.join(Config.path_base, organization, document.path);

    await FilesUtils.mvAsync(req.file.path, filePath);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(document.metadata));
  } catch (error) {
    if(req?.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(error);
  }
};

const getInfo = async (req:any) => {

  if(!req?.params?.id) throw new ValidationError(StatusCodes.BAD_REQUEST, 
    'FIELD_REQUIRED', 'Value "id" is required', req);

  const id = req.params.id;

  const { organization } = req.user;

  const result = await sequelize.query("SELECT path, metadata FROM pergamo.document WHERE organization = :organization AND id = :id;", {
    replacements: { id, organization },
    type: QueryTypes.SELECT
  });

  if(result.length !== 1) throw new ValidationError(StatusCodes.NOT_FOUND, 
    'NO_CONTENT', `Document with id ${id} not exists`, req);

  const info:any = result[0];

  return info;
}

const getMetadata = async (req, res, next) => {
  
  try {

    const info = await getInfo(req);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(info.metadata);
  } catch (error) {
    next(error);
  }
};

const getFile = async (req, res, next) => {

  try {

    const info = await getInfo(req);

    const { organization } = req.user;

    const filePath = path.join(Config.path_base, organization, info.path);
    
    res.setHeader('Content-Disposition', `attachment; filename=${info.metadata.name}.${info.metadata.extension}`);
    res.status(StatusCodes.OK)
      .set('Content-Type', info.metadata.mimetype)
      .sendFile(filePath);

  } catch (error) {
    next(error);
  }
};

const REGEX_VERSION = /\.\d+$/;

const modifyFile = async (req, res, next) => {

  try {
    
    if(!req?.params?.id) throw new ValidationError(StatusCodes.BAD_REQUEST, 
      'FIELD_REQUIRED', 'Value "id" is required', req);
    if(!req.file) throw new ValidationError(StatusCodes.BAD_REQUEST, 
      'FIELD_REQUIRED', 'Value "document" is required', req);

    const id = req.params.id;

    const { organization } = req.user;

    const { file } = req;

    log.debug(`${req.method} ${req.originalUrl} - ${req.id} | Request file: ${JSON.stringify(file)}`);

    if(Config.enable_antivirus) {
      await antivirus.scan(file.path, req);
    }
    const info = await getInfo(req);

    if(file.mimetype !== info.metadata.mimetype)
      throw new ValidationError(StatusCodes.BAD_REQUEST, 'INVALID_MIMETYPE', 'Invalid mimetype', req);

    const fileType = await verifyMimetype(file.path, file.mimetype);

    if(fileType.verifiable && !fileType.matches) throw new ValidationError(StatusCodes.BAD_REQUEST,
      'INVALID_MIMETYPE', `File content does not match the declared mimetype "${file.mimetype}"`, req);

    const metadata = info.metadata;
    metadata.name = path.parse(file.originalname).name;
    metadata.original_name = file.originalname;
    metadata.mimetype = file.mimetype;
    metadata.extension = mime.extension(file.mimetype);
    metadata.hash = await sha256File(file.path);

    // La actualizacion toca dos almacenes (base de datos y disco). Se confirma
    // en base de datos solo despues de que el fichero este en su sitio, de modo
    // que un fallo al escribir en disco no deje metadatos describiendo un
    // contenido que no existe.
    const transaction = await sequelize.transaction();
    let document:Document;

    try {

      const result = await sequelize.query(
        `UPDATE pergamo.document
        SET metadata = :metadata ,modification_date = CURRENT_TIMESTAMP
        WHERE organization = :organization AND id = :id RETURNING *;`, {
        replacements: { metadata: JSON.stringify(metadata), organization, id },
        type: QueryTypes.INSERT,
        transaction
      });

      document = result[0][0];

      const filePath = path.join(Config.path_base, organization, document.path);

      if(Config.max_version_file > 1) await createVersion(id, filePath);

      await FilesUtils.mvAsync(req.file.path, filePath);

      await transaction.commit();

    } catch(errorUpdate) {
      await transaction.rollback();
      throw errorUpdate;
    }

    log.debug(`${req.method} ${req.originalUrl} - ${req.id} | Document: ${JSON.stringify(document)}`);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(document.metadata);

  } catch (error) {
    if(req?.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(error);
  }
};

const createVersion = async (id:string, filePath:string) => {

  const directory = path.dirname(filePath);

  const versions = (await fs.promises.readdir(directory))
    .filter((file) => file.match(REGEX_VERSION))
    .map((file) => ({
      version: Number.parseInt(file.match(REGEX_VERSION)[0].replace('.', '')),
      file
    }))
    .sort((a, b) => b.version - a.version);

  for(const version of versions) {
    if((version.version + 1) <= Config.max_version_file) {
      const oldPath = path.join(directory, version.file);
      const newPath = filePath + `.${version.version + 1}`;
      await FilesUtils.mvAsync(oldPath, newPath);
    }
  }

  const readStream = fs.createReadStream(filePath);
  const writeStream = fs.createWriteStream(filePath + '.1');
  const archive = archiver('zip', {
    zlib: { level: 9 }
  });

  const archivePromise = new Promise<void>((resolve, reject) => {
    writeStream.on('close', () => {
      console.log(`Archivo comprimido creado con ${archive.pointer()} bytes totales`);
      resolve();
    });

    archive.on('error', (err) => {
      console.error('Error al comprimir:', err);
      reject(err);
    });

    archive.pipe(writeStream);
  });

  archive.append(readStream, { name: id });

  archive.finalize();

  await archivePromise;
}

const modifyMetadata = async (req, res, next) => {

  try {
    
    if(!req?.params?.id) throw new ValidationError(StatusCodes.BAD_REQUEST, 
      'FIELD_REQUIRED', 'Value "id" is required', req);

    const id = req.params.id;

    const { organization } = req.user;

    const { metadata } = (await getInfo(req));

    const auxMetadata = req.body;

    Object.keys(auxMetadata).forEach((key) => {

      if(!Config.valid_metadata_modify.includes(key)) return;

      const value = metadataValueSchema.safeParse(auxMetadata[key]);

      if(!value.success) throw new ValidationError(StatusCodes.BAD_REQUEST,
        'INVALID_METADATA', `Invalid value for metadata field "${key}"`, req);

      metadata[key] = auxMetadata[key];
    });

    const result = await sequelize.query(
      `UPDATE pergamo.document 
      SET metadata = :metadata ,modification_date = CURRENT_TIMESTAMP 
      WHERE organization = :organization AND id = :id RETURNING *;`, {
      replacements: { metadata: JSON.stringify(metadata), organization, id },
      type: QueryTypes.INSERT
    });

    const document:Document = result[0][0];

    log.debug(`${req.method} ${req.originalUrl} - ${req.id} | Document: ${JSON.stringify(document.metadata)}`);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(document.metadata);

  } catch (error) {
    next(error);
  }
};

const versionsFile = async (req, res, next) => {

  try {

    const document = (await getInfo(req));

    const { organization } = req.user;

    const directory = path.dirname(path.join(Config.path_base, organization, document.path));

    const files = (await fs.promises.readdir(directory))
      .filter((file) => file.match(REGEX_VERSION));

    let versions:any = []
    for(const file of files) {
      versions.push({
        version: Number.parseInt(file.match(REGEX_VERSION)[0].replace('.', '')),
        created_at: (await fs.promises.stat(path.join(directory, file))).birthtime
      })
    }
      
    versions = versions.sort((a, b) => a.version - b.version);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(versions);

  } catch (error) {
    next(error);
  }
};

const remove = async (req, res, next) => {

  try {

    if(!req?.params?.id) throw new ValidationError(StatusCodes.BAD_REQUEST, 
      'FIELD_REQUIRED', 'Value "id" is required', req);

    const id = req.params.id;

    const { organization } = req.user;

    const result = await sequelize.query("DELETE FROM pergamo.document WHERE organization = :organization AND id = :id RETURNING path;", {
      replacements: { organization, id },
      type: QueryTypes.SELECT
    });

    if(result.length !== 1) throw new ValidationError(StatusCodes.NOT_FOUND, 
      'NO_CONTENT', `Document with id ${id} not exists in organization ${organization}`, req);

    const info:any = result[0];

    if(Config.remove_file_disk) {
      try {
        await FilesUtils.rmdir(
          path.join(Config.path_base, organization),
          path.dirname(path.join(Config.path_base, organization, info.path)))
      } catch(errorFile:any) {
        log.warn(`${req.method} ${req.originalUrl} - ${req.id} | Document ${id} removed from database, but file removal failed: ${errorFile.message}`);
      }
    }
    
    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send({ message: `Document with id ${id} deleted`});
  } catch (error) {
    next(error);
  }
};

export {
  upload,
  getMetadata,
  modifyMetadata,
  getFile,
  modifyFile,
  versionsFile,
  remove
}