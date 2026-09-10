import { StatusCodes } from 'http-status-codes';

import log from '@/shared/logger';
import { documentDeps as deps } from '@/container';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { formatIssues } from '@/shared/validation';
import {
  documentChunkQuerySchema, documentListQuerySchema, documentReplaceQuerySchema, documentUploadQuerySchema
} from '@/api/http/dto/list-query.dto';
import {
  toChunkResponse, toDocumentResponse, toIndexInfoResponse, toScanInfoResponse, toVersionResponse
} from '@/api/http/dto/document.dto';
import { documentVersionParamSchema } from '@/api/http/dto/document-param.dto';
import { contentDisposition } from '@/api/http/content-disposition';

import { uploadDocument } from '@/app/use-cases/document/commands/upload-document.handler';
import { modifyDocumentFile } from '@/app/use-cases/document/commands/modify-document-file.handler';
import { modifyDocumentMetadata } from '@/app/use-cases/document/commands/modify-document-metadata.handler';
import { removeDocument } from '@/app/use-cases/document/commands/remove-document.handler';
import { rescanDocument } from '@/app/use-cases/document/commands/rescan-document.handler';
import { releaseDocument } from '@/app/use-cases/document/commands/release-document.handler';
import { reindexDocument } from '@/app/use-cases/document/commands/reindex-document.handler';
import { startRescanSweep } from '@/app/use-cases/document/commands/start-rescan-sweep.handler';
import { getDocument } from '@/app/use-cases/document/queries/get-document.handler';
import { getDocumentFile } from '@/app/use-cases/document/queries/get-document-file.handler';
import { listDocuments } from '@/app/use-cases/document/queries/list-documents.handler';
import { listDocumentVersions } from '@/app/use-cases/document/queries/list-document-versions.handler';
import { getDocumentVersionFile } from '@/app/use-cases/document/queries/get-document-version-file.handler';
import { getRescanSweep } from '@/app/use-cases/document/queries/get-rescan-sweep.handler';
import { listDocumentChunks } from '@/app/use-cases/document/queries/list-document-chunks.handler';

const trace = (req:any) => `${req.method} ${req.originalUrl} - ${req.id}`;

const requireId = (req:any) => {
  if(!req?.params?.id) throw new ValidationError('FIELD_REQUIRED', 'Value "id" is required');
  return req.params.id as string;
}

const requireFile = (req:any) => {
  if(!req.file) throw new ValidationError('FIELD_REQUIRED', 'Value "document" is required');
  return req.file;
}

const upload = async (req, res, next) => {

  try {

    const query = documentUploadQuerySchema.safeParse(req.query);

    if(!query.success) throw new ValidationError('INVALID_QUERY', formatIssues(query.error));

    const file = requireFile(req);
    const { organization } = req.user;

    log.debug(`${trace(req)} | Request file: ${JSON.stringify(file)}`);

    const document = await uploadDocument(
      { organization, file, index: query.data.index, trace: trace(req) }, deps);

    log.debug(`${trace(req)} | Document: ${JSON.stringify(document)}`);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(document.metadata));

  } catch (error) {
    // El temporal de multer no lo recoge nadie mas cuando el deposito falla.
    await deps.storage.removeTemp(req?.file?.path).catch(() => {});
    next(error);
  }
};

