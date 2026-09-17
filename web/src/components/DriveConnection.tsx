import { useState } from 'react';

import type { DriveConnection as Connection, DriveSettings } from '../api/types';
import { t } from '../i18n';
import { DriveConnectDialog } from './DriveConnectDialog';
import { Datum, formatDate } from './ui';

/**
 * Un solo boton: conectar o desconectar. Registrar el cliente y autorizar la
 * cuenta son dos pasos de lo mismo, asi que el primero vive en el dialogo y no
 * en la pantalla.
 */
export const DriveConnection = ({ settings, connection, busy, onConnect, onDisconnect }: {
  settings: DriveSettings;
  connection: Connection | null;
  /** El de la pagina: el boton de conectar comparte su hilo. */
  busy: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) => {

  const [asking, setAsking] = useState(false);

  const connected = connection?.connected === true;

  return (
    <section className="section">
      <h2>{t('drive.connection')}</h2>

      {connected ? (
        <dl className="data">
          <Datum term={t('drive.account')}>{connection?.google_account}</Datum>
          <Datum term={t('drive.connectedSinceTerm')}>{formatDate(connection?.creation_date, false)}</Datum>
        </dl>
      ) : null}

      <div className="spaced">
        {connected ? (
          <button type="button" className="btn" onClick={onDisconnect}>{t('drive.disconnect')}</button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            // Con cliente guardado no hay nada que preguntar: a Google directo.
            onClick={() => settings.configured ? onConnect() : setAsking(true)}
            disabled={busy === 'connect'}
          >
            {busy === 'connect'
              ? <><span className="spinner" aria-hidden="true" /> {t('drive.connecting')}</>
              : connection?.revoked_date ? t('drive.reconnect') : t('drive.connect')}
          </button>
        )}
      </div>

      {asking ? <DriveConnectDialog onClose={() => setAsking(false)} /> : null}
    </section>
  );
};
