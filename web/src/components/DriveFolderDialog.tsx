import { useEffect, useState } from 'react';

import { api } from '../api/client';
import { useConfig } from '../api/config';
import type { DriveEntry, DriveFolder } from '../api/types';
import { t } from '../i18n';
import { Dialog, ErrorNotice, Loading, Notice, errorMessage } from './ui';

/**
 * Navegador de carpetas: se baja nivel a nivel, porque pedir el arbol entero de
 * una unidad es justo lo que la API de Google no deja hacer deprisa.
 */
export const DriveFolderDialog = ({ onClose, onAdded }: {
  onClose: () => void;
  onAdded: (folder: DriveFolder) => void;
}) => {

  const config = useConfig();

  // La raiz no tiene id: la API entiende la ausencia como «Mi unidad».
  const [trail, setTrail] = useState<{ id?: string; name: string }[]>([{ name: t('drive.myDrive') }]);
  const [entries, setEntries] = useState<DriveEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [index, setIndex] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const current = trail[trail.length - 1];

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);

    api.driveBrowse(current.id)
      .then((value) => { if (alive) setEntries(value); })
      .catch((reason) => { if (alive) setError(reason); });

    return () => { alive = false; };
  }, [current.id]);

  const choose = async () => {
    setSaving(true);
    setFailure(null);

    try {
      onAdded(await api.addDriveFolder(current.id ?? 'root', index && config?.indexing_enabled === true));
    } catch (reason) {
      setFailure(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={t('drive.pickTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn--primary" onClick={choose} disabled={saving}>
            {saving ? <><span className="spinner" aria-hidden="true" /> {t('drive.adding')}</> : t('drive.choose')}
          </button>
        </>
      }
    >
      <div className="dialog__body">
        <nav className="drive-trail" aria-label={t('drive.pickTitle')}>
          {trail.map((step, position) => (
            position === trail.length - 1
              ? <strong key={step.id ?? 'root'} aria-current="location">{step.name}</strong>
              : (
                <button
                  type="button"
                  className="btn btn--flat btn--tiny"
                  key={step.id ?? 'root'}
                  onClick={() => setTrail(trail.slice(0, position + 1))}
                >{step.name}</button>
              )
          ))}
        </nav>

        <ErrorNotice error={error} />

        {!entries && !error ? <Loading /> : null}

        {entries ? (
          entries.length ? (
            <div className="queue">
              {entries.map((entry) => (
                <button
                  type="button"
                  className="queue__item drive-entry"
                  key={entry.id}
                  aria-label={t('drive.open', { name: entry.name })}
                  onClick={() => setTrail([...trail, entry])}
                >
                  <span className="queue__name">{entry.name}</span>
                  <span className="queue__status" aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          ) : <p className="field__hint">{t('drive.noSubfolders')}</p>
        ) : null}

        {config?.indexing_enabled ? (
          <label className="check">
            <input type="checkbox" checked={index} disabled={saving} onChange={(event) => setIndex(event.target.checked)} />
            <span>
              <strong>{t('drive.index')}</strong>
              {t('drive.indexHint')}
            </span>
          </label>
        ) : null}

        {failure ? <Notice kind="error">{failure}</Notice> : null}
      </div>
    </Dialog>
  );
};
