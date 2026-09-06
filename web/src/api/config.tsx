import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { api } from './client';
import type { ServerConfig } from './types';

/**
 * Limites del despliegue (mimetypes, tamano maximo, campos editables). Se
 * piden una vez por sesion: son configuracion de arranque del servidor y no
 * cambian mientras dure.
 */
const ConfigContext = createContext<ServerConfig | null>(null);

const FALLBACK: ServerConfig = {
  valid_mimetype: [],
  valid_metadata_modify: [],
  max_file_size: 0,
  max_version_file: 1
};

export const ConfigProvider = ({ children }: { children: ReactNode }) => {

  const [config, setConfig] = useState<ServerConfig | null>(null);

  useEffect(() => {
    let alive = true;

    api.config()
      .then((value) => { if (alive) setConfig(value); })
      // Si /config falla, la interfaz sigue funcionando: se pierde la
      // validacion previa a la subida, pero el servidor la aplica igualmente.
      .catch(() => { if (alive) setConfig(FALLBACK); });

    return () => { alive = false; };
  }, []);

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
};

export const useConfig = () => useContext(ConfigContext);
