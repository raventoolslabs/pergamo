import { useState } from 'react';

import { api } from '../api/client';
import { t } from '../i18n';
import { PasswordField } from './PasswordChange';
import { Dialog, Notice, errorMessage } from './ui';

/**
 * Primer paso de la conexion: el cliente OAuth de la organizacion. Se guarda y
 * se sale hacia Google en el mismo gesto, porque por separado no sirven de nada.
 *
 * Solo aparece cuando no hay cliente guardado: con uno, conectar va derecho a
 * Google sin volver a pedir un secreto que ya esta guardado.
 */
export const DriveConnectDialog = ({ onClose }: { onClose: () => void }) => {

  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const next = async () => {

    const id = clientId.trim();

    // El 400 del servidor llega en ingles y habla del cuerpo de la peticion:
    // mas vale no provocarlo.
    if (!id || !secret) {
      setFailure(t('drive.clientRequired'));
      return;
    }

    setSending(true);
    setFailure(null);

    try {
      await api.saveDriveSettings({ client_id: id, client_secret: secret });
      // Se sale de la aplicacion: no hay nada que restaurar despues.
      window.location.assign((await api.driveConnect()).url);
    } catch (reason) {
      setFailure(errorMessage(reason));
      setSending(false);
    }
  };

  return (
    <Dialog
      title={t('drive.connect')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn--primary" onClick={next} disabled={sending}>
            {sending
              ? <><span className="spinner" aria-hidden="true" /> {t('drive.connecting')}</>
              : t('drive.next')}
          </button>
        </>
      }
    >
      <div className="dialog__body">
        <p className="section__note">{t('drive.clientNote')}</p>

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

        <PasswordField
          id="drive-client-secret"
          label={t('drive.clientSecret')}
          placeholder={t('drive.clientSecretPlaceholder')}
          value={secret}
          onChange={setSecret}
          visible={visible}
          onToggle={() => setVisible((current) => !current)}
          maxLength={512}
          autoComplete="off"
        />

        {failure ? <Notice kind="error">{failure}</Notice> : null}
      </div>
    </Dialog>
  );
};
