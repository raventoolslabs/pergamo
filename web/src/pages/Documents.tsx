import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import { useConfig } from '../api/config';
import type { DocumentList, DocumentQuery, SweepState } from '../api/types';
import { UploadDialog } from '../components/UploadDialog';
import { useToast } from '../components/toast';
import {
  Empty, ErrorNotice, Loading, Notice, PAGE_SIZES, Pagination, SortHeader, VERDICT, Verdict,
  errorMessage, formatDate, formatSize, isDeliverable, verdictOf
} from '../components/ui';
import { t } from '../i18n';

/**
 * Estados tal y como los ofrece el filtro.
 *
 * «En cuarentena» pide los dos que retienen un documento intacto —firma y
 * contenido activo— porque para quien busca son el mismo trabajo. «Error» va
 * aparte: ahi no hay nada que decidir, falta el fichero del almacen.
 *
 * «Disponible» pide lo que el servidor entrega y no dice «Analizado», que seria
 * mentira en los dos casos. «Analisis pendiente» se solapa a proposito con
 * «Disponible»: son dos preguntas distintas.
 */
const STATUS_FILTERS = [
  { value: '', text: t('documents.statusAll') },
  { value: 'clean,pending', text: t('documents.statusAvailable') },
  { value: 'pending', text: t('documents.statusPending') },
  { value: 'infected,malicious', text: t('documents.statusQuarantined') },
  { value: 'error', text: t('documents.statusError') }
];

/**
 * Columnas que ordenan, con el sentido de su primer clic: alfabetico en el
 * nombre, y lo que reclama atencion arriba en el estado y en la fecha.
 *
 * La etiqueta se queda fuera: es una lista, y ordenar por ella obligaria a
 * elegir uno de los tags por el documento.
 */
const SORTABLE = {
  document: { column: 'name', label: t('documents.columnDocument'), fallback: 'asc' },
  status: { column: 'scan_status', label: t('documents.columnStatus'), fallback: 'desc' },
  deposited: { column: 'creation_date', label: t('documents.columnDeposited'), fallback: 'desc' }
} as const;

/** Ritmo con que se pregunta por un barrido vivo, y su tope. */
const SWEEP_POLL_MS = 3000;
const SWEEP_POLL_LIMIT = 200;

const EMPTY_FILTERS: DocumentQuery = {
  name: '', tag: '', scan_status: '', from: '', to: '', sort: 'creation_date', order: 'desc'
};

/**
 * Cuenta el fondo en una frase. Una fila de tarjetas con metricas es el
 * tratamiento por defecto de cualquier panel; aqui el dato cabe en una linea.
 *
 * «Disponibles» y no «analizados»: el recuento sale de lo que se entrega, y
 * decir «analizados» daria por analizado un fondo depositado sin antivirus.
 */
const summary = (total: number, available: number) => {
  if (!total) return t('documents.summaryEmpty');
  return t('documents.summary', { count: total, total, available });
};

/**
 * Un <input type="datetime-local"> da hora local sin zona y creation_date se
 * guarda en UTC: sin convertir, el filtro se desplazaria tantas horas como
 * diferencia tenga el navegador con el servidor.
 */
const asInstant = (local: string) => {
  if (!local) return '';

  const date = new Date(local);

  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

const RescanIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" />
  </svg>
);

const UploadIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 19V5" /><path d="M6 11l6-6 6 6" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 19.5h14" />
  </svg>
);

