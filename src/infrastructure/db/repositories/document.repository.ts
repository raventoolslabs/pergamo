import sequelize, { QueryTypes } from '@/infrastructure/db/client';
import { Document, DocumentMetadata, RemoteSource } from '@/domain/entities/document';
import { TransactionScope } from '@/app/ports/unit-of-work';
import {
  DocumentListFilter, DocumentPage, DocumentRepository, IndexResult, ScanRecord
} from '@/app/ports/repositories/document.repository';
import { DocumentRow, DocumentSummaryRow, RemoteStateRow } from '@/infrastructure/db/schema/document.row';
import { toDocument, toDocumentSummary, toRemoteState } from '@/infrastructure/db/mappers/document.mapper';
import { escapeLike } from '@/shared/validation';

// El orden llega como concepto del dominio; la columna es cosa de aqui.
//
// El nombre se ordena con clean_str, igual que se filtra: sin ella la ene con
// virgulilla cae detras de la zeta. El estado se ordena por gravedad y no por
// letra, que pondria 'clean' antes que 'error' y no agruparia lo retenido.
const SORT_COLUMN:Record<DocumentListFilter['sort'], string> = {
  creationDate: 'creation_date',
  modificationDate: 'modification_date',
  name: `clean_str(metadata->>'name')`,
  scanStatus: `CASE scan_status
    WHEN 'clean' THEN 0 WHEN 'pending' THEN 1 WHEN 'error' THEN 2
    WHEN 'infected' THEN 3 WHEN 'malicious' THEN 4 END`
};

const scanReplacements = (scan:ScanRecord) => ({
  scan_status: scan.scanStatus,
  scan_signature: scan.scanSignature,
  scan_engine: scan.scanEngine,
  scan_date: scan.scanDate
});

const remoteReplacements = (remote?:RemoteSource) => ({
  remote_file_id: remote?.fileId ?? null,
  remote_folder: remote?.folder ?? null,
  remote_revision: remote?.revision ?? null,
  remote_view_link: remote?.viewLink ?? null
});

