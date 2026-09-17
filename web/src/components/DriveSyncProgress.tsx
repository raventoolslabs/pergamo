import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { DriveSyncState } from '../api/types';
import { t } from '../i18n';

/** El mismo ritmo y tope que el barrido de documentos. */
const POLL_MS = 3000;
const POLL_LIMIT = 200;

const live = (state: DriveSyncState | null) => state?.status === 'queued' || state?.status === 'running';

/**
 * Estado de la sincronizacion de una carpeta. Pregunta al montarse —una
 * sincronizacion sobrevive a recargar— y sigue preguntando mientras vive.
 * `started` es el estado que devolvio pedirla, para no esperar al primer sondeo.
 */
export const DriveSyncProgress = ({ folder, started, onSettled }: {
  folder: string;
  started?: DriveSyncState | null;
  /** Al terminar: la fecha y el error de la carpeta ya no dicen la verdad. */
  onSettled: () => void;
}) => {

  const [state, setState] = useState<DriveSyncState | null>(null);
  const polls = useRef(0);
  const watched = useRef(false);

  useEffect(() => {
    let alive = true;
    api.driveSync(folder).then((value) => { if (alive) setState(value); }).catch(() => {});
    return () => { alive = false; };
  }, [folder]);

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
      api.driveSync(folder)
        .then((next) => {
          setState(next);
          if (!live(next)) onSettled();
        })
        .catch(() => {});
    }, POLL_MS);

    return () => clearTimeout(timer);
  }, [state, folder, onSettled]);

  if (live(state)) {
    return (
      <span className="drive-sync">
        <span className="spinner" aria-hidden="true" />
        {state?.progress
          ? t('drive.syncProgress', { count: state.progress.seen })
          : state?.status === 'queued' ? t('drive.syncQueued') : t('drive.syncing')}
      </span>
    );
  }

  // El resumen solo a quien lo vio correr: al volver otro dia ya no es noticia.
  if (state?.status === 'done' && state.progress && watched.current) {
    return <span className="drive-sync">{t('drive.syncDone', { ...state.progress })}</span>;
  }

  return null;
};
