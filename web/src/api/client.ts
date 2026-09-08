import type {
  ChunkList, DocumentList, DocumentMetadata, DocumentQuery, DocumentVersion, IndexInfo,
  Organization, OrganizationList, ScanInfo, ServerConfig
} from './types';

const TOKEN_KEY = 'pergamo.token';

// Con el codigo HTTP a la vista: las pantallas distinguen casos concretos (423
// cuarentena, 429 rate limit, 413 demasiado grande) y no solo el mensaje.
export class ApiError extends Error {
  status: number;
  retryAfter?: number;

  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// sessionStorage: el token sobrevive a un F5 pero no a cerrar la pestana.
export const tokenStore = {
  get: () => {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set: (token: string) => {
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* modo privado */ }
  },
  clear: () => {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* modo privado */ }
  }
};

// Se avisa a la aplicacion cuando la sesion caduca, para que ninguna llamada
// tenga que ocuparse del 401 por su cuenta.
type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

export const onUnauthorized = (listener: Listener) => {
  unauthorizedListeners.add(listener);
  return () => { unauthorizedListeners.delete(listener); };
};

const authHeaders = (): Record<string, string> => {
  const token = tokenStore.get();
  // JWT crudo, sin prefijo 'Bearer': el backend pasa el valor entero a
  // jwt.verify.
  return token ? { authorization: token } : {};
};

const parseError = async (response: Response) => {
  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined;

  let message = `Error ${response.status}`;

  try {
    const body = await response.json();
    if (body && typeof body.error === 'string') message = body.error;
  } catch {
    // Una respuesta sin JSON (un 502 de un proxy) deja el mensaje generico.
  }

  return new ApiError(response.status, message, Number.isFinite(retryAfter) ? retryAfter : undefined);
};

const handle = async (response: Response) => {
  if (response.status === 401) {
    tokenStore.clear();
    unauthorizedListeners.forEach((listener) => listener());
  }
  if (!response.ok) throw await parseError(response);
  return response;
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await handle(await fetch(path, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) }
  }));

  if (response.status === 204) return undefined as T;

  return await response.json() as T;
};

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
});

const query = (params: Record<string, unknown>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
};

// Se prefiere la forma RFC 5987 (filename*=UTF-8''...): es la que conserva los
// acentos.
const filenameFrom = (disposition: string | null, fallback: string) => {
  if (!disposition) return fallback;

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try { return decodeURIComponent(encoded[1]); } catch { /* cae a la forma plana */ }
  }

  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1] : fallback;
};

export const api = {
  version: () => request<{ version: string }>('/version'),

  config: () => request<ServerConfig>('/config'),

  login: (name: string, password: string) =>
    request<{ token: string }>('/organization/login', json({ name, password })),

  changePassword: (password: string) =>
    request<{ message: string }>('/organization/changePassword', json({ password })),

  organizations: (params: { name?: string; limit?: number; offset?: number; include_discharged?: boolean } = {}) =>
    request<OrganizationList>(`/organization${query(params)}`),

  createOrganization: (body: { name: string; password: string; id?: string }) =>
    request<Organization>('/organization/master/create', json(body)),

  changeOrganizationPassword: (organization: string, password: string) =>
    request<{ message: string }>('/organization/master/changePassword', json({ organization, password })),

  documents: (params: DocumentQuery = {}) =>
    request<DocumentList>(`/document${query(params as Record<string, unknown>)}`),

  document: (id: string) => request<DocumentMetadata>(`/document/${encodeURIComponent(id)}`),

  scan: (id: string) => request<ScanInfo>(`/document/${encodeURIComponent(id)}/scan`),

  indexInfo: (id: string) => request<IndexInfo>(`/document/${encodeURIComponent(id)}/index`),

  chunks: (id: string, params: { limit?: number; offset?: number } = {}) =>
    request<ChunkList>(`/document/${encodeURIComponent(id)}/chunks${query(params)}`),

  versions: (id: string) => request<DocumentVersion[]>(`/document/${encodeURIComponent(id)}/versions`),

  updateMetadata: (id: string, metadata: Record<string, unknown>) =>
    request<DocumentMetadata>(`/document/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(metadata)
    }),

  upload: (file: File, index = false) => {
    const form = new FormData();
    form.append('document', file);
    // La indexacion viaja en la query y no como campo del multipart: multer solo
    // puebla req.body con lo que llega antes del fichero, asi que un campo
    // detras pediria indexar sin obtenerlo y sin error.
    //
    // Sin content-type explicito: lo pone el navegador con el boundary que
    // multer necesita.
    return request<DocumentMetadata>(`/document${query({ index })}`, { method: 'POST', body: form });
  },

  replaceFile: (id: string, file: File) => {
    const form = new FormData();
    form.append('document', file);
    return request<DocumentMetadata>(`/document/${encodeURIComponent(id)}/file`, { method: 'PUT', body: form });
  },

  remove: (id: string) =>
    request<{ message: string }>(`/document/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Por fetch y no por un enlace directo: la ruta exige la cabecera de
  // autorizacion, que un <a href> no puede enviar.
  download: async (id: string, fallbackName: string) => {
    const response = await handle(await fetch(`/document/${encodeURIComponent(id)}/file`, {
      headers: authHeaders()
    }));

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filenameFrom(response.headers.get('content-disposition'), fallbackName);
    document.body.appendChild(link);
    link.click();
    link.remove();

    // Revocar antes de que el navegador arranque la descarga la cancela.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