export const Documents = () => {

  const toast = useToast();

  const [filters, setFilters] = useState<DocumentQuery>(EMPTY_FILTERS);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DocumentList | null>(null);
  const [holdings, setHoldings] = useState<{ total: number; available: number; pending: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [reload, setReload] = useState(0);
  const [sweep, setSweep] = useState<SweepState | null>(null);

  const config = useConfig();
  const sweepPolls = useRef(0);
  const watchedSweep = useRef(false);

  const offset = (page - 1) * pageSize;

  useEffect(() => {
    let alive = true;
    setLoading(true);

    // Espera antes de consultar mientras se escribe: sin esto, cada tecla
    // lanzaria una consulta con COUNT sobre la tabla de documentos.
    const timer = setTimeout(() => {
      api.documents({
        ...filters,
        from: asInstant(filters.from || ''),
        to: asInstant(filters.to || ''),
        limit: pageSize,
        offset
      })
        .then((result) => { if (alive) { setData(result); setError(null); } })
        .catch((failure) => { if (alive) setError(failure); })
        .finally(() => { if (alive) setLoading(false); });
    }, filters.name || filters.tag ? 300 : 0);

    return () => { alive = false; clearTimeout(timer); };
  }, [filters, offset, pageSize, reload]);

  // El subtitulo habla del fondo entero: ni de la pagina que se mira ni del
  // filtro puesto. Son dos recuentos sin traer una sola fila.
  useEffect(() => {
    let alive = true;

    Promise.all([
      api.documents({ limit: 1 }),
      // Lo que se entrega. Contar solo 'clean' daria un numero mas bajo que los
      // documentos que la pantalla deja descargar.
      api.documents({ scan_status: 'clean,pending', limit: 1 }),
      // Y lo que sigue sin veredicto, que es lo que un barrido puede resolver.
      api.documents({ scan_status: 'pending', limit: 1 })
    ])
      .then(([all, deliverable, pending]) => {
        if (alive) setHoldings({
          total: all.total, available: deliverable.total, pending: pending.total
        });
      })
      .catch(() => { if (alive) setHoldings(null); });

    return () => { alive = false; };
  }, [reload]);

  const update = (change: Partial<DocumentQuery>) => {
    // Cualquier cambio de filtro vuelve a la primera pagina: mantener el
    // desplazamiento dejaria la lista vacia sin motivo aparente.
    setPage(1);
    setFilters((current) => ({ ...current, ...change }));
  };

  const sortBy = (sort: NonNullable<DocumentQuery['sort']>, order: 'asc' | 'desc') => update({ sort, order });

  const refresh = useCallback(() => setReload((value) => value + 1), []);

  // Un barrido en marcha sobrevive a recargar la pagina, asi que se pregunta al
  // entrar y no solo despues de lanzarlo.
  useEffect(() => {
    if (!config?.enable_antivirus) return;

    let alive = true;
    api.sweep().then((state) => { if (alive) setSweep(state); }).catch(() => {});

    return () => { alive = false; };
  }, [config]);

  // Mientras el trabajo vive. Con tope, como en la ficha: una pestana abierta no
  // debe preguntar para siempre si el worker se quedo por el camino.
  useEffect(() => {
    const status = sweep?.status;

    if (status !== 'queued' && status !== 'running') return;
    if (sweepPolls.current >= SWEEP_POLL_LIMIT) return;

    const timer = setTimeout(() => {
      sweepPolls.current += 1;
      api.sweep()
        .then((state) => {
          setSweep(state);
          // Al terminar, el listado y los recuentos ya no dicen la verdad.
          if (state.status !== 'queued' && state.status !== 'running') refresh();
        })
        .catch(() => {});
    }, SWEEP_POLL_MS);

    return () => clearTimeout(timer);
  }, [sweep, refresh]);

  const startSweep = async () => {
    try {
      sweepPolls.current = 0;
      watchedSweep.current = true;
      setSweep(await api.startSweep());
    } catch (failure) {
      toast(errorMessage(failure), 'error');
    }
  };

  const download = async (id: string, filename: string) => {
    try {
      await api.download(id, filename);
    } catch (failure) {
      toast(errorMessage(failure), 'error');
    }
  };

  const total = data?.total ?? 0;
  const documents = data?.documents ?? [];
  const filtered = !!(filters.name || filters.tag || filters.scan_status || filters.from || filters.to);

  const sweeping = sweep?.status === 'queued' || sweep?.status === 'running';
  // Solo donde hay algo que barrer y con que barrerlo. El recuento lo da el
  // propio barrido, que no cuenta lo que el analizador no puede leer: ofrecer
  // analizar eso seria ofrecer no hacer nada. Mientras corre se sigue enseñando,
  // deshabilitado, para que no parezca que se ha ido.
  const showSweep = config?.enable_antivirus === true && (sweeping || !!sweep?.pending);

  // El resultado se cuenta una vez, a quien estaba mirando. Al volver a entrar,
  // un barrido que termino hace rato ya no es novedad: lo que dejo hecho lo dice
  // el listado.
  const showSweepNotice = !!sweep && sweep.status !== 'idle'
    && (sweeping || watchedSweep.current);
  // Sin documentos y sin filtro puesto no hay nada que filtrar: los campos solo
  // entorpecen el camino al primer deposito.
  const showFilters = filtered || documents.length > 0;

  return (
    <>
      <div className="pagehead">
        <div className="pagehead__text">
          <h1>{t('documents.title')}</h1>
          <p>{holdings ? summary(holdings.total, holdings.available) : t('documents.counting')}</p>
        </div>
        <div className="pagehead__actions">
          {showSweep ? (
            <button type="button" className="btn" onClick={startSweep} disabled={sweeping}>
              {sweeping
                ? <><span className="spinner" aria-hidden="true" /> {t('documents.sweeping')}</>
                : <><RescanIcon /> {t('documents.sweep', { count: sweep?.pending ?? 0 })}</>}
            </button>
          ) : null}
          <button type="button" className="btn btn--primary" onClick={() => setUploading(true)}>
            <UploadIcon />
            {t('documents.upload')}
          </button>
        </div>
      </div>

      <ErrorNotice error={error} />

      {showSweepNotice && sweep ? (
        <div className="spaced">
          <Notice
            wide
            kind={sweep.status === 'failed' ? 'error' : sweep.status === 'done' ? 'success' : 'info'}
            title={t(sweeping ? 'documents.sweepRunning' : sweep.status === 'failed'
              ? 'documents.sweepFailed' : 'documents.sweepDone')}
          >
            {sweep.status === 'failed'
              ? t('documents.sweepStopped')
              // Antes del primer documento no hay nada que contar, y «0 de 0»
              // se lee como que no habia nada que analizar.
              : !sweep.progress
                ? t('documents.sweepStarting')
                : t('documents.sweepCount', {
                    count: sweep.progress.scanned,
                    scanned: sweep.progress.scanned,
                    total: sweep.progress.total
                  })}
          </Notice>
        </div>
      ) : null}

      {showFilters ? (
      <div className="filters">
        <div className="field">
          <label htmlFor="filter-name">{t('documents.filterName')}</label>
          <input
            id="filter-name"
            type="search"
            placeholder={t('documents.filterNamePlaceholder')}
            value={filters.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="filter-tag">{t('documents.filterTag')}</label>
          <input
            id="filter-tag"
            type="search"
            placeholder={t('documents.filterTagPlaceholder')}
            value={filters.tag}
            onChange={(event) => update({ tag: event.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="filter-status">{t('documents.filterStatus')}</label>
          <select
            id="filter-status"
            value={filters.scan_status}
            onChange={(event) => update({ scan_status: event.target.value })}
          >
            {STATUS_FILTERS.map((status) => (
              <option value={status.value} key={status.text}>{status.text}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="filter-from">{t('documents.filterFrom')}</label>
          <input
            id="filter-from"
            type="datetime-local"
            value={filters.from}
            onChange={(event) => update({ from: event.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="filter-to">{t('documents.filterTo')}</label>
          <input
            id="filter-to"
            type="datetime-local"
            value={filters.to}
            onChange={(event) => update({ to: event.target.value })}
          />
        </div>
      </div>
      ) : null}

      {loading && !data ? <Loading text={t('documents.counting')} /> : null}

      {!loading && !documents.length && !filtered ? (
        <Empty title={t('documents.emptyTitle')}>{t('documents.emptyBody')}</Empty>
      ) : null}

      {documents.length || filtered ? (
        <>
          <div className="results">
            <span className="results__count">
              {filtered
                ? t('documents.matches', { count: total, total })
                : t('documents.count', { count: total, total })}
            </span>
            {filtered ? (
              <button
                type="button"
                className="btn btn--pill"
                onClick={() => {
                  setPage(1);
                  // El orden no es un filtro: quien lo eligio no ha pedido deshacerlo.
                  setFilters({ ...EMPTY_FILTERS, sort: filters.sort, order: filters.order });
                }}
              >{t('common.clearFilters')}</button>
            ) : null}
          </div>

          <div className="ledger">
            <div className="ledger__header">
              <SortHeader {...SORTABLE.document} sort={filters.sort} order={filters.order} onSort={sortBy} />
              <span>{t('documents.columnTag')}</span>
              <SortHeader {...SORTABLE.status} sort={filters.sort} order={filters.order} onSort={sortBy} />
              <SortHeader {...SORTABLE.deposited} sort={filters.sort} order={filters.order} onSort={sortBy} />
              <span />
            </div>

            {documents.map((document) => {
              const { metadata } = document;
              const filename = `${metadata.name}.${metadata.extension}`;
              const downloadable = isDeliverable(document.scan_status);

              return (
                <div className="record" key={document.id}>
                  <div className="record__title">
                    <Link to={`/documents/${document.id}`}>{metadata.name}</Link>
                    <div className="record__foot">
                      <span>{metadata.extension}</span>
                      <span>{metadata.hash?.slice(0, 8)}</span>
                      {/* Los documentos anteriores a que se guardara el tamano
                          no lo tienen: mejor sin el dato que con un cero. */}
                      {typeof metadata.size === 'number' ? <span>{formatSize(metadata.size)}</span> : null}
                    </div>
                  </div>

                  <div className="tags">
                    {(metadata.tags || []).map((tag) => (
                      <span className="tag" key={tag}>{tag}</span>
                    ))}
                  </div>

                  <Verdict status={document.scan_status} engine={document.scan_engine} />

                  <span className="record__date">
                    {formatDate(document.creation_date, true, '·')}
                  </span>

                  <span className="record__action">
                    {/* Lo retenido no se descarga: el backend responde 423. El
                        boton se queda, deshabilitado y con el motivo, porque
                        quitarlo dejaba la columna vacia sin decir por que. */}
                    <button
                      type="button"
                      className="btn btn--icon"
                      aria-label={t('documents.downloadNamed', { name: metadata.name })}
                      title={downloadable
                        ? t('documents.download')
                        : VERDICT[verdictOf(document.scan_status, document.scan_engine)]?.detail}
                      disabled={!downloadable}
                      onClick={() => download(document.id, filename)}
                    >
                      <DownloadIcon />
                    </button>
                  </span>
                </div>
              );
            })}

            {!loading && !documents.length ? (
              <Empty title={t('documents.noMatchTitle')} centered>
                {t('documents.noMatchBody')}
              </Empty>
            ) : null}
          </div>

          <Pagination
            total={total}
            shown={documents.length}
            page={page}
            pageSize={pageSize}
            busy={loading}
            onPage={setPage}
            onPageSize={(size) => { setPage(1); setPageSize(size); }}
          />
        </>
      ) : null}

      {uploading ? (
        <UploadDialog
          onClose={() => setUploading(false)}
          onUploaded={({ uploaded }) => {
            setPage(1);
            refresh();
            // Lo retenido tambien cambia la lista, pero no se anuncia como
            // subido: su veredicto lo cuenta el dialogo, que sigue abierto.
            if(uploaded) toast(t('documents.uploaded'));
          }}
        />
      ) : null}
    </>
  );
};
