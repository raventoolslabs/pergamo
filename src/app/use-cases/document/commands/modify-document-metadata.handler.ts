import Config from '@/shared/config';
import { Document, DocumentMetadata } from '@/domain/entities/document';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { metadataValueSchema } from '@/shared/validation';
import { DocumentDeps } from '../dependencies';
import { getDocument } from '../queries/get-document.handler';

export interface ModifyDocumentMetadataInput {
  organization: string;
  id: string;
  changes: Record<string, unknown>;
}

export const modifyDocumentMetadata = async (input:ModifyDocumentMetadataInput, deps:DocumentDeps):Promise<Document> => {

  const { organization, id, changes } = input;

  const current = await getDocument(organization, id, deps);

  const metadata:DocumentMetadata = { ...current.metadata };

  // Lo que no declare VALID_METADATA_MODIFY se ignora en silencio; lo que si
  // esta, pero con un valor inaceptable, es un error de peticion.
  Object.keys(changes).forEach((key) => {

    if(!Config.valid_metadata_modify.includes(key)) return;

    const value = metadataValueSchema.safeParse(changes[key]);

    if(!value.success) throw new ValidationError(
      'INVALID_METADATA', `Invalid value for metadata field "${key}"`);

    metadata[key] = changes[key];
  });

  return deps.documents.updateMetadata(organization, id, metadata);
}
