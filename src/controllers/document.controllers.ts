
import fs from 'fs';
import mime from 'mime-types';
import path from 'path';
import archiver from 'archiver';

import log from '../utils/log';
import Config from "../config";
import antivirus, { ScannerUnavailableError } from "../utils/antivirus";
import FilesUtils from "../utils/files";
import { verifyMimetype } from "../utils/filetype";
import { metadataValueSchema } from "../utils/validation";
import { sha256File } from "../utils/hash";
import sequelize, { QueryTypes } from "../utils/db";
import Document from "../models/document.models";
import { ValidationError, StatusCodes } from "../middleware/error.middleware";

/**
 * Ejecuta el analisis antivirico de una subida y traduce el resultado a las
 * columnas de estado del documento.
 *
 * Politica ante escaner NO DISPONIBLE (habilitado pero incapaz de responder):
 * **aceptar y marcar como pendiente**. El documento se almacena, pero su
 * descarga queda bloqueada hasta que un reescaneo lo apruebe. Prioriza la
 * disponibilidad de la subida sin llegar a servir nunca contenido que se
 * pretendia verificar y no se verifico.
 *
 * Con el antivirus DESACTIVADO por configuracion el caso es otro: no hay
 * intencion de verificar, asi que el documento queda 'clean' con scan_engine
 * nulo. Marcarlo 'pending' dejaria el despliegue sin descargas y sin salida,
 * porque el reescaneo tampoco puede correr sin escaner. El scan_engine nulo lo
 * mantiene en la cola de reescaneo para cuando se active el antivirus, y el
 * arranque ya avisa por log de que nada se esta analizando.
 */
const scanUpload = async (filePath:string, req:any) => {

  if(!Config.enable_antivirus) {
    return { scan_status: 'clean', scan_signature: null, scan_engine: null, scan_date: null };
  }

  try {

    const result = await antivirus.scan(filePath, req);

    return {
      scan_status: 'clean',
      scan_signature: null,
      scan_engine: result.engine,
      scan_date: new Date()
    };

  } catch(error:any) {

    if(!(error instanceof ScannerUnavailableError)) throw error;

    log.error(`${req.method} ${req.originalUrl} - ${req.id} | Antivirus unavailable, document stored as pending: ${error.message}`);

    return { scan_status: 'pending', scan_signature: null, scan_engine: null, scan_date: null };
  }
}

/**
 * Comprueba que el contenido real corresponde al mimetype declarado.
 *
 * Es **fail-closed**: si no hay firma conocida para ese mimetype no se puede
 * afirmar nada sobre el contenido, y aceptarlo con un simple aviso —como se
 * hacia antes— convertia VALID_MIMETYPE en una via para almacenar cualquier
 * cosa. Ampliar VALID_MIMETYPE exige ahora anadir la firma en utils/filetype.ts.
 */
const verifyContent = async (filePath:string, mimetype:string, req:any) => {

  const fileType = await verifyMimetype(filePath, mimetype);

  if(!fileType.verifiable) throw new ValidationError(StatusCodes.BAD_REQUEST,
    'INVALID_MIMETYPE', `No content signature available for mimetype "${mimetype}"`, req);

  if(!fileType.matches) throw new ValidationError(StatusCodes.BAD_REQUEST,
    'INVALID_MIMETYPE', `File content does not match the declared mimetype "${mimetype}"`, req);
}

