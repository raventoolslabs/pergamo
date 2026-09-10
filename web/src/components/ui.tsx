import { createContext, useContext, useEffect, useId, useMemo, useRef } from 'react';
// Con alias: `KeyboardEvent` a secas taparia el del DOM, que es el que usa el
// manejador de Escape del dialogo.
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import { ApiError } from '../api/client';
import type { IndexStatus, ScanStatus } from '../api/types';
import { t } from '../i18n';

/* =============================================================== verdicts == */

/**
 * Veredicto tal y como lo cuenta la interfaz, que no coincide con scan_status.
 *
 * El backend guarda 'clean' tanto para lo que el escaner aprobo como para lo
 * que entro con ENABLE_ANTIVIRUS desactivado, donde nadie lo miro. Los separa
 * scan_engine, nulo en el segundo caso, y llamar «Analizado» a eso es lo que un
 * archivo no puede permitirse.
 */
export type VerdictState = ScanStatus | 'unscanned';

// Lo que el backend retiene (423 en getFile). Se declara aqui y no como un
// `status === 'clean'` repartido por las pantallas: ofrecer una descarga que va
// a devolver 423 es peor que no ofrecerla.
const WITHHELD: ScanStatus[] = ['infected', 'malicious', 'error'];

export const isDeliverable = (status: ScanStatus) => !WITHHELD.includes(status);

/**
 * El 'clean' sin motor es el legado, y el único caso que queda: así se guardaba
 * lo depositado con el antivirus apagado antes de que eso pasara a 'pending'.
 * Llamar «Analizado» a eso es lo que un archivo no puede permitirse.
 *
 * 'pending' NO se traduce aquí. Significa una sola cosa —no hay veredicto— la
 * haya provocado un analizador que no respondió o un despliegue que no tiene
 * ninguno, y darle dos nombres segun una bandera global describía el servidor
 * en la ficha de cada documento. Que este despliegue no analice se cuenta una
 * vez, en el aviso de la pantalla de subida.
 */
export const verdictOf = (status: ScanStatus, engine?: string | null): VerdictState =>
  !engine && status === 'clean' ? 'unscanned' : status;

/**
 * Ninguno comparte etiqueta con otro: dos estados con la misma palabra son un
 * estado a efectos de quien mira.
 *
 * 'error' no es cuarentena. Los dos bloquean la descarga, pero la cuarentena es
 * un documento intacto sobre el que hay que decidir y 'error' es un fichero que
 * falta del almacen: le tocan a personas distintas.
 *
 * 'unscanned' es solo el legado: un 'clean' que ningun motor emitio. No se usa
 * para 'pending', que significa que no hay veredicto todavia y se resuelve.
 */
export const VERDICT: Record<VerdictState, { label: string; detail: string }> = {
  clean: { label: t('verdict.clean.label'), detail: t('verdict.clean.detail') },
  unscanned: { label: t('verdict.unscanned.label'), detail: t('verdict.unscanned.detail') },
  pending: { label: t('verdict.pending.label'), detail: t('verdict.pending.detail') },
  infected: { label: t('verdict.infected.label'), detail: t('verdict.infected.detail') },
  malicious: { label: t('verdict.malicious.label'), detail: t('verdict.malicious.detail') },
  error: { label: t('verdict.error.label'), detail: t('verdict.error.detail') }
};

const VERDICT_ICON: Record<VerdictState, ReactNode> = {
  clean: <><circle cx="12" cy="12" r="8.4" /><path d="M8.4 12.2l2.6 2.6 4.6-5" /></>,
  // Circulo vacio: no hay veredicto que dibujar. Ni visto ni reloj, porque este
  // no espera nada.
  unscanned: <><circle cx="12" cy="12" r="8.4" strokeDasharray="2.6 3.2" /></>,
  pending: <><circle cx="12" cy="12" r="8.4" /><path d="M12 8v4.4l3 1.8" /></>,
  infected: <><path d="M12 3.6l7 3v5c0 4-3 7-7 8.8-4-1.8-7-4.8-7-8.8v-5z" /><path d="M12 9v3.6" /><path d="M12 15.4h.01" /></>,
  // Mismo escudo con un rayo dentro: lo que retiene a este no es una firma,
  // sino lo que el fichero hace al abrirse.
  malicious: <><path d="M12 3.6l7 3v5c0 4-3 7-7 8.8-4-1.8-7-4.8-7-8.8v-5z" /><path d="M12.8 8.2l-2.4 4h3l-2.2 3.6" /></>,
  // Aqui no va el escudo: esto no esta retenido, esta roto.
  error: <><path d="M12 4.2l8 14.4H4z" /><path d="M12 10v3.4" /><path d="M12 16.4h.01" /></>
};

