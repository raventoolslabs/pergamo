import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';

import { ApiError } from '../api/client';
import type { ScanStatus } from '../api/types';

/* ============================================================= veredictos == */

/**
 * Lo que dice cada estado de analisis, en lenguaje de quien custodia el
 * documento y no de quien programo el escaner.
 *
 * La interfaz habla de TRES estados y el backend guarda cuatro: 'error' —el
 * fichero no esta en disco— comparte etiqueta con la cuarentena porque para
 * quien consulta significan lo mismo (no se descarga, alguien tiene que
 * mirarlo) y ninguno de los dos se arregla esperando. La diferencia real se
 * cuenta en la explicacion, que va en el title de la fila y a la vista en la
 * ficha del documento.
 */
export const ESTADO: Record<ScanStatus, { etiqueta: string; explicacion: string }> = {
  clean: {
    etiqueta: 'Analizado',
    explicacion: 'Analizado sin hallazgos: se puede descargar.'
  },
  pending: {
    etiqueta: 'Sin analizar',
    explicacion: 'Todavía no hay veredicto. El próximo análisis lo resuelve, y hasta entonces no se entrega.'
  },
  infected: {
    etiqueta: 'En cuarentena',
    explicacion: 'El análisis encontró una firma conocida en el fichero, así que Pergamo no lo entrega.'
  },
  error: {
    etiqueta: 'En cuarentena',
    explicacion: 'El fichero no se encuentra en el almacén. No es un análisis pendiente: hay que revisarlo.'
  }
};

const ICONO: Record<ScanStatus, ReactNode> = {
  clean: <><circle cx="12" cy="12" r="8.4" /><path d="M8.4 12.2l2.6 2.6 4.6-5" /></>,
  pending: <><circle cx="12" cy="12" r="8.4" /><path d="M12 8v4.4l3 1.8" /></>,
  infected: <><path d="M12 3.6l7 3v5c0 4-3 7-7 8.8-4-1.8-7-4.8-7-8.8v-5z" /><path d="M12 9v3.6" /><path d="M12 15.4h.01" /></>,
  error: <><path d="M12 3.6l7 3v5c0 4-3 7-7 8.8-4-1.8-7-4.8-7-8.8v-5z" /><path d="M12 9v3.6" /><path d="M12 15.4h.01" /></>
};

/**
 * Veredicto de un documento: icono y palabra, nunca uno de los dos solo.
 *
 * El color no puede ser el unico portador de la informacion —ni para quien no
 * lo distingue, ni para quien no conoce el codigo—, asi que el icono lleva
 * siempre su etiqueta al lado y no hay que aprenderse nada.
 */
export const Veredicto = ({ status }: { status: ScanStatus }) => (
  <div className={`veredicto veredicto--${status}`} title={ESTADO[status]?.explicacion}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONO[status]}
    </svg>
    <span>{ESTADO[status]?.etiqueta || status}</span>
  </div>
);

/* ============================================================== paginacion == */

/** Tamaños de pagina que se ofrecen. El primero es el de partida. */
export const POR_PAGINA = [8, 12, 24];

const IconoAnterior = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M14 6l-6 6 6 6" /></svg>
);

const IconoSiguiente = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M10 6l6 6-6 6" /></svg>
);

/**
 * Paginacion de un listado servido por la API.
 *
 * Es la misma en el registro de documentos y en el de organizaciones: dos
 * listados paginados en servidor con los mismos parametros (limit y offset) no
 * tienen por que discrepar en como se recorren.
 *
 * Recibe el total y la pagina, no la lista: quien pagina es el servidor, y este
 * componente solo traduce eso a botones.
 */
