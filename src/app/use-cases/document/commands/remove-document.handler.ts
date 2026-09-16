import Config from '@/shared/config';
import log from '@/shared/logger';
import { NotFoundError } from '@/domain/exceptions/domain.exception';
import { DocumentDeps } from '../dependencies';

export interface RemoveDocumentInput {
  organization: string;
  id: string;
  trace: string;
}

export const removeDocument = async (input:RemoveDocumentInput, deps:DocumentDeps):Promise<void> => {

  const { organization, id, trace } = input;

  const removed = await deps.documents.remove(organization, id);

  if(removed === null) throw new NotFoundError('NO_CONTENT',
    `Document with id ${id} not exists in organization ${organization}`);

  // Un documento de Drive no tiene nada en disco: el arbol que se recorreria no existe.
  if(!Config.remove_file_disk || removed.source === 'drive') return;

  // La fila ya no esta: un fallo de disco no puede deshacer el borrado, asi
  // que se registra y se deja el fichero huerfano para el operador.
  try {
    await deps.storage.removeDocument(organization, removed.path);
  } catch(error:any) {
    log.warn(`${trace} | Document ${id} removed from database, but file removal failed: ${error.message}`);
  }
}