const upload = async (req, res, next) => {
  
  try {

    if(!req.file) throw new ValidationError(StatusCodes.BAD_REQUEST, 
        'FIELD_REQUIRED', 'Value "document" is required', req);

    const { file } = req;

    const { organization } = req.user;

    log.debug(`${req.method} ${req.originalUrl} - ${req.id} | Request file: ${JSON.stringify(file)}`);

    // La comprobacion de la allowlist va antes del escaneo: no cuesta E/S y
    // evita transmitir a clamd ficheros que se van a rechazar igualmente.
    if(!Config.valid_mimetype.includes(file.mimetype)) throw new ValidationError(StatusCodes.BAD_REQUEST,
      'INVALID_MIMETYPE', `Invalid mimetype "${file.mimetype}"`, req);

    const scan = await scanUpload(file.path, req);

    // La verificacion de contenido va DESPUES del escaneo, para que un fichero
    // infectado se rechace como infectado y no por un desajuste de firma: de lo
    // contrario el resultado seria correcto por la razon equivocada.
    await verifyContent(file.path, file.mimetype, req);

    const metadata = {
      name: path.parse(file.originalname).name,
      original_name: file.originalname,
      mimetype: file.mimetype,
      extension: mime.extension(file.mimetype),
      hash: await sha256File(file.path),
      tags: []
    }

    // La insercion toca dos almacenes (base de datos y disco). Se confirma en
    // base de datos solo despues de que el fichero este en su sitio: antes, un
    // fallo del `mv` dejaba una fila describiendo un contenido inexistente.
    const transaction = await sequelize.transaction();
    let document:Document;

    try {

      const result = await sequelize.query(
        `INSERT INTO pergamo.document(metadata, organization, scan_status, scan_signature, scan_engine, scan_date)
        VALUES (:metadata::jsonb, :organization, :scan_status, :scan_signature, :scan_engine, :scan_date) RETURNING *;`, {
        replacements: {
          metadata: JSON.stringify(metadata),
          organization,
          ...scan
        },
        type: QueryTypes.INSERT,
        transaction
      });

      document = result[0][0];

      const filePath = path.join(Config.path_base, organization, document.path);

      await FilesUtils.mvAsync(req.file.path, filePath);

      await transaction.commit();

    } catch(errorInsert) {
      await transaction.rollback();
      throw errorInsert;
    }

    log.debug(`${req.method} ${req.originalUrl} - ${req.id} | Document: ${JSON.stringify(document)}`);

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

  const result = await sequelize.query(
    `SELECT path, metadata, scan_status, scan_signature
    FROM pergamo.document WHERE organization = :organization AND id = :id;`, {
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

    // El bloqueo se aplica solo aqui, no en getInfo.
    //
    // getInfo lo comparten getMetadata, modifyFile y versionsFile, y los
    // metadatos de un documento en cuarentena SI deben poder consultarse: es
    // como el cliente descubre por que esta bloqueado. Lo unico que se corta es
    // la entrega del contenido no verificado.
    if(info.scan_status !== 'clean') throw new ValidationError(StatusCodes.LOCKED,
      'SCAN_NOT_CLEAN',
      info.scan_status === 'infected' ?
        `Document is quarantined: detected as ${info.scan_signature}` :
        `Document is not available for download while its scan status is "${info.scan_status}"`,
      req);

    const filePath = path.join(Config.path_base, organization, info.path);

    res.setHeader('Content-Disposition',
      FilesUtils.contentDisposition(`${info.metadata.name}.${info.metadata.extension}`));
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

    // La comprobacion de propiedad va PRIMERO. Cuando el escaneo iba delante,
    // un tenant podia forzar analisis de ficheros de 50 MB contra identificadores
    // ajenos y recibir el 404 despues, con el coste ya consumido.
    const info = await getInfo(req);

    if(file.mimetype !== info.metadata.mimetype)
      throw new ValidationError(StatusCodes.BAD_REQUEST, 'INVALID_MIMETYPE', 'Invalid mimetype', req);

    const scan = await scanUpload(file.path, req);

    await verifyContent(file.path, file.mimetype, req);

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

      // El contenido cambia, luego el veredicto anterior deja de aplicar: el
      // estado de analisis se reescribe con el del fichero nuevo.
      const result = await sequelize.query(
        `UPDATE pergamo.document
        SET metadata = :metadata, modification_date = CURRENT_TIMESTAMP,
            scan_status = :scan_status, scan_signature = :scan_signature,
            scan_engine = :scan_engine, scan_date = :scan_date
        WHERE organization = :organization AND id = :id RETURNING *;`, {
        replacements: { metadata: JSON.stringify(metadata), organization, id, ...scan },
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