export const Paginacion = ({ total, pagina, porPagina, mostrados, ocupado, onPagina, onPorPagina }: {
  total: number;
  pagina: number;
  porPagina: number;
  /** Filas que han llegado en esta pagina, para el extremo del rango. */
  mostrados: number;
  ocupado?: boolean;
  onPagina: (pagina: number) => void;
  onPorPagina: (porPagina: number) => void;
}) => {

  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const desde = (pagina - 1) * porPagina;

  // Al estrechar el filtro la pagina actual puede quedar mas alla del final.
  useEffect(() => {
    if (pagina > paginas) onPagina(paginas);
  }, [pagina, paginas, onPagina]);

  // Ventana de paginas, no la lista entera: un listado de mil filas daria
  // ciento veinticinco botones, y ninguno de los del medio le sirve a nadie.
  // Se ven los extremos y la vecindad de la actual, con un hueco entre medias.
  const numeros = useMemo(() => {
    const cerca = new Set([1, paginas, pagina - 1, pagina, pagina + 1]);
    const visibles = [...cerca].filter((numero) => numero >= 1 && numero <= paginas).sort((a, b) => a - b);

    return visibles.flatMap((numero, indice) =>
      indice && numero - visibles[indice - 1] > 1 ? ['…', numero] : [numero]);
  }, [pagina, paginas]);

  return (
    <div className="paginacion">
      <span className="paginacion__cuenta">
        {total ? `${desde + 1}–${Math.min(desde + mostrados, total)} de ${total}` : 'Sin resultados'}
      </span>

      <div className="paginacion__paginas">
        <button
          type="button"
          className="btn btn--icono"
          aria-label="Página anterior"
          onClick={() => onPagina(Math.max(1, pagina - 1))}
          disabled={pagina === 1 || ocupado}
        ><IconoAnterior /></button>

        {numeros.map((numero, indice) => (
          typeof numero === 'number' ? (
            <button
              type="button"
              className="btn"
              key={numero}
              aria-label={`Página ${numero}`}
              aria-current={numero === pagina ? 'page' : undefined}
              onClick={() => onPagina(numero)}
            >{numero}</button>
          ) : (
            <span className="paginacion__hueco" key={`hueco-${indice}`} aria-hidden="true">…</span>
          )
        ))}

        <button
          type="button"
          className="btn btn--icono"
          aria-label="Página siguiente"
          onClick={() => onPagina(Math.min(paginas, pagina + 1))}
          disabled={pagina >= paginas || ocupado}
        ><IconoSiguiente /></button>
      </div>

      <label className="paginacion__por-pagina">
        Por página
        <select value={porPagina} onChange={(evento) => onPorPagina(Number(evento.target.value))}>
          {POR_PAGINA.map((cuantos) => (
            <option value={cuantos} key={cuantos}>{cuantos}</option>
          ))}
        </select>
      </label>
    </div>
  );
};

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
export const Vacio = ({ titulo, centrado, children }: {
  titulo: string;
  centrado?: boolean;
  children?: ReactNode;
}) => (
  <div className={`vacio${centrado ? ' vacio--centrado' : ''}`}>
    <h2>{titulo}</h2>
    {children ? <p>{children}</p> : null}
  </div>
);

/* ================================================================= dialogo == */

export const Dialogo = ({ titulo, ariaLabel, onClose, children, pie, desnudo }: {
  titulo?: string;
  /** Solo hace falta si `desnudo` no lleva `titulo` visible que sirva de aria-label. */
  ariaLabel?: string;
  onClose: () => void;
  children: ReactNode;
  pie?: ReactNode;
  /** Sin fondo, cabecera ni pie propios: para un hijo que ya es una tarjeta
      completa (como CambiarContrasena) y no debe quedar dentro de otra. Solo
      aporta el telon, la trampa de foco y el cierre con Escape o clic fuera. */
  desnudo?: boolean;
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
      <div
        className={`dialogo${desnudo ? ' dialogo--desnudo' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? titulo}
        tabIndex={-1}
        ref={caja}
      >
        {desnudo ? children : (
          <>
            <div className="dialogo__cabeza">
              <h2>{titulo}</h2>
            </div>
            {children}
            {pie ? <div className="dialogo__pie">{pie}</div> : null}
          </>
        )}
      </div>
    </div>
  );
};

/* =================================================================== datos == */

export const formatearFecha = (valor?: string | number | null, conHora = true, separador?: string) => {
  if (!valor) return '—';

  // El backend guarda TIMESTAMP WITHOUT TIME ZONE y lo serializa sin zona: se
  // interpreta como UTC, que es la zona en la que corre el servidor.
  const bruto = typeof valor === 'string' && !valor.endsWith('Z') && !/[+-]\d\d:?\d\d$/.test(valor)
    ? `${valor}Z`
    : valor;

  const fecha = new Date(bruto);
  if (Number.isNaN(fecha.getTime())) return String(valor);

  const texto = fecha.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(conHora ? { hour: '2-digit', minute: '2-digit' } : {})
  });

  // es-ES separa fecha y hora con una coma. En una columna de tabla, donde la
  // fecha ya es un dato compacto, la coma se lee como parte del numero: el
  // separador explicito la sustituye alli donde se pide.
  return separador ? texto.replace(', ', ` ${separador} `) : texto;
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
