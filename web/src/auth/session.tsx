import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { api, onUnauthorized, tokenStore } from '../api/client';

export interface Session {
  token: string;
  /** Nombre con el que se ha entrado. */
  name: string;
  /** Id de la organizacion. Ausente en el token master: no tiene ninguna. */
  organization?: string;
  master: boolean;
  /** Caducidad del token, en milisegundos. */
  expiresAt?: number;
}

interface SessionContextValue {
  session: Session | null;
  login: (name: string, password: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Lee el payload del JWT sin verificarlo.
 *
 * Es solo para decidir que pinta la interfaz (menu de master, nombre en la
 * barra, cierre por caducidad). La autoridad sobre lo que se puede hacer sigue
 * siendo el backend, que si verifica la firma en cada peticion: manipular este
 * payload en el navegador no da acceso a nada.
 */
const readToken = (token: string): Session | null => {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;

    const decoded = JSON.parse(
      decodeURIComponent(
        atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
          .split('')
          .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
          .join('')
      )
    );

    return {
      token,
      name: decoded.name || '',
      organization: decoded.organization,
      master: decoded.master === true,
      expiresAt: decoded.exp ? decoded.exp * 1000 : undefined
    };
  } catch {
    return null;
  }
};

const restore = (): Session | null => {
  const token = tokenStore.get();
  if (!token) return null;

  const session = readToken(token);

  // Un token ya caducado no llega a usarse: se descarta aqui en vez de esperar
  // al primer 401.
  if (!session || (session.expiresAt && session.expiresAt <= Date.now())) {
    tokenStore.clear();
    return null;
  }

  return session;
};

export const SessionProvider = ({ children }: { children: ReactNode }) => {

  const [session, setSession] = useState<Session | null>(restore);

  const logout = useCallback(() => {
    tokenStore.clear();
    setSession(null);
  }, []);

  const login = useCallback(async (name: string, password: string) => {
    const { token } = await api.login(name, password);
    const next = readToken(token);

    if (!next) throw new Error('El servidor ha devuelto un token que no se puede leer');

    tokenStore.set(token);
    setSession(next);
  }, []);

  // Cualquier 401 cierra la sesion, venga de donde venga: sin esto, una pantalla
  // con el token caducado se quedaria mostrando errores sin explicar por que.
  useEffect(() => onUnauthorized(() => setSession(null)), []);

  // Cierre automatico al caducar el token, para no descubrirlo a mitad de una
  // subida larga.
  useEffect(() => {
    if (!session?.expiresAt) return;

    const remaining = session.expiresAt - Date.now();
    if (remaining <= 0) { logout(); return; }

    const timer = setTimeout(logout, remaining);
    return () => clearTimeout(timer);
  }, [session, logout]);

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession fuera de SessionProvider');
  return context;
};
