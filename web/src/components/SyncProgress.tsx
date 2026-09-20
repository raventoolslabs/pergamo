import { useEffect, useRef, useState } from 'react';

import type { DriveSyncState } from '../api/types';
import { t } from '../i18n';

/** El mismo ritmo y tope que el barrido de documentos. */
const POLL_MS = 3000;
const POLL_LIMIT = 200;

const live = (state: DriveSyncState | null) => state?.status === 'queued' || state?.status === 'running';

/**
 * Estado de la sincronizacion de una carpeta de Drive o de un repositorio de
 * GitHub. Pregunta al montarse —una sincronizacion sobrevive a recargar— y sigue
 * preguntando mientras vive. `started` es el estado que devolvio pedirla, para
 * no esperar al primer sondeo.
 */
export const SyncProgress = ({ source, load, started, onSettled }: {
  source: string;
  /** Quien sabe preguntar por ese origen: api.driveSync o api.githubSync. */
  load: (id: string) => Promise<DriveSyncState>;
  started?: DriveSyncState | null;
  /** Al terminar: la fecha y el error del origen ya no dicen la verdad. */
  onSettled: () => void;
}) => {

  const [state, setState] = useState<DriveSyncState | null>(null);
  const polls = useRef(0);
  const watched = useRef(false);

  useEffect(() => {
    let alive = true;
    load(source).then((value) => { if (alive) setState(value); }).catch(() => {});
    return () => { alive = false; };
  }, [source, load]);

  useEffect(() => {
    if (!started) return;
    polls.current = 0;
    watched.current = true;
    setState(started);
  }, [started]);

  useEffect(() => {
    if (!live(state) || polls.current >= POLL_LIMIT) return;

    watched.current = true;

    const timer = setTimeout(() => {
      polls.current += 1;
      load(source)
        .then((next) => {
          setState(next);
          if (!live(next)) onSettled();
        })
        .catch(() => {});
    }, POLL_MS);

    return () => clearTimeout(timer);
  }, [state, source, load, onSettled]);

  if (live(state)) {
    return (
      <span className="drive-sync">
        <span className="spinner" aria-hidden="true" />
        {state?.progress
          ? t('sync.progress', { count: state.progress.seen })
          : state?.status === 'queued' ? t('sync.queued') : t('sync.running')}
      </span>
    );
  }

  // El resumen solo a quien lo vio correr: al volver otro dia ya no es noticia.
  if (state?.status === 'done' && state.progress && watched.current) {
    return <span className="drive-sync">{t('sync.done', { ...state.progress })}</span>;
  }

  return null;
};
