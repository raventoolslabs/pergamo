import { useEffect, useState } from 'react';

import { api } from '../api/client';
import { useConfig } from '../api/config';
import type { GitHubEntry, GitHubRepository } from '../api/types';
import { t } from '../i18n';
import { GitHubExcludes, toPatterns } from './GitHubExcludes';
import { Dialog, ErrorNotice, Loading, Notice, errorMessage } from './ui';

const labelOf = (entry: GitHubEntry) => `${entry.owner}/${entry.repository}`;

/**
 * Dos listas y dos casillas: el repositorio y su rama. No hay navegador de
 * carpetas porque no se elige una parte del repositorio, sino todo su Markdown.
 */
export const GitHubRepositoryDialog = ({ onClose, onAdded }: {
  onClose: () => void;
  onAdded: (repository: GitHubRepository) => void;
}) => {

  const config = useConfig();

  const [entries, setEntries] = useState<GitHubEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [chosen, setChosen] = useState<string>('');
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branch, setBranch] = useState('');
  const [index, setIndex] = useState(false);
  const [storeContent, setStoreContent] = useState(false);
  const [excludes, setExcludes] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const entry = entries?.find((candidate) => labelOf(candidate) === chosen);

  useEffect(() => {
    let alive = true;

    api.githubBrowse()
      .then((value) => {
        if (!alive) return;
        setEntries(value);
        if (value.length) setChosen(labelOf(value[0]));
      })
      .catch((reason) => { if (alive) setError(reason); });

    return () => { alive = false; };
  }, []);

  // Las ramas se piden al elegir repositorio: pedirlas todas de antemano serian
  // tantas llamadas como repositorios alcance el token.
  useEffect(() => {
    if (!entry) return;

    let alive = true;
    setBranches(null);
    setBranch(entry.default_branch);

    api.githubBranches(entry.owner, entry.repository)
      .then((value) => { if (alive) setBranches(value); })
      .catch((reason) => { if (alive) setFailure(errorMessage(reason)); });

    return () => { alive = false; };
  }, [entry?.owner, entry?.repository]);

  const choose = async () => {
    if (!entry || !branch) return;

    setSaving(true);
    setFailure(null);

    try {
      onAdded(await api.addGitHubRepository({
        owner: entry.owner,
        repository: entry.repository,
        branch,
        index: index && config?.indexing_enabled === true,
        store_content: storeContent,
        excludes: toPatterns(excludes)
      }));
    } catch (reason) {
      setFailure(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={t('github.pickTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn--primary" onClick={choose} disabled={saving || !entry || !branch}>
            {saving ? <><span className="spinner" aria-hidden="true" /> {t('github.adding')}</> : t('github.choose')}
          </button>
        </>
      }
    >
      <div className="dialog__body">
        <ErrorNotice error={error} />

        {!entries && !error ? <Loading /> : null}

        {entries ? (
          entries.length ? (
            <>
              <div className="field">
                <label htmlFor="github-repository">{t('github.repository')}</label>
                <select
                  id="github-repository"
                  value={chosen}
                  disabled={saving}
                  onChange={(event) => setChosen(event.target.value)}
                >
                  {entries.map((candidate) => (
                    <option key={labelOf(candidate)} value={labelOf(candidate)}>{labelOf(candidate)}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="github-branch">{t('github.branch')}</label>
                <select
                  id="github-branch"
                  value={branch}
                  disabled={saving || !branches}
                  onChange={(event) => setBranch(event.target.value)}
                >
                  {branches
                    ? branches.map((name) => <option key={name} value={name}>{name}</option>)
                    : <option value={branch}>{t('github.loadingBranches')}</option>}
                </select>
              </div>
            </>
          ) : <p className="field__hint">{t('github.noRepositories')}</p>
        ) : null}

        {config?.indexing_enabled ? (
          <label className="check">
            <input type="checkbox" checked={index} disabled={saving} onChange={(event) => setIndex(event.target.checked)} />
            <span>
              <strong>{t('github.index')}</strong>
              {t('github.indexHint')}
            </span>
          </label>
        ) : null}

        <label className="check">
          <input
            type="checkbox"
            checked={storeContent}
            disabled={saving}
            onChange={(event) => setStoreContent(event.target.checked)}
          />
          <span>
            <strong>{t('github.storeContent')}</strong>
            {t('github.storeContentHint')}
          </span>
        </label>

        {entries?.length ? <GitHubExcludes value={excludes} disabled={saving} onChange={setExcludes} /> : null}

        {failure ? <Notice kind="error">{failure}</Notice> : null}
      </div>
    </Dialog>
  );
};