/** Solo el glifo, para un aviso que ya lleva la palabra en su titulo. */
export const VerdictIcon = ({ state, size = 20 }: { state: VerdictState; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {VERDICT_ICON[state]}
  </svg>
);

/**
 * Icono y palabra, nunca uno de los dos solo: el color no puede ser el unico
 * portador de la informacion.
 *
 * `engine` es opcional porque no todas las respuestas de la API lo traen.
 */
export const Verdict = ({ status, engine, chip }: {
  status: ScanStatus;
  engine?: string | null;
  /** Pildora con borde y fondo, para la fila de estado de la ficha. */
  chip?: boolean;
}) => {

  const state = verdictOf(status, engine);

  return (
    <div className={`verdict verdict--${state}${chip ? ' verdict--chip' : ''}`} title={VERDICT[state]?.detail}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {VERDICT_ICON[state]}
      </svg>
      <span>{VERDICT[state]?.label || state}</span>
    </div>
  );
};

/* ================================================================= indice == */

/**
 * Lo que la interfaz cuenta del indice semantico. Ninguno comparte etiqueta:
 * 'none' es un documento que nadie pidio indexar y 'unsupported' uno que si se
 * pidio y cuyo formato no tiene conversor. Llamar a los dos «sin indexar»
 * esconderia el unico de los dos sobre el que hay algo que decidir.
 */
export const INDEX: Record<IndexStatus, { label: string; detail: string }> = {
  none: { label: t('index.none.label'), detail: t('index.none.detail') },
  pending: { label: t('index.pending.label'), detail: t('index.pending.detail') },
  indexing: { label: t('index.indexing.label'), detail: t('index.indexing.detail') },
  indexed: { label: t('index.indexed.label'), detail: t('index.indexed.detail') },
  unsupported: { label: t('index.unsupported.label'), detail: t('index.unsupported.detail') },
  error: { label: t('index.error.label'), detail: t('index.error.detail') }
};

/** Renglones de texto —lo que se indexa— mas el glifo del estado. */
const INDEX_ICON: Record<IndexStatus, ReactNode> = {
  none: <><path d="M4 6.5h16M4 11h16M4 15.5h10" strokeDasharray="2.6 3.2" /></>,
  pending: <><path d="M4 6.5h16M4 11h9" /><circle cx="16" cy="16" r="5" /><path d="M16 13.4V16l1.9 1.1" /></>,
  // Flecha circular: aqui hay una maquina trabajando, no una espera.
  indexing: <><path d="M4 6.5h16M4 11h9" /><path d="M21 16a5 5 0 1 1-1.8-3.8" /><path d="M21.2 11.6v3.2H18" /></>,
  indexed: <><path d="M4 6.5h16M4 11h10" /><path d="M12.6 16.8l3 3 5.6-6.4" /></>,
  // Barrada: el formato no entra, y no es cuestion de esperar.
  unsupported: <><path d="M4 6.5h16M4 11h9" /><circle cx="16" cy="16" r="5" /><path d="M12.5 19.5l7-7" /></>,
  error: <><path d="M4 6.5h16M4 11h9" /><path d="M16 11.6l5.2 9.4h-10.4z" /><path d="M16 15v2.2" /><path d="M16 18.9h.01" /></>
};

/** Solo el glifo, como en el veredicto. */
export const IndexIcon = ({ status, size = 20 }: { status: IndexStatus; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {INDEX_ICON[status]}
  </svg>
);

/** Icono y palabra, como el veredicto: el color nunca lleva solo el mensaje. */
export const IndexState = ({ status, chip }: { status: IndexStatus; chip?: boolean }) => (
  <div className={`verdict verdict--index-${status}${chip ? ' verdict--chip' : ''}`} title={INDEX[status]?.detail}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {INDEX_ICON[status]}
    </svg>
    <span>{INDEX[status]?.label || status}</span>
  </div>
);

/* =================================================================== tabs == */

export interface Tab {
  id: string;
  label: string;
  /** Glifo opcional a la izquierda de la palabra, como en la cinta de la ficha. */
  icon?: ReactNode;
  panel: ReactNode;
}

interface TabsValue {
  tabs: Tab[];
  current: Tab;
  prefix: string;
  label: string;
  onChange: (id: string) => void;
}

const TabsContext = createContext<TabsValue | null>(null);

const useTabs = () => {

  const value = useContext(TabsContext);

  // Un identificador que no case rompe justo lo que no se ve mirando la
  // pantalla, asi que la cinta y el panel no existen fuera del proveedor.
  if(!value) throw new Error('TabStrip and TabPanel must be used inside Tabs');

  return value;
};

/**
 * Proveedor de una cinta de pestañas. Cinta y panel se pintan por separado
 * —en la ficha el titulo y las acciones van entre una y otro—, pero los
 * identificadores que los enlazan se quedan aqui dentro.
 */
export const Tabs = ({ tabs, active, onChange, label, children }: {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  /** Nombre de la cinta para quien navega a ciegas: «Índice semántico». */
  label: string;
  children: ReactNode;
}) => {

  const prefix = useId();
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <TabsContext.Provider value={{ tabs, current, prefix, label, onChange }}>
      {children}
    </TabsContext.Provider>
  );
};

/**
 * Teclado completo —flechas, Home y End— y un solo punto de tabulación, que es
 * como el patrón ARIA lo define: llegar con Tab entra en la pestaña activa en
 * vez de recorrerlas una a una.
 */
export const TabStrip = ({ segmented }: {
  /** Botones sobre una barra, y no subrayados: la forma de la cabecera de la ficha. */
  segmented?: boolean;
}) => {

  const { tabs, current, prefix, label, onChange } = useTabs();

  const move = (event: ReactKeyboardEvent<HTMLDivElement>) => {

    const position = tabs.findIndex((tab) => tab.id === current.id);

    const next =
      event.key === 'ArrowRight' ? (position + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (position - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : -1;

    if (next < 0) return;

    event.preventDefault();
    onChange(tabs[next].id);
    // El foco acompaña a la selección: sin esto la flecha siguiente se calcula
    // desde una pestaña que ya no es la que se está mirando.
    document.getElementById(`${prefix}-tab-${tabs[next].id}`)?.focus();
  };

  return (
    <div
      className={`tabs${segmented ? ' tabs--segmented' : ''}`}
      role="tablist"
      aria-label={label}
      onKeyDown={move}
    >
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          id={`${prefix}-tab-${tab.id}`}
          className={`tab${tab.id === current.id ? ' tab--active' : ''}`}
          role="tab"
          aria-selected={tab.id === current.id}
          aria-controls={`${prefix}-panel-${tab.id}`}
          tabIndex={tab.id === current.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
        >{tab.icon}{tab.label}</button>
      ))}
    </div>
  );
};

export const TabPanel = () => {

  const { current, prefix } = useTabs();

  return (
    <div
      className="tabs__panel"
      id={`${prefix}-panel-${current.id}`}
      role="tabpanel"
      aria-labelledby={`${prefix}-tab-${current.id}`}
      tabIndex={0}
    >{current.panel}</div>
  );
};

/* ============================================================= pagination == */

/** Tamanos de pagina que se ofrecen. El primero es el de partida. */
export const PAGE_SIZES = [8, 12, 24];

const PreviousIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M14 6l-6 6 6 6" /></svg>
);

const NextIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M10 6l6 6-6 6" /></svg>
);

/**
 * Es la misma en documentos y en organizaciones: dos listados paginados en
 * servidor con los mismos parametros no tienen por que recorrerse distinto.
 *
 * Recibe el total y la pagina, no la lista: quien pagina es el servidor.
 */
export const Pagination = ({ total, page, pageSize, shown, busy, onPage, onPageSize }: {
  total: number;
  page: number;
  pageSize: number;
  /** Filas que han llegado en esta pagina, para el extremo del rango. */
  shown: number;
  busy?: boolean;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}) => {

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize;

  // Al estrechar el filtro la pagina actual puede quedar mas alla del final.
  useEffect(() => {
    if (page > pages) onPage(pages);
  }, [page, pages, onPage]);

  // Ventana de paginas: un listado de mil filas daria ciento veinticinco
  // botones y ninguno de los del medio sirve. Extremos y vecindad, con hueco.
  const numbers = useMemo(() => {
    const near = new Set([1, pages, page - 1, page, page + 1]);
    const visible = [...near].filter((number) => number >= 1 && number <= pages).sort((a, b) => a - b);

    return visible.flatMap((number, index) =>
      index && number - visible[index - 1] > 1 ? ['…', number] : [number]);
  }, [page, pages]);

  return (
    <div className="pagination">
      <span className="pagination__count">
        {total
          ? t('pagination.range', { from: from + 1, to: Math.min(from + shown, total), total })
          : t('pagination.empty')}
      </span>

      <div className="pagination__pages">
        <button
          type="button"
          className="btn btn--icon"
          aria-label={t('a11y.previousPage')}
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page === 1 || busy}
        ><PreviousIcon /></button>

        {numbers.map((number, index) => (
          typeof number === 'number' ? (
            <button
              type="button"
              className="btn"
              key={number}
              aria-label={t('a11y.page', { number })}
              aria-current={number === page ? 'page' : undefined}
              onClick={() => onPage(number)}
            >{number}</button>
          ) : (
            <span className="pagination__gap" key={`gap-${index}`} aria-hidden="true">…</span>
          )
        ))}

        <button
          type="button"
          className="btn btn--icon"
          aria-label={t('a11y.nextPage')}
          onClick={() => onPage(Math.min(pages, page + 1))}
          disabled={page >= pages || busy}
        ><NextIcon /></button>
      </div>

      <label className="pagination__per-page">
        {t('pagination.perPage')}
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
          {PAGE_SIZES.map((size) => (
            <option value={size} key={size}>{size}</option>
          ))}
        </select>
      </label>
    </div>
  );
};

