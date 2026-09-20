import { useState } from 'react';

import { api } from '../api/client';
import type { GitHubRepository } from '../api/types';
import { t } from '../i18n';
import { GitHubExcludes, toPatterns } from './GitHubExcludes';
import { Dialog, Notice, errorMessage } from './ui';

/**
 * Cambiar las exclusiones de un repositorio ya dado de alta. Pergamo encola la
 * pasada que las aplica, asi que aqui no hay que pedir nada mas.
 */
export const GitHubExcludesDialog = ({ repository, onClose, onSaved }: {
  repository: GitHubRepository;
  onClose: () => void;
  onSaved: () => void;
}) => {

  const [value, setValue] = useState(repository.excludes.join('\n'));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = async () => {

    setSaving(true);
    setFailure(null);

    try {
      await api.updateGitHubExcludes(repository.id, toPatterns(value));
      onSaved();
    } catch (reason) {
      setFailure(errorMessage(reason));
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={t('github.excludesTitle', { name: `${repository.name} · ${repository.branch}` })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={saving}>
            {saving ? <><span className="spinner" aria-hidden="true" /> {t('github.saving')}</> : t('github.save')}
          </button>
        </>
      }
    >
      <div className="dialog__body">
        <GitHubExcludes value={value} disabled={saving} onChange={setValue} />

        {failure ? <Notice kind="error">{failure}</Notice> : null}
      </div>
    </Dialog>
  );
};
