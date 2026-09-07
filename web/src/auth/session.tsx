import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { api, onUnauthorized, tokenStore } from '../api/client';
import { t } from '../i18n';

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

// Lee el payload del JWT sin verificarlo: solo decide lo que pinta la interfaz.
// Quien autoriza sigue siendo el backend, que si comprueba la firma.
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

  // Un token ya caducado se descarta aqui, sin esperar al primer 401.
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

    if (!next) throw new Error(t('login.unreadableToken'));

    tokenStore.set(token);
    setSession(next);
  }, []);

  // Cualquier 401 cierra la sesion, venga de donde venga.
  useEffect(() => onUnauthorized(() => setSession(null)), []);

  // Cierre automatico al caducar, para no descubrirlo a mitad de una subida.
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
  if (!context) throw new Error('useSession used outside SessionProvider');
  return context;
};
