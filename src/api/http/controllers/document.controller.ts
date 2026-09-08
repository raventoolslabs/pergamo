
import fs from 'fs';
import mime from 'mime-types';
import path from 'path';
import archiver from 'archiver';

import log from '@/infrastructure/logging/logger';
import Config from "@/shared/config";
import antivirus, { ScannerUnavailableError } from "@/infrastructure/antivirus/clamav.service";
import { detectActiveContent, activeContentSignature } from "@/infrastructure/antivirus/active-content";
import FilesUtils from "@/infrastructure/files/storage";
import { verifyMimetype } from "@/infrastructure/files/filetype";
import { metadataValueSchema, documentListQuerySchema, escapeLike, formatIssues } from "@/shared/validation";
import { sha256File } from "@/infrastructure/security/hash";
import sequelize, { QueryTypes } from "@/infrastructure/db/client";
import Document from "@/domain/entities/document";
import { ValidationError, StatusCodes } from "@/api/http/middleware/error.middleware";

/**
 * Traduce el analisis de una subida a las columnas de estado.
 *
 * Con el escaner habilitado pero sin responder se acepta y se marca 'pending':
 * el documento entra, se entrega y queda en la cola del proximo reescaneo.
 * Retenerlo convertia una caida de clamd en un archivo que deja de servir.
 *
 * Con el antivirus desactivado no hay intencion de verificar, asi que queda
 * 'clean' con scan_engine nulo: 'pending' dejaria el despliegue sin descargas y
 * sin salida, porque el reescaneo tampoco puede correr sin escaner.
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
 * Veredicto completo del deposito: antivirus y contenido activo.
 *
 * Dos capas para dos preguntas: el antivirus busca codigo malicioso conocido y
 * el detector busca lo que el PDF hace al visor, que no lleva firma porque no
 * es malware. Sobre test/assets/payloads/, ClamAV reconoce 1 de 11 y el filtro
 * 10 de 11.
 *
 * Un infectado corta la peticion con un 400; el contenido activo no rechaza la
 * subida, se guarda y queda en cuarentena. Para un fondo documental esa es la
 * correcta: el deposito no se pierde.
 *
 * 'malicious' se impone a 'pending' y a 'clean': no lo resuelve el siguiente
 * reescaneo, solo `npm run scan:release -- <id>`.
 */
const inspectUpload = async (filePath:string, mimetype:string, req:any) => {

  const scan = await scanUpload(filePath, req);

  const active = await detectActiveContent(filePath, mimetype);

  if(!active.active) return scan;

  log.warn(`${req.method} ${req.originalUrl} - ${req.id} | Active content quarantined: ${active.markers.join(', ')}`);

  return {
    ...scan,
    scan_status: 'malicious',
    scan_signature: activeContentSignature(active.markers)
  };
}

/**
 * Fail-closed: sin firma conocida para ese mimetype no se puede afirmar nada
 * sobre el contenido, asi que ampliar VALID_MIMETYPE exige anadir la firma en
 * utils/filetype.ts.
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

    const scan = await inspectUpload(file.path, file.mimetype, req);

    // Despues del escaneo, para que un infectado se rechace como infectado y no
    // por un desajuste de firma.
    await verifyContent(file.path, file.mimetype, req);

    const metadata = {
      name: path.parse(file.originalname).name,
      original_name: file.originalname,
      mimetype: file.mimetype,
      extension: mime.extension(file.mimetype),
      hash: await sha256File(file.path),
      // Dato del deposito, como el hash: se fija aqui y no se recalcula. Los
      // documentos anteriores a esta clave no lo tienen.
      size: file.size,
      tags: []
    }

    // Se confirma en base de datos solo despues de que el fichero este en su
    // sitio: un fallo del `mv` dejaria una fila sin contenido.
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
    `SELECT path, metadata, scan_status, scan_signature, scan_engine, scan_date
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

/**
 * Estados que retienen el documento; todo lo demas se entrega.
 *
 * La regla no es «solo se entrega lo aprobado» sino «no se entrega lo que
 * alguien tiene que mirar»: los tres exigen una intervencion y ninguno se
 * arregla esperando.
 *
 * 'pending' no esta aqui a proposito: es una verificacion que falta, no un
 * hallazgo, y la resuelve el siguiente barrido.
 */
const RETENIDOS = ['infected', 'malicious', 'error'];

// El motivo viaja en el 423 porque cada uno se resuelve de otra manera:
// 'infected' y 'malicious' exigen revision, 'error' exige mirar el almacen.
const quarantineReason = (info:any) => {

  if(info.scan_status === 'infected')
    return `Document is quarantined: detected as ${info.scan_signature}`;

  if(info.scan_status === 'malicious')
    return `Document is quarantined: it carries active content (${info.scan_signature}). ` +
      'A rescan does not clear this state: it requires a manual review.';

  return 'Document file is missing from storage: it cannot be delivered until the deployment is reviewed';
}

