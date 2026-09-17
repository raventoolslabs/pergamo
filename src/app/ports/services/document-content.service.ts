import { Document } from '@/domain/entities/document';

export interface DocumentContentFile {
  filePath: string;
  // Borra lo que se bajo a temporal; en disco no hace nada.
  release(): Promise<void>;
}

/**
 * El escaner y el conversor necesitan una ruta local. Este puerto la da venga el
 * documento de disco o de Drive, y asi ninguno de los dos sabe de donde sale.
 * `null` es que el fichero ya no esta: FILE_MISSING.
 */
export interface DocumentContent {
  fetch(document:Document): Promise<DocumentContentFile | null>;
}