export const documentRepository:DocumentRepository = {

  async create(organization, metadata, scan, indexStatus, scope?:TransactionScope, remote?):Promise<Document> {

    const result:any = await sequelize.query(
      `INSERT INTO pergamo.document(metadata, organization, scan_status, scan_signature, scan_engine, scan_date, index_status,
        source, remote_file_id, remote_folder, remote_revision, remote_view_link)
      VALUES (:metadata::jsonb, :organization, :scan_status, :scan_signature, :scan_engine, :scan_date, :index_status,
        :source, :remote_file_id, :remote_folder, :remote_revision, :remote_view_link) RETURNING *;`, {
      replacements: {
        metadata: JSON.stringify(metadata),
        organization,
        index_status: indexStatus,
        source: remote?.source ?? 'disk',
        ...remoteReplacements(remote),
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
        index_chunks, index_error, index_date,
        source, remote_file_id, remote_folder, remote_revision, remote_view_link, discharge_date
      FROM pergamo.document WHERE organization = :organization AND id = :id AND discharge_date IS NULL;`, {
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
      WHERE organization = :organization AND id = :id AND discharge_date IS NULL RETURNING *;`, {
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
      WHERE organization = :organization AND id = :id AND discharge_date IS NULL RETURNING *;`, {
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
      WHERE organization = :organization AND id = :id AND discharge_date IS NULL RETURNING *;`, {
      replacements: { organization, id, ...scanReplacements(scan) },
      type: QueryTypes.INSERT,
      transaction: scope as any
    });

    return toDocument(result[0][0] as DocumentRow);
  },

  async remove(organization, id) {

    const result:any = await sequelize.query(
      'DELETE FROM pergamo.document WHERE organization = :organization AND id = :id AND discharge_date IS NULL RETURNING path, source;', {
      replacements: { organization, id },
      type: QueryTypes.SELECT
    });

    return result.length === 1 ? { path: result[0].path, source: result[0].source } : null;
  },

  async list(filter:DocumentListFilter):Promise<DocumentPage> {

    const { organization, limit, offset, name, tag, scanStatus, maxSize, from, to, sort, order } = filter;

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

    if(maxSize !== undefined) {
      // Sin tamano guardado no se afirma nada: entra, y decide el escaner.
      conditions.push(`COALESCE((metadata->>'size')::bigint, 0) <= :max_size`);
      replacements.max_size = maxSize;
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
    const direction = order.toUpperCase();

    // COUNT(*) OVER() da el total sin paginar en la misma pasada: una segunda
    // consulta podria ademas ver un corpus distinto.
    //
    // La columna y el sentido se interpolan porque un identificador no admite
    // parametro enlazado; ambos salen de un enum cerrado, no de la peticion.
    //
    // El id desempata: con valores repetidos, dos paginas consecutivas pueden
    // traer la misma fila y saltarse otra. Va en el mismo sentido que la
    // columna para que el indice sirva el orden entero sin reordenar.
    //
    // scan_engine viaja aunque nadie lo muestre: es lo unico que distingue un
    // 'clean' analizado de uno que nunca paso por un escaner.
    const rows:DocumentSummaryRow[] = await sequelize.query(
      `SELECT id, creation_date, modification_date, scan_status, scan_signature, scan_engine, metadata, source, remote_view_link,
        COUNT(*) OVER() AS total
      FROM pergamo.document
      WHERE organization = :organization AND discharge_date IS NULL${where}
      ORDER BY ${SORT_COLUMN[sort]} ${direction}, id ${direction}
      LIMIT :limit OFFSET :offset;`, {
      replacements,
      type: QueryTypes.SELECT
    });

    return {
      total: rows.length ? Number.parseInt(rows[0].total) : 0,
      documents: rows.map(toDocumentSummary)
    };
  },

  async listRemoteState(organization, source, afterId, limit) {

    const rows:RemoteStateRow[] = await sequelize.query(
      `SELECT id, remote_file_id, remote_folder, remote_revision, index_status, discharge_date IS NOT NULL AS discharged
      FROM pergamo.document
      WHERE organization = :organization AND source = :source
        AND (:afterId::varchar IS NULL OR id > :afterId)
      ORDER BY id
      LIMIT :limit;`, {
      replacements: { organization, source, afterId, limit },
      type: QueryTypes.SELECT
    });

    return rows.map(toRemoteState);
  },

  async updateRemote(organization, id, metadata, remote, scan, indexStatus, scope?:TransactionScope) {

    const result:any = await sequelize.query(
      `UPDATE pergamo.document
      SET metadata = metadata || :metadata::jsonb, modification_date = CURRENT_TIMESTAMP,
          remote_folder = :remote_folder, remote_revision = :remote_revision, remote_view_link = :remote_view_link,
          scan_status = CASE WHEN :rescan THEN :scan_status ELSE scan_status END,
          scan_signature = CASE WHEN :rescan THEN :scan_signature ELSE scan_signature END,
          scan_engine = CASE WHEN :rescan THEN :scan_engine ELSE scan_engine END,
          scan_date = CASE WHEN :rescan THEN CAST(:scan_date AS timestamp) ELSE scan_date END,
          index_status = COALESCE(:index_status, index_status),
          index_error = CASE WHEN :index_status IS NULL THEN index_error END,
          discharge_date = NULL
      WHERE organization = :organization AND id = :id AND source = :source RETURNING *;`, {
      replacements: {
        metadata: JSON.stringify(metadata),
        organization,
        id,
        source: remote.source,
        index_status: indexStatus,
        rescan: scan !== null,
        ...remoteReplacements(remote),
        ...scanReplacements(scan ?? { scanStatus: null, scanSignature: null, scanEngine: null, scanDate: null })
      },
      type: QueryTypes.INSERT,
      transaction: scope as any
    });

    return toDocument(result[0][0] as DocumentRow);
  },

  // index_status vuelve a 'none': sin chunks no hay indice, y al revivir decide la carpeta.
  async discharge(organization, ids, scope?:TransactionScope) {

    if(!ids.length) return;

    await sequelize.query(
      `UPDATE pergamo.document
      SET discharge_date = CURRENT_TIMESTAMP, index_status = 'none', index_chunks = NULL
      WHERE organization = :organization AND id IN (:ids) AND discharge_date IS NULL;`, {
      replacements: { organization, ids },
      type: QueryTypes.UPDATE,
      transaction: scope as any
    });
  },

  // Sin filtro de baja, igual que finishIndexing: sirven a un trabajo ya en
  // curso, y con el filtro una baja a mitad dejaria el documento en 'indexing'.
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