const getFile = async (req, res, next) => {

  try {

    const info = await getInfo(req);

    const { organization } = req.user;

    // Solo aqui, no en getInfo: los metadatos de un documento retenido si deben
    // poder consultarse, porque es como el cliente descubre por que lo esta.
    if(RETENIDOS.includes(info.scan_status)) throw new ValidationError(StatusCodes.LOCKED,
      'SCAN_NOT_CLEAN',
      quarantineReason(info),
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

    // La propiedad va primero: con el escaneo delante, un tenant podia forzar
    // analisis de 50 MB contra identificadores ajenos y recibir el 404 despues.
    const info = await getInfo(req);

    if(file.mimetype !== info.metadata.mimetype)
      throw new ValidationError(StatusCodes.BAD_REQUEST, 'INVALID_MIMETYPE', 'Invalid mimetype', req);

    const scan = await inspectUpload(file.path, file.mimetype, req);

    await verifyContent(file.path, file.mimetype, req);

    const metadata = info.metadata;
    metadata.name = path.parse(file.originalname).name;
    metadata.original_name = file.originalname;
    metadata.mimetype = file.mimetype;
    metadata.extension = mime.extension(file.mimetype);
    metadata.hash = await sha256File(file.path);

    // Se confirma en base de datos solo despues de que el fichero este en su
    // sitio, para no dejar metadatos describiendo un contenido que no existe.
    const transaction = await sequelize.transaction();
    let document:Document;

    try {

      // El contenido cambia, luego el veredicto anterior deja de aplicar.
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


const list = async (req, res, next) => {

  try {

    const { organization } = req.user;

    // El token master no lleva organizacion: sin este corte la consulta filtra
    // por undefined y el master creeria que no hay documentos.
    if(!organization) throw new ValidationError(StatusCodes.BAD_REQUEST,
      'ORGANIZATION_REQUIRED', 'A master token has no organization: log in as an organization to list documents', req);

    const query = documentListQuerySchema.safeParse(req.query);

    if(!query.success) throw new ValidationError(StatusCodes.BAD_REQUEST,
      'INVALID_QUERY', formatIssues(query.error), req);

    const { limit, offset, name, tag, scan_status, from, to, sort, order } = query.data;

    const replacements:any = { organization, limit, offset };
    const conditions:string[] = [];

    if(name) {
      conditions.push(`clean_str(metadata->>'name') ILIKE clean_str(:name)`);
      replacements.name = `%${escapeLike(name)}%`;
    }

    if(tag) {
      // Contencion jsonb sobre el array de tags: es la forma que aprovecha el
      // indice GIN idx_document_metadata_tags.
      conditions.push(`metadata->'tags' @> :tag::jsonb`);
      replacements.tag = JSON.stringify([tag]);
    }

    if(scan_status) {
      // IN y no '=': el filtro admite varios estados a la vez. Sequelize expande
      // el array del replacement, asi que los valores siguen enlazados.
      conditions.push(`scan_status IN (:scan_status)`);
      replacements.scan_status = scan_status;
    }

    // Franja inclusiva por los dos lados: quien pide «hasta las 12:00» espera
    // que lo depositado a las 12:00 en punto entre.
    //
    // La conversion es explicita y no se deja al driver: creation_date guarda
    // UTC, pero un Date enlazado tal cual se castea a la hora local de la
    // maquina y desplaza la franja entera en silencio.
    if(from) {
      conditions.push(`creation_date >= CAST(:from AS timestamptz) AT TIME ZONE 'UTC'`);
      replacements.from = from.toISOString();
    }

    if(to) {
      conditions.push(`creation_date <= CAST(:to AS timestamptz) AT TIME ZONE 'UTC'`);
      replacements.to = to.toISOString();
    }

    const where = conditions.length ? ` AND ${conditions.join(' AND ')}` : '';

    // COUNT(*) OVER() da el total sin paginar en la misma pasada: una segunda
    // consulta podria ademas ver un corpus distinto.
    //
    // sort y order se interpolan porque un identificador de columna no admite
    // parametro enlazado; solo valen lo que declara el enum del schema.
    //
    // scan_engine viaja aunque nadie lo muestre: es lo unico que distingue un
    // 'clean' analizado de uno que nunca paso por un escaner.
    const result:any = await sequelize.query(
      `SELECT id, creation_date, modification_date, scan_status, scan_signature, scan_engine, metadata,
        COUNT(*) OVER() AS total
      FROM pergamo.document
      WHERE organization = :organization${where}
      ORDER BY ${sort} ${order.toUpperCase()}
      LIMIT :limit OFFSET :offset;`, {
      replacements,
      type: QueryTypes.SELECT
    });

    // 'path' es la ruta en disco: no sale nunca al cliente.
    const documents = result.map(({ total, ...document }:any) => document);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        total: result.length ? Number.parseInt(result[0].total) : 0,
        limit,
        offset,
        documents
      }));

  } catch (error) {
    next(error);
  }
};

// En su propio endpoint: el cuerpo de getMetadata es el JSONB tal cual, y
// anadirle claves cambiaria un contrato que ya consumen otros clientes.
const scanInfo = async (req, res, next) => {

  try {

    const info = await getInfo(req);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        scan_status: info.scan_status,
        scan_signature: info.scan_signature,
        scan_engine: info.scan_engine,
        scan_date: info.scan_date
      }));

  } catch (error) {
    next(error);
  }
};


export {
  upload,
  list,
  scanInfo,
  getMetadata,
  modifyMetadata,
  getFile,
  modifyFile,
  versionsFile,
  remove
}