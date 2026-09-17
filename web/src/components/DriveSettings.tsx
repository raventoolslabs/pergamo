import { useState } from 'react';
import type { FormEvent } from 'react';

import { api } from '../api/client';
import type { DriveConnection, DriveSettings as Settings } from '../api/types';
import { t } from '../i18n';
import { PasswordField } from './PasswordChange';
import { useToast } from './toast';
import { Datum, Dialog, Notice, errorMessage, formatDate } from './ui';

/**
 * El cliente OAuth de la organizacion y, pegada a el, la conexion: sin cliente
 * no hay a quien pedirle permiso, asi que registrar y conectar viven juntos.
 *
 * De los tres estados que admite la API para el secreto solo se ofrecen dos.
 * Quitarlo dejando el client_id da una organizacion que no puede conectar y no
 * lo parece; para eso esta quitar el cliente entero.
 */
export const DriveSettings = ({ settings, connection, busy, onConnect, onDisconnect, onChanged }: {
  settings: Settings;
  connection: DriveConnection | null;
  /** El de la pagina: el boton de conectar comparte su hilo. */
  busy: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onChanged: () => Promise<void>;
}) => {

  const toast = useToast();

  // Sin secreto guardado no hay nada que leer: se entra escribiendo.
  const [editing, setEditing] = useState(!settings.configured);
  const [clientId, setClientId] = useState(settings.client_id ?? '');
  const [secret, setSecret] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const connected = connection?.connected === true;

  const save = async (event: FormEvent) => {

    event.preventDefault();

    const id = clientId.trim();

    // El 400 del servidor llega en ingles y habla del cuerpo de la peticion:
    // mas vale no provocarlo.
    if (!id || (!settings.configured && !secret)) {
      setFailure(t('drive.clientRequired'));
      return;
    }

    setSaving(true);
    setFailure(null);

    try {
      // Omitir la clave mantiene el secreto guardado; mandarla lo rota.
      await api.saveDriveSettings({ client_id: id, ...(secret ? { client_secret: secret } : {}) });
      setSecret('');
      setEditing(false);
      toast(t('drive.clientSaved'));
      await onChanged();
    } catch (reason) {
      setFailure(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {

    setSaving(true);

    try {
      await api.removeDriveSettings();
      setRemoving(false);
      setClientId('');
      setSecret('');
      setEditing(true);
      toast(t('drive.clientRemoved'));
      await onChanged();
    } catch (reason) {
      setRemoving(false);
      toast(errorMessage(reason), 'error');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setEditing(false);
    setSecret('');
    setFailure(null);
    setClientId(settings.client_id ?? '');
  };

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(settings.redirect_uri ?? '');
      toast(t('drive.redirectCopied'));
    } catch {
      toast(t('common.copyFailed'), 'error');
    }
  };

  return (
    <section className="section">
      <h2>{t('drive.client')}</h2>
      <p className="section__note">{t('drive.clientNote')}</p>

      {editing ? (
        <form className="form" onSubmit={save}>
          <div className="field">
            <label htmlFor="drive-client-id">{t('drive.clientId')}</label>
            <input
              id="drive-client-id"
              className="mono"
              type="text"
              maxLength={256}
              autoComplete="off"
              placeholder={t('drive.clientIdPlaceholder')}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            />
          </div>

          {/* Que en blanco se mantiene el guardado se dice en el marcador: solo
              hace falta saberlo mientras el campo esta vacio. */}
          <PasswordField
            id="drive-client-secret"
            label={t('drive.clientSecret')}
            placeholder={settings.configured ? t('drive.clientSecretKeep') : t('drive.clientSecretPlaceholder')}
            value={secret}
            onChange={setSecret}
            visible={visible}
            onToggle={() => setVisible((current) => !current)}
            maxLength={512}
            autoComplete="off"
          />

          {failure ? <Notice kind="error">{failure}</Notice> : null}

          <div className="drive-actions">
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving
                ? <><span className="spinner" aria-hidden="true" /> {t('common.saving')}</>
                : settings.configured ? t('common.save') : t('drive.register')}
            </button>
            {settings.configured ? (
              <button type="button" className="btn" onClick={cancel}>{t('common.cancel')}</button>
            ) : null}
          </div>
        </form>
      ) : (
        <>
          <dl className="data">
            <Datum term={t('drive.clientId')}>
              <span className="mono">{settings.client_id ?? t('common.none')}</span>
            </Datum>
            <Datum term={t('drive.clientSince')}>{formatDate(settings.creation_date, false)}</Datum>
            <Datum term={t('drive.connection')}>
              {connected
                ? `${t('drive.connectedAs', { account: connection?.google_account ?? '' })} · ${t('drive.connectedSince', { date: formatDate(connection?.creation_date, false) })}`
                : t('drive.notConnectedTitle')}
            </Datum>
          </dl>

          <div className="drive-actions spaced">
            {connected ? (
              <button type="button" className="btn" onClick={onDisconnect}>{t('drive.disconnect')}</button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={onConnect} disabled={busy === 'connect'}>
                {busy === 'connect'
                  ? <><span className="spinner" aria-hidden="true" /> {t('drive.connecting')}</>
                  : connection?.revoked_date ? t('drive.reconnect') : t('drive.connect')}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setEditing(true)}>{t('drive.change')}</button>
            <button type="button" className="btn btn--flat" onClick={() => setRemoving(true)}>{t('drive.removeClient')}</button>
          </div>
        </>
      )}

      {/* Dato del despliegue y no de la organizacion, pero es lo que hay que
          pegar en Google Cloud para que la vuelta de Google encaje. */}
      <div className="field drive-client spaced">
        <label htmlFor="drive-redirect">{t('drive.redirectUri')}</label>
        <div className="drive-actions">
          <input id="drive-redirect" className="mono" type="text" readOnly value={settings.redirect_uri ?? ''} />
          <button type="button" className="btn btn--tiny" onClick={copyRedirect}>{t('drive.copyRedirect')}</button>
        </div>
        <span className="field__hint">{t('drive.redirectHint')}</span>
      </div>

      {removing ? (
        <Dialog
          title={t('drive.removeClientTitle')}
          onClose={() => setRemoving(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRemoving(false)}>{t('common.cancel')}</button>
              <button type="button" className="btn btn--danger" onClick={remove} disabled={saving}>
                {t('drive.removeClient')}
              </button>
            </>
          }
        >
          <div className="dialog__body"><p>{t('drive.removeClientBody')}</p></div>
        </Dialog>
      ) : null}
    </section>
  );
};
