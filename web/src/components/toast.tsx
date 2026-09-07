import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { t } from '../i18n';

type ToastKind = 'success' | 'error' | 'warn';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<((message: string, kind?: ToastKind) => void) | null>(null);

let nextId = 1;

export const ToastProvider = ({ children }: { children: ReactNode }) => {

  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = nextId++;
    setToasts((current) => [...current, { id, kind, message }]);
    // Los errores no se van solos: suelen decir algo que hay que leer entero.
    if (kind === 'success') setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="notices" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.kind}`}>
            <p>{toast.message}</p>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label={t('a11y.dismissNotice')}>✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast used outside ToastProvider');
  return context;
};