/* =============================================================== messages == */

/**
 * Los codigos que la API usa de forma deliberada —423 cuarentena, 413 tamano,
 * 429 limite de intentos— merecen explicacion propia: «error 423» no le dice
 * nada a quien esta delante.
 */
export const errorMessage = (error: unknown): string => {
  if (!(error instanceof ApiError)) {
    return error instanceof Error && error.message
      ? error.message
      : t('common.serverUnreachable');
  }

  if (error.status === 429) {
    const minutes = error.retryAfter ? Math.ceil(error.retryAfter / 60) : null;
    return minutes
      ? t('common.tooManyAttemptsWait', { count: minutes, minutes })
      : t('common.tooManyAttempts');
  }

  if (error.status === 413) return t('common.tooLarge');
  if (error.status === 0) return t('common.serverUnreachable');

  return error.message;
};

export const Notice = ({ kind = 'info', title, icon, action, children }: {
  kind?: 'info' | 'error' | 'warn' | 'success';
  title?: string;
  /** Glifo del estado, a la izquierda del texto. */
  icon?: ReactNode;
  /** Lo que se puede hacer al respecto, debajo del cuerpo. */
  action?: ReactNode;
  children: ReactNode;
}) => (
  <div className={`notice notice--${kind}`} role={kind === 'error' ? 'alert' : undefined}>
    {icon ? <span className="notice__icon" aria-hidden="true">{icon}</span> : null}
    <div className="notice__text">
      {/* Bajo un titulo el cuerpo baja al gris del papel: el color lo llevan la
          palabra y el glifo, y un parrafo entero en ambar se lee peor. */}
      {title ? <><strong>{title}</strong><p className="notice__body">{children}</p></> : children}
      {action ? <div className="notice__action">{action}</div> : null}
    </div>
  </div>
);

export const ErrorNotice = ({ error }: { error: unknown }) =>
  error ? <Notice kind="error">{errorMessage(error)}</Notice> : null;

