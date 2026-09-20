import path from 'path';

// Solo documentacion: lo demas de un repositorio no es un documento.
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];
export const MARKDOWN_MIMETYPE = 'text/markdown';

/**
 * Credenciales de GitHub de una organizacion. El token no forma parte de la
 * entidad: solo lo abre el repositorio, para el cliente de GitHub.
 */
export interface GitHubSettings {
  organization: string;
  // NULL es github.com; se rellena para GitHub Enterprise.
  apiUrl?: string;
  hasToken: boolean;
  creationDate: Date;
  modificationDate: Date;
}

/** Repositorio y rama que se sincronizan. */
export interface GitHubRepository {
  id: string;
  organization: string;
  owner: string;
  repository: string;
  branch: string;
  // owner/repositorio, para la interfaz.
  name: string;
  indexDocuments: boolean;
  // Guarda el Markdown en Pergamo en vez de bajarlo de la API cada vez.
  storeContent: boolean;
  // Patrones glob, relativos a la raiz de la rama, que no se archivan.
  excludes: string[];
  // Ultimo commit sincronizado: si la rama no ha avanzado, no hay diff que hacer.
  lastCommit?: string;
  creationDate: Date;
  syncDate?: Date;
  syncError?: string;
}

// Repositorio tal cual se ofrece en el selector.
export interface GitHubEntry {
  owner: string;
  repository: string;
  defaultBranch: string;
  private: boolean;
}

/** Un fichero Markdown de la rama. `sha` es el hash del blob: si cambia, cambio. */
export interface GitHubFile {
  path: string;
  sha: string;
  size: number;
  viewLink: string;
}

export interface GitHubFileRef {
  owner: string;
  repository: string;
  branch: string;
  path: string;
}

/**
 * Identidad de un documento de GitHub: la ruta dentro de una rama concreta.
 * Lleva la rama dentro para que dos ramas sincronizadas del mismo repositorio no
 * se disputen el mismo documento, y es lo que permite volver a bajarlo mas tarde
 * sin mirar en que repositorio estaba dado de alta.
 */
export const githubFileId = (ref:GitHubFileRef) =>
  `${ref.owner}/${ref.repository}@${ref.branch}:${ref.path}`;

// Ni el propietario ni el repositorio admiten «/» ni «@», y una rama de Git no
// admite «:»: por eso se puede deshacer sin ambiguedad.
const FILE_ID = /^([^/]+)\/([^@]+)@([^:]+):(.+)$/;

export const parseGitHubFileId = (fileId:string):GitHubFileRef => {

  const parts = FILE_ID.exec(fileId);

  if(!parts) throw new Error(`Malformed GitHub file id "${fileId}"`);

  return { owner: parts[1], repository: parts[2], branch: parts[3], path: parts[4] };
};

/**
 * Un patron sin comodines vale tambien como carpeta —`docs/interno` excluye todo
 * lo que cuelga de ella—, que es lo que espera quien lo escribe. Para el resto
 * mandan las reglas de glob: `*` no cruza `/` y `**` si.
 */
export const isExcluded = (filePath:string, patterns:string[]) =>
  patterns.some((pattern) =>
    path.matchesGlob(filePath, pattern) ||
    path.matchesGlob(filePath, `${pattern.replace(/\/+$/, '')}/**`));
