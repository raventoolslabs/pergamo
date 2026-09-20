import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { DriveConnection, DriveFolder, DriveSettings as Settings, DriveSyncState } from '../api/types';
import { DriveConnection as DriveConnectionSection } from '../components/DriveConnection';
import { DriveFolderDialog } from '../components/DriveFolderDialog';
import { SyncProgress } from '../components/SyncProgress';
import { useToast } from '../components/toast';
import { Dialog, Empty, ErrorNotice, Loading, Notice, errorMessage, formatDate } from '../components/ui';
import { t } from '../i18n';

const SyncIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" />
  </svg>
);

export const Drive = () => {

  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const [connection, setConnection] = useState<DriveConnection | null>(null);
  const [folders, setFolders] = useState<DriveFolder[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [removing, setRemoving] = useState<DriveFolder | null>(null);
  // Lo que devolvio pedir una sincronizacion, para que el progreso arranque sin esperar.
  const [started, setStarted] = useState<Record<string, DriveSyncState>>({});

  const load = useCallback(async () => {
    try {
      const [current, list, client] = await Promise.all([api.drive(), api.driveFolders(), api.driveSettings()]);
      setConnection(current);
      setFolders(list);
      setSettings(client);
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Vuelta de Google: el resultado llega en la URL y se cuenta una vez.
  useEffect(() => {
    if (params.get('connected')) toast(t('drive.connected'));
    if (params.get('error') === 'scope_missing') toast(t('drive.scopeMissing'), 'error');
    else if (params.get('error')) toast(t('drive.connectFailed', { reason: params.get('error') ?? '' }), 'error');
    if (params.has('connected') || params.has('error')) setParams({}, { replace: true });
  }, [params, setParams, toast]);

  const connect = async () => {
    setBusy('connect');
    try {
      window.location.assign((await api.driveConnect()).url);
    } catch (failure) {
      toast(errorMessage(failure), 'error');
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      await api.driveDisconnect();
      setDisconnecting(false);
      toast(t('drive.disconnected'));
      await load();
    } catch (failure) {
      toast(errorMessage(failure), 'error');
    } finally {
      setBusy(null);
    }
  };

  const sync = async (folder: DriveFolder) => {
    try {
      const state = await api.startDriveSync(folder.id);
      setStarted((current) => ({ ...current, [folder.id]: state }));
    } catch (failure) {
      toast(errorMessage(failure), 'error');
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy('remove');
    try {
      await api.removeDriveFolder(removing.id);
      setRemoving(null);
      toast(t('drive.removed'));
      await load();
    } catch (failure) {
      toast(errorMessage(failure), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!connection && !error) return <Loading />;

  const revoked = !!connection?.revoked_date;
  const connected = connection?.connected === true;

  return (
    <>
      <div className="pagehead">
        <div className="pagehead__text">
          <h1>{t('drive.title')}</h1>
        </div>
        <div className="pagehead__actions">
          {connected ? (
            <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>{t('drive.addFolder')}</button>
          ) : null}
        </div>
      </div>

      <ErrorNotice error={error} />

      {connection && !connected ? (
        <Notice
          wide
          kind={revoked ? 'warn' : 'info'}
          title={revoked ? t('drive.revokedTitle') : t('drive.notConnectedTitle')}
        >
          {revoked ? t('drive.revokedBody') : t('drive.notConnectedBody')}
        </Notice>
      ) : null}

      {folders && (folders.length || connected) ? (
        <section className="spaced">
          {folders.length ? (
            <ul className="versions">
              {folders.map((folder) => (
                <li className="version drive-folder" key={folder.id}>
                  <div className="version__text">
                    <div className="version__title">{folder.name}</div>
                    <div className="version__note">
                      {folder.sync_date ? t('sync.on', { date: formatDate(folder.sync_date) }) : t('sync.never')}
                      {folder.index_documents ? ` · ${t('sync.indexed')}` : ''}
                    </div>
                    {folder.sync_error ? (
                      <div className="version__note drive-folder__error" title={folder.sync_error}>
                        {t('sync.failed')}: {folder.sync_error}
                      </div>
                    ) : null}
                    <SyncProgress source={folder.id} load={api.driveSync} started={started[folder.id]} onSettled={load} />
                  </div>
                  <button type="button" className="btn btn--tiny" onClick={() => sync(folder)} disabled={!connected}>
                    <SyncIcon /> {t('sync.now')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--flat btn--tiny"
                    aria-label={t('drive.removeFolder', { name: folder.name })}
                    title={t('drive.removeFolder', { name: folder.name })}
                    onClick={() => setRemoving(folder)}
                  >✕</button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title={t('drive.emptyTitle')}>{t('drive.emptyBody')}</Empty>
          )}
        </section>
      ) : null}

      {settings ? (
        <DriveConnectionSection
          settings={settings}
          connection={connection}
          busy={busy}
          onConnect={connect}
          onDisconnect={() => setDisconnecting(true)}
        />
      ) : null}

      {adding ? (
        <DriveFolderDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            toast(t('drive.added'));
            void load();
          }}
        />
      ) : null}

      {disconnecting ? (
        <Dialog
          title={t('drive.disconnectTitle')}
          onClose={() => setDisconnecting(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDisconnecting(false)}>{t('common.cancel')}</button>
              <button type="button" className="btn btn--danger" onClick={disconnect} disabled={busy === 'disconnect'}>
                {t('drive.disconnect')}
              </button>
            </>
          }
        >
          <div className="dialog__body"><p>{t('drive.disconnectBody')}</p></div>
        </Dialog>
      ) : null}

      {removing ? (
        <Dialog
          title={t('drive.removeTitle')}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRemoving(null)}>{t('common.cancel')}</button>
              <button type="button" className="btn btn--danger" onClick={remove} disabled={busy === 'remove'}>
                {t('drive.removeTitle')}
              </button>
            </>
          }
        >
          <div className="dialog__body">
            <p>{t('drive.removeBodyBefore')}<strong>{removing.name}</strong>{t('drive.removeBodyAfter')}</p>
          </div>
        </Dialog>
      ) : null}
    </>
  );
};