export const Loading = ({ text = t('common.loading') }: { text?: string }) => (
  <div className="loading"><span className="spinner" aria-hidden="true" /> {text}</div>
);

/** Una pantalla vacia es una invitacion a actuar, no un cartel de «no hay nada». */
export const Empty = ({ title, centered, children }: {
  title: string;
  centered?: boolean;
  children?: ReactNode;
}) => (
  <div className={`empty${centered ? ' empty--centered' : ''}`}>
    <h2>{title}</h2>
    {children ? <p>{children}</p> : null}
  </div>
);

/* ================================================================= dialog == */

export const Dialog = ({ title, ariaLabel, onClose, children, footer, bare }: {
  title?: string;
  /** Solo hace falta si `bare` no lleva `title` visible que sirva de aria-label. */
  ariaLabel?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Sin fondo, cabecera ni pie propios: para un hijo que ya es una tarjeta
      completa (como PasswordChange) y no debe quedar dentro de otra. */
  bare?: boolean;
}) => {

  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    box.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        className={`dialog${bare ? ' dialog--bare' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        tabIndex={-1}
        ref={box}
      >
        {bare ? children : (
          <>
            <div className="dialog__head">
              <h2>{title}</h2>
            </div>
            {children}
            {footer ? <div className="dialog__foot">{footer}</div> : null}
          </>
        )}
      </div>
    </div>
  );
};

/* =================================================================== data == */

export const formatDate = (value?: string | number | null, withTime = true, separator?: string) => {
  if (!value) return t('common.none');

  // El backend guarda TIMESTAMP WITHOUT TIME ZONE y lo serializa sin zona: se
  // interpreta como UTC, que es la zona en la que corre el servidor.
  const raw = typeof value === 'string' && !value.endsWith('Z') && !/[+-]\d\d:?\d\d$/.test(value)
    ? `${value}Z`
    : value;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(value);

  const text = date.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  });

  // es-ES separa fecha y hora con una coma que, en una columna de tabla, se lee
  // como parte del numero.
  return separator ? text.replace(', ', ` ${separator} `) : text;
};

export const formatSize = (bytes: number) => {
  if (!Number.isFinite(bytes)) return t('common.none');

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }

  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[unit]}`;
};

/**
 * Un dato de la ficha como tarjeta: rotulo con glifo arriba y valor debajo. Es
 * la unidad de la rejilla, y por eso lleva su propio nombre y no el de `Datum`,
 * que sigue siendo la fila de una lista de definiciones.
 */
export const Card = ({ term, icon, action, wide, children }: {
  term: string;
  icon?: ReactNode;
  /** Un boton pequeño en la esquina, como el de copiar la huella. */
  action?: ReactNode;
  /** Ocupa la fila entera: para un valor largo que no se debe partir. */
  wide?: boolean;
  children: ReactNode;
}) => (
  <div className={`card${wide ? ' card--wide' : ''}`}>
    <div className="card__head">
      <span className="card__term">
        {icon ? <span className="card__icon" aria-hidden="true">{icon}</span> : null}
        {term}
      </span>
      {action}
    </div>
    <div className="card__value">{children}</div>
  </div>
);

export const Datum = ({ term, children }: { term: string; children: ReactNode }) => (
  <div className="datum">
    <dt>{term}</dt>
    <dd>{children}</dd>
  </div>
);

/* =================================================================== tags == */

export const TagsField = ({ value, onChange, id }: {
  value: string[];
  onChange: (tags: string[]) => void;
  id?: string;
}) => {

  const add = (raw: string) => {
    const tag = raw.trim();
    // Duplicados fuera: el filtro por etiqueta los trataria como uno solo.
    if (tag && !value.includes(tag)) onChange([...value, tag]);
  };

  return (
    <div className="tags-field">
      {value.map((tag) => (
        <span className="tag" key={tag}>
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((item) => item !== tag))}
            aria-label={t('common.remove', { name: tag })}
          >✕</button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        placeholder={t('tags.placeholder')}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            add(event.currentTarget.value);
            event.currentTarget.value = '';
          } else if (event.key === 'Backspace' && !event.currentTarget.value && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={(event) => { add(event.currentTarget.value); event.currentTarget.value = ''; }}
      />
    </div>
  );
};