const getMetadata = async (req, res, next) => {

  try {

    const document = await getDocument(req.user.organization, requireId(req), deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(document.metadata);

  } catch (error) {
    next(error);
  }
};

const getFile = async (req, res, next) => {

  try {

    const { document, filePath } = await getDocumentFile(req.user.organization, requireId(req), deps);

    res.setHeader('Content-Disposition',
      contentDisposition(`${document.metadata.name}.${document.metadata.extension}`));
    res.status(StatusCodes.OK)
      .set('Content-Type', document.metadata.mimetype)
      .sendFile(filePath);

  } catch (error) {
    next(error);
  }
};

const modifyFile = async (req, res, next) => {

  try {

    const query = documentReplaceQuerySchema.safeParse(req.query);

    if(!query.success) throw new ValidationError('INVALID_QUERY', formatIssues(query.error));

    const id = requireId(req);
    const file = requireFile(req);

    log.debug(`${trace(req)} | Request file: ${JSON.stringify(file)}`);

    const document = await modifyDocumentFile(
      { organization: req.user.organization, id, file, index: query.data.index, trace: trace(req) }, deps);

    log.debug(`${trace(req)} | Document: ${JSON.stringify(document)}`);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(document.metadata);

  } catch (error) {
    await deps.storage.removeTemp(req?.file?.path).catch(() => {});
    next(error);
  }
};

const modifyMetadata = async (req, res, next) => {

  try {

    const document = await modifyDocumentMetadata(
      { organization: req.user.organization, id: requireId(req), changes: req.body }, deps);

    log.debug(`${trace(req)} | Document: ${JSON.stringify(document.metadata)}`);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(document.metadata);

  } catch (error) {
    next(error);
  }
};

const versionsFile = async (req, res, next) => {

  try {

    const versions = await listDocumentVersions(req.user.organization, requireId(req), deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(versions.map(toVersionResponse));

  } catch (error) {
    next(error);
  }
};

// Lo que sale es el ZIP que guarda el archivador, no el fichero original:
// descomprimirlo aqui pediria una dependencia nueva para ahorrar un doble clic.
const getVersionFile = async (req, res, next) => {

  try {

    const params = documentVersionParamSchema.safeParse(req.params);

    if(!params.success) throw new ValidationError('INVALID_PARAM', formatIssues(params.error));

    const id = requireId(req);
    const { version } = params.data;

    const { document, filePath } = await getDocumentVersionFile(
      req.user.organization, id, version, deps);

    res.setHeader('Content-Disposition',
      contentDisposition(`${document.metadata.name}.v${version}.zip`));
    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/zip')
      .sendFile(filePath);

  } catch (error) {
    next(error);
  }
};

const remove = async (req, res, next) => {

  try {

    const id = requireId(req);

    await removeDocument({ organization: req.user.organization, id, trace: trace(req) }, deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send({ message: `Document with id ${id} deleted`});

  } catch (error) {
    next(error);
  }
};

const list = async (req, res, next) => {

  try {

    const query = documentListQuerySchema.safeParse(req.query);

    if(!query.success) throw new ValidationError('INVALID_QUERY', formatIssues(query.error));

    const { limit, offset, name, tag, scan_status, from, to, sort, order } = query.data;

    const page = await listDocuments({
      organization: req.user.organization,
      limit, offset, name, tag, from, to, order,
      scanStatus: scan_status,
      sort: sort === 'creation_date' ? 'creationDate' : 'modificationDate'
    }, deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        total: page.total,
        limit,
        offset,
        documents: page.documents.map(toDocumentResponse)
      }));

  } catch (error) {
    next(error);
  }
};

// En su propio endpoint: el cuerpo de getMetadata es el JSONB tal cual, y
// anadirle claves cambiaria un contrato que ya consumen otros clientes.
const scanInfo = async (req, res, next) => {

  try {

    const document = await getDocument(req.user.organization, requireId(req), deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(toScanInfoResponse(document)));

  } catch (error) {
    next(error);
  }
};

// Gemelo en POST del scanInfo de arriba: vuelve a pasar el escaner por el
// fichero guardado y devuelve el veredicto nuevo, con la misma forma.
const rescan = async (req, res, next) => {

  try {

    const document = await rescanDocument(
      { organization: req.user.organization, id: requireId(req), trace: trace(req) }, deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(toScanInfoResponse(document)));

  } catch (error) {
    next(error);
  }
};

// Levantar una retencion sobre un fichero que si esta: una firma que resulto ser
// un falso positivo, o un contenido activo ya revisado. Conserva la firma.
const release = async (req, res, next) => {

  try {

    const document = await releaseDocument(
      { organization: req.user.organization, id: requireId(req), trace: trace(req) }, deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(toScanInfoResponse(document)));

  } catch (error) {
    next(error);
  }
};

// Barrido de todo lo que quedo sin veredicto. No cabe en una peticion, asi que
// va a la cola y lo que se devuelve es en que anda.
const startSweep = async (req, res, next) => {

  try {

    const state = await startRescanSweep(req.user.organization, deps);

    res.status(StatusCodes.ACCEPTED)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(state));

  } catch (error) {
    next(error);
  }
};

const sweepState = async (req, res, next) => {

  try {

    const state = await getRescanSweep(req.user.organization, deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(state));

  } catch (error) {
    next(error);
  }
};

// Gemelo de scanInfo, y por el mismo motivo: el cuerpo de getMetadata es el
// JSONB tal cual, y anadirle claves cambiaria un contrato que ya se consume.
const indexInfo = async (req, res, next) => {

  try {

    const document = await getDocument(req.user.organization, requireId(req), deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(toIndexInfoResponse(document)));

  } catch (error) {
    next(error);
  }
};

// Gemelo en POST del indexInfo de arriba: vuelve a encolar el documento y
// devuelve el estado del indice, con la misma forma.
const reindex = async (req, res, next) => {

  try {

    const document = await reindexDocument(
      { organization: req.user.organization, id: requireId(req), trace: trace(req) }, deps);

    res.status(StatusCodes.ACCEPTED)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(toIndexInfoResponse(document)));

  } catch (error) {
    next(error);
  }
};

// Para mirar dentro del indice: que texto se extrajo y por donde se corto. Sale
// paginado porque un documento largo son miles de trozos de mil y pico
// caracteres cada uno.
const chunks = async (req, res, next) => {

  try {

    const query = documentChunkQuerySchema.safeParse(req.query);

    if(!query.success) throw new ValidationError('INVALID_QUERY', formatIssues(query.error));

    const { limit, offset } = query.data;

    const page = await listDocumentChunks(
      { organization: req.user.organization, document: requireId(req), limit, offset }, deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        total: page.total,
        limit,
        offset,
        chunks: page.chunks.map(toChunkResponse)
      }));

  } catch (error) {
    next(error);
  }
};

export {
  upload,
  indexInfo,
  reindex,
  chunks,
  list,
  scanInfo,
  rescan,
  release,
  startSweep,
  sweepState,
  getMetadata,
  modifyMetadata,
  getFile,
  modifyFile,
  versionsFile,
  getVersionFile,
  remove
}
