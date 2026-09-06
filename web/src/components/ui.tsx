import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { ApiError } from '../api/client';
import type { ScanStatus } from '../api/types';

/* ============================================================= veredictos == */

/**
 * Lo que dice cada estado de analisis, en lenguaje de quien custodia el
 * documento y no de quien programo el escaner.
 */
export const VEREDICTO: Record<ScanStatus, string> = {
  clean: 'verificado',
  pending: 'sin verificar',
  infected: 'en cuarentena',
  error: 'análisis fallido'
};

/**
 * Marca de veredicto en el margen del registro.
 *
 * Nunca va sola: el color no puede ser el unico portador de la informacion, asi
 * que todo lo que no esta verificado lleva ademas su palabra en la entrada. Lo
 * verificado no dice nada, porque es lo normal.
 */
export const Marca = ({ status }: { status: ScanStatus }) => (
  <span className={`marca marca--${status}`} role="img" aria-label={VEREDICTO[status] || status} />
);

/* ================================================================ mensajes == */

/**
 * Traduce un fallo a algo accionable.
 *
 * Los codigos que la API usa de forma deliberada —423 cuarentena, 413 tamaño,
 * 429 limite de intentos— merecen explicacion propia: mostrados como «error
 * 423» no le dicen nada a quien esta delante.
 */
export const mensajeDeError = (error: unknown): string => {
  if (!(error instanceof ApiError)) {
    return error instanceof Error && error.message
      ? error.message
      : 'No se ha podido contactar con el servidor.';
  }

  if (error.status === 429) {
    const minutos = error.retryAfter ? Math.ceil(error.retryAfter / 60) : null;
    return minutos
      ? `Demasiados intentos seguidos. Vuelve a probar en ${minutos} minuto${minutos === 1 ? '' : 's'}.`
      : 'Demasiados intentos seguidos. Espera unos minutos antes de volver a probar.';
  }

  if (error.status === 413) return 'El fichero supera el tamaño máximo que admite el servidor.';
  if (error.status === 0) return 'No se ha podido contactar con el servidor.';

  return error.message;
};

export const Aviso = ({ tipo = 'info', titulo, children }: {
  tipo?: 'info' | 'error' | 'warn' | 'exito';
  titulo?: string;
  children: ReactNode;
}) => (
  <div className={`aviso aviso--${tipo}`} role={tipo === 'error' ? 'alert' : undefined}>
    {titulo ? <strong>{titulo}</strong> : null}
    {children}
  </div>
);

export const AvisoDeError = ({ error }: { error: unknown }) =>
  error ? <Aviso tipo="error">{mensajeDeError(error)}</Aviso> : null;

export const Cargando = ({ texto = 'Cargando…' }: { texto?: string }) => (
  <div className="cargando"><span className="girando" aria-hidden="true" /> {texto}</div>
);

/** Una pantalla vacia es una invitacion a actuar, no un cartel de «no hay nada». */
export const Vacio = ({ titulo, children }: { titulo: string; children?: ReactNode }) => (
  <div className="vacio">
    <h2>{titulo}</h2>
    {children ? <p>{children}</p> : null}
  </div>
);

/* ================================================================= dialogo == */

export const Dialogo = ({ titulo, onClose, children, pie }: {
  titulo: string;
  onClose: () => void;
  children: ReactNode;
  pie?: ReactNode;
}) => {

  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') onClose(); };
    document.addEventListener('keydown', alPulsar);
    caja.current?.focus();
    return () => document.removeEventListener('keydown', alPulsar);
  }, [onClose]);

  return (
    <div className="telon" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}>
      <div className="dialogo" role="dialog" aria-modal="true" aria-label={titulo} tabIndex={-1} ref={caja}>
        <div className="dialogo__cabeza">
          <h2>{titulo}</h2>
        </div>
        {children}
        {pie ? <div className="dialogo__pie">{pie}</div> : null}
      </div>
    </div>
  );
};

/* =================================================================== datos == */

export const formatearFecha = (valor?: string | number | null, conHora = true) => {
  if (!valor) return '—';

  // El backend guarda TIMESTAMP WITHOUT TIME ZONE y lo serializa sin zona: se
  // interpreta como UTC, que es la zona en la que corre el servidor.
  const bruto = typeof valor === 'string' && !valor.endsWith('Z') && !/[+-]\d\d:?\d\d$/.test(valor)
    ? `${valor}Z`
    : valor;

  const fecha = new Date(bruto);
  if (Number.isNaN(fecha.getTime())) return String(valor);

  return fecha.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(conHora ? { hour: '2-digit', minute: '2-digit' } : {})
  });
};

export const formatearTamano = (bytes: number) => {
  if (!Number.isFinite(bytes)) return '—';

  const unidades = ['B', 'KB', 'MB', 'GB'];
  let valor = bytes;
  let unidad = 0;

  while (valor >= 1024 && unidad < unidades.length - 1) { valor /= 1024; unidad += 1; }

  return `${valor % 1 === 0 ? valor : valor.toFixed(1)} ${unidades[unidad]}`;
};

export const Dato = ({ termino, children }: { termino: string; children: ReactNode }) => (
  <div className="dato">
    <dt>{termino}</dt>
    <dd>{children}</dd>
  </div>
);

/* =============================================================== etiquetas == */

export const CampoEtiquetas = ({ value, onChange, id }: {
  value: string[];
  onChange: (etiquetas: string[]) => void;
  id?: string;
}) => {

  const anadir = (bruto: string) => {
    const etiqueta = bruto.trim();
    // Duplicados fuera: el filtro por etiqueta del registro los trataria como
    // uno solo de todas formas.
    if (etiqueta && !value.includes(etiqueta)) onChange([...value, etiqueta]);
  };

  return (
    <div className="etiquetas-campo">
      {value.map((etiqueta) => (
        <span className="etiqueta" key={etiqueta}>
          {etiqueta}
          <button type="button" onClick={() => onChange(value.filter((item) => item !== etiqueta))} aria-label={`Quitar ${etiqueta}`}>✕</button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        placeholder="Añadir etiqueta y pulsar Intro"
        onKeyDown={(evento) => {
          if (evento.key === 'Enter' || evento.key === ',') {
            evento.preventDefault();
            anadir(evento.currentTarget.value);
            evento.currentTarget.value = '';
          } else if (evento.key === 'Backspace' && !evento.currentTarget.value && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={(evento) => { anadir(evento.currentTarget.value); evento.currentTarget.value = ''; }}
      />
    </div>
  );
};
