import { useState } from 'react';

import { api } from '../api/client';
import type { GitHubSettings } from '../api/types';
import { t } from '../i18n';
import { PasswordField } from './PasswordChange';
import { Datum, Dialog, Notice, errorMessage, formatDate } from './ui';

/**
 * Las credenciales de GitHub son un token y una URL, sin vuelta de un tercero
 * que autorizar: por eso esto es un formulario y no un boton de conectar.
 */
export const GitHubToken = ({ settings, onSaved }: {
  settings: GitHubSettings;
  onSaved: () => void;
}) => {

  const [editing, setEditing] = useState(!settings.configured);
  const [token, setToken] = useState('');
  const [apiUrl, setApiUrl] = useState(settings.api_url ?? '');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = async () => {

    if (!token.trim()) {
      setFailure(t('github.tokenRequired'));
      return;
    }

    setSaving(true);
    setFailure(null);

    try {
      await api.saveGitHubSettings({ api_url: apiUrl.trim() || null, token: token.trim() });
      setToken('');
      setEditing(false);
      onSaved();
    } catch (reason) {
      setFailure(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const forget = async () => {
    setSaving(true);
    try {
      await api.removeGitHubSettings();
      setForgetting(false);
      setEditing(true);
      onSaved();
    } catch (reason) {
      setFailure(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="section">
      <h2>{t('github.credentials')}</h2>

      {settings.configured && !editing ? (
        <>
          <dl className="data">
            <Datum term={t('github.apiUrl')}>{settings.api_url ?? 'github.com'}</Datum>
            <Datum term={t('github.configuredOn')}>{formatDate(settings.modification_date, false)}</Datum>
          </dl>
          <div className="spaced">
            <button type="button" className="btn" onClick={() => setEditing(true)}>{t('github.edit')}</button>
            <button type="button" className="btn btn--flat" onClick={() => setForgetting(true)}>{t('github.forget')}</button>
          </div>
        </>
      ) : (
        <>
          <p className="section__note">{t('github.tokenNote')}</p>

          <PasswordField
            id="github-token"
            label={t('github.token')}
            placeholder={t('github.tokenPlaceholder')}
            value={token}
            onChange={setToken}
            visible={visible}
            onToggle={() => setVisible((current) => !current)}
            maxLength={512}
            autoComplete="off"
          />

          <div className="field">
            <label htmlFor="github-api-url">{t('github.apiUrl')}</label>
            <input
              id="github-api-url"
              className="mono"
              type="url"
              maxLength={256}
              autoComplete="off"
              placeholder={t('github.apiUrlPlaceholder')}
              value={apiUrl}
              onChange={(event) => setApiUrl(event.target.value)}
            />
            <p className="field__hint">{t('github.apiUrlHint')}</p>
          </div>

          <div className="spaced">
            <button type="button" className="btn btn--primary" onClick={save} disabled={saving}>
              {saving ? <><span className="spinner" aria-hidden="true" /> {t('github.saving')}</> : t('github.save')}
            </button>
            {settings.configured ? (
              <button type="button" className="btn" onClick={() => { setEditing(false); setFailure(null); }}>
                {t('common.cancel')}
              </button>
            ) : null}
          </div>

          {failure ? <Notice kind="error">{failure}</Notice> : null}
        </>
      )}

      {forgetting ? (
        <Dialog
          title={t('github.forgetTitle')}
          onClose={() => setForgetting(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setForgetting(false)}>{t('common.cancel')}</button>
              <button type="button" className="btn btn--danger" onClick={forget} disabled={saving}>
                {t('github.forget')}
              </button>
            </>
          }
        >
          <div className="dialog__body"><p>{t('github.forgetBody')}</p></div>
        </Dialog>
      ) : null}
    </section>
  );
};
