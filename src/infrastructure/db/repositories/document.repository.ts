import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { Document, DocumentMetadata } from '@/domain/entities/document';
import { TransactionScope } from '@/app/ports/unit-of-work';
import {
  DocumentListFilter, DocumentPage, DocumentRepository, IndexResult, ScanRecord
} from '@/app/ports/repositories/document.repository';
import { DocumentRow, DocumentSummaryRow } from '@/infrastructure/db/schema/document.row';
import { toDocument, toDocumentSummary } from '@/infrastructure/db/mappers/document.mapper';
import { escapeLike } from '@/shared/validation';

// El orden llega como concepto del dominio; la columna es cosa de aqui.
const SORT_COLUMN:Record<DocumentListFilter['sort'], string> = {
  creationDate: 'creation_date',
  modificationDate: 'modification_date'
};

const scanReplacements = (scan:ScanRecord) => ({
  scan_status: scan.scanStatus,
  scan_signature: scan.scanSignature,
  scan_engine: scan.scanEngine,
  scan_date: scan.scanDate
});

export const documentRepository:DocumentRepository = {

  async create(organization, metadata, scan, indexStatus, scope?:TransactionScope):Promise<Document> {

    const result:any = await sequelize.query(
      `INSERT INTO pergamo.document(metadata, organization, scan_status, scan_signature, scan_engine, scan_date, index_status)
      VALUES (:metadata::jsonb, :organization, :scan_status, :scan_signature, :scan_engine, :scan_date, :index_status) RETURNING *;`, {
      replacements: {
        metadata: JSON.stringify(metadata),
        organization,
        index_status: indexStatus,
        ...scanReplacements(scan)
      },
      type: QueryTypes.INSERT,
      transaction: scope as any
    });

    return toDocument(result[0][0] as DocumentRow);
  },

  async findById(organization, id):Promise<Document | null> {

    const result:any = await sequelize.query(
      `SELECT id, creation_date, modification_date, path, organization, metadata,
        scan_status, scan_signature, scan_engine, scan_date,
        index_status, index_model, index_converter, index_chunker_version,
        index_chunks, index_error, index_date
      FROM pergamo.document WHERE organization = :organization AND id = :id;`, {
      replacements: { id, organization },
      type: QueryTypes.SELECT
    });

    return result.length === 1 ? toDocument(result[0] as DocumentRow) : null;
  },

  // El contenido cambia, luego el veredicto anterior deja de aplicar.
  async replaceFile(organization, id, metadata, scan, scope?:TransactionScope):Promise<Document> {

    const result:any = await sequelize.query(
      `UPDATE pergamo.document
      SET metadata = :metadata, modification_date = CURRENT_TIMESTAMP,
          scan_status = :scan_status, scan_signature = :scan_signature,
          scan_engine = :scan_engine, scan_date = :scan_date
      WHERE organization = :organization AND id = :id RETURNING *;`, {
      replacements: { metadata: JSON.stringify(metadata), organization, id, ...scanReplacements(scan) },
      type: QueryTypes.INSERT,
      transaction: scope as any
    });

    return toDocument(result[0][0] as DocumentRow);
  },

  async updateMetadata(organization, id, metadata:DocumentMetadata):Promise<Document> {

    const result:any = await sequelize.query(
      `UPDATE pergamo.document
      SET metadata = :metadata, modification_date = CURRENT_TIMESTAMP
      WHERE organization = :organization AND id = :id RETURNING *;`, {
      replacements: { metadata: JSON.stringify(metadata), organization, id },
      type: QueryTypes.INSERT
    });

    return toDocument(result[0][0] as DocumentRow);
  },

  async recordScan(organization, id, scan, scope?:TransactionScope):Promise<Document> {

    const result:any = await sequelize.query(
      `UPDATE pergamo.document
      SET scan_status = :scan_status, scan_signature = :scan_signature,
          scan_engine = :scan_engine, scan_date = :scan_date
      WHERE organization = :organization AND id = :id RETURNING *;`, {
      replacements: { organization, id, ...scanReplacements(scan) },
      type: QueryTypes.INSERT,
      transaction: scope as any
    });

    return toDocument(result[0][0] as DocumentRow);
  },

  async remove(organization, id):Promise<string | null> {

    const result:any = await sequelize.query(
      'DELETE FROM pergamo.document WHERE organization = :organization AND id = :id RETURNING path;', {
      replacements: { organization, id },
      type: QueryTypes.SELECT
    });

    return result.length === 1 ? result[0].path : null;
  },

  async list(filter:DocumentListFilter):Promise<DocumentPage> {

    const { organization, limit, offset, name, tag, scanStatus, from, to, sort, order } = filter;

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

    if(scanStatus) {
      // IN y no '=': el filtro admite varios estados a la vez. Sequelize expande
      // el array del replacement, asi que los valores siguen enlazados.
      conditions.push(`scan_status IN (:scan_status)`);
      replacements.scan_status = scanStatus;
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
    // La columna y el sentido se interpolan porque un identificador no admite
    // parametro enlazado; ambos salen de un enum cerrado, no de la peticion.
    //
    // scan_engine viaja aunque nadie lo muestre: es lo unico que distingue un
    // 'clean' analizado de uno que nunca paso por un escaner.
    const rows:DocumentSummaryRow[] = await sequelize.query(
      `SELECT id, creation_date, modification_date, scan_status, scan_signature, scan_engine, metadata,
        COUNT(*) OVER() AS total
      FROM pergamo.document
      WHERE organization = :organization${where}
      ORDER BY ${SORT_COLUMN[sort]} ${order.toUpperCase()}
      LIMIT :limit OFFSET :offset;`, {
      replacements,
      type: QueryTypes.SELECT
    });

    return {
      total: rows.length ? Number.parseInt(rows[0].total) : 0,
      documents: rows.map(toDocumentSummary)
    };
  },

  async setIndexStatus(document, status, error?, scope?:TransactionScope) {

    await sequelize.query(
      `UPDATE pergamo.document
      SET index_status = :status, index_error = :error, index_date = CURRENT_TIMESTAMP
      WHERE id = :document;`, {
      replacements: { document, status, error: error ?? null },
      type: QueryTypes.UPDATE,
      transaction: scope as any
    });
  },

  async finishIndexing(document, hash, result:IndexResult, scope?:TransactionScope) {

    const [, affected]:any = await sequelize.query(
      `UPDATE pergamo.document
      SET index_status = 'indexed', index_model = :model, index_converter = :converter,
          index_chunker_version = :chunkerVersion, index_chunks = :chunks,
          index_error = NULL, index_date = CURRENT_TIMESTAMP
      WHERE id = :document AND metadata->>'hash' = :hash;`, {
      replacements: { document, hash, ...result },
      type: QueryTypes.UPDATE,
      transaction: scope as any
    });

    return affected > 0;
  }
};
