import { StatusCodes } from 'http-status-codes';

import log from '@/shared/logger';
import { documentDeps as deps } from '@/container';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { formatIssues } from '@/shared/validation';
import { documentListQuerySchema } from '@/api/http/dto/list-query.dto';
import { toDocumentResponse, toScanInfoResponse, toVersionResponse } from '@/api/http/dto/document.dto';
import { contentDisposition } from '@/api/http/content-disposition';

import { uploadDocument } from '@/app/use-cases/document/commands/upload-document.handler';
import { modifyDocumentFile } from '@/app/use-cases/document/commands/modify-document-file.handler';
import { modifyDocumentMetadata } from '@/app/use-cases/document/commands/modify-document-metadata.handler';
import { removeDocument } from '@/app/use-cases/document/commands/remove-document.handler';
import { getDocument } from '@/app/use-cases/document/queries/get-document.handler';
import { getDocumentFile } from '@/app/use-cases/document/queries/get-document-file.handler';
import { listDocuments } from '@/app/use-cases/document/queries/list-documents.handler';
import { listDocumentVersions } from '@/app/use-cases/document/queries/list-document-versions.handler';

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

    const file = requireFile(req);
    const { organization } = req.user;

    log.debug(`${trace(req)} | Request file: ${JSON.stringify(file)}`);

    const document = await uploadDocument({ organization, file, trace: trace(req) }, deps);

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

    const id = requireId(req);
    const file = requireFile(req);

    log.debug(`${trace(req)} | Request file: ${JSON.stringify(file)}`);

    const document = await modifyDocumentFile(
      { organization: req.user.organization, id, file, trace: trace(req) }, deps);

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
