import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import type { DriveSyncState, GitHubRepository, GitHubSettings } from '../api/types';
import { GitHubExcludesDialog } from '../components/GitHubExcludesDialog';
import { GitHubRepositoryDialog } from '../components/GitHubRepositoryDialog';
import { GitHubToken } from '../components/GitHubToken';
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

export const GitHub = () => {

  const toast = useToast();

  const [settings, setSettings] = useState<GitHubSettings | null>(null);
  const [repositories, setRepositories] = useState<GitHubRepository[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<GitHubRepository | null>(null);
  const [excluding, setExcluding] = useState<GitHubRepository | null>(null);
  // Lo que devolvio pedir una sincronizacion, para que el progreso arranque sin esperar.
  const [started, setStarted] = useState<Record<string, DriveSyncState>>({});

  const load = useCallback(async () => {
    try {
      const [token, list] = await Promise.all([api.githubSettings(), api.githubRepositories()]);
      setSettings(token);
      setRepositories(list);
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sync = async (repository: GitHubRepository) => {
    try {
      const state = await api.startGitHubSync(repository.id);
      setStarted((current) => ({ ...current, [repository.id]: state }));
    } catch (failure) {
      toast(errorMessage(failure), 'error');
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy('remove');
    try {
      await api.removeGitHubRepository(removing.id);
      setRemoving(null);
      toast(t('github.removed'));
      await load();
    } catch (failure) {
      toast(errorMessage(failure), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!settings && !error) return <Loading />;

  const configured = settings?.configured === true;

  return (
    <>
      <div className="pagehead">
        <div className="pagehead__text">
          <h1>{t('github.title')}</h1>
        </div>
        <div className="pagehead__actions">
          {configured ? (
            <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
              {t('github.addRepository')}
            </button>
          ) : null}
        </div>
      </div>

      <ErrorNotice error={error} />

      {settings && !configured ? (
        <Notice wide kind="info" title={t('github.notConfiguredTitle')}>{t('github.notConfiguredBody')}</Notice>
      ) : null}

      {repositories && (repositories.length || configured) ? (
        <section className="spaced">
          {repositories.length ? (
            <ul className="versions">
              {repositories.map((repository) => (
                <li className="version drive-folder" key={repository.id}>
                  <div className="version__text">
                    <div className="version__title">{repository.name} · {repository.branch}</div>
                    <div className="version__note">
                      {repository.sync_date ? t('sync.on', { date: formatDate(repository.sync_date) }) : t('sync.never')}
                      {repository.index_documents ? ` · ${t('sync.indexed')}` : ''}
                      {repository.store_content ? ` · ${t('github.storedCopy')}` : ''}
                      {repository.excludes.length ? ` · ${t('github.excluded', { count: repository.excludes.length })}` : ''}
                      {repository.last_commit ? ` · ${t('github.lastCommit', { commit: repository.last_commit.slice(0, 7) })}` : ''}
                    </div>
                    {repository.sync_error ? (
                      <div className="version__note drive-folder__error" title={repository.sync_error}>
                        {t('sync.failed')}: {repository.sync_error}
                      </div>
                    ) : null}
                    <SyncProgress
                      source={repository.id}
                      load={api.githubSync}
                      started={started[repository.id]}
                      onSettled={load}
                    />
                  </div>
                  <button type="button" className="btn btn--tiny" onClick={() => setExcluding(repository)}>
                    {t('github.excludesEdit')}
                  </button>
                  <button type="button" className="btn btn--tiny" onClick={() => sync(repository)} disabled={!configured}>
                    <SyncIcon /> {t('sync.now')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--flat btn--tiny"
                    aria-label={t('github.removeRepository', { name: repository.name })}
                    title={t('github.removeRepository', { name: repository.name })}
                    onClick={() => setRemoving(repository)}
                  >✕</button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title={t('github.emptyTitle')}>{t('github.emptyBody')}</Empty>
          )}
        </section>
      ) : null}

      {settings ? <GitHubToken settings={settings} onSaved={load} /> : null}

      {adding ? (
        <GitHubRepositoryDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            toast(t('github.added'));
            void load();
          }}
        />
      ) : null}

      {excluding ? (
        <GitHubExcludesDialog
          repository={excluding}
          onClose={() => setExcluding(null)}
          onSaved={() => {
            setStarted((current) => ({ ...current, [excluding.id]: { status: 'queued', progress: null, error: null } }));
            setExcluding(null);
            toast(t('github.excludesSaved'));
            void load();
          }}
        />
      ) : null}

      {removing ? (
        <Dialog
          title={t('github.removeTitle')}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRemoving(null)}>{t('common.cancel')}</button>
              <button type="button" className="btn btn--danger" onClick={remove} disabled={busy === 'remove'}>
                {t('github.removeTitle')}
              </button>
            </>
          }
        >
          <div className="dialog__body">
            <p>
              {t('github.removeBodyBefore')}
              <strong>{removing.name} · {removing.branch}</strong>
              {t('github.removeBodyAfter')}
            </p>
          </div>
        </Dialog>
      ) : null}
    </>
  );
};
