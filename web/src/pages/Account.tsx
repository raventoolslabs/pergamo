import { api } from '../api/client';
import { useSession } from '../auth/session';
import { PasswordChange } from '../components/PasswordChange';
import { Datum, Notice } from '../components/ui';
import { t } from '../i18n';

export const Account = () => {

  const { session } = useSession();

  return (
    <>
      <div className="pagehead">
        <div className="pagehead__text">
          <h1>{t('account.title')}</h1>
          <p>{t('account.subtitle')}</p>
        </div>
      </div>

      <dl className="data">
        <Datum term={t('common.organization')}>{session?.name}</Datum>
        <Datum term={t('common.identifier')}>
          <span className="mono">{session?.organization || t('common.none')}</span>
        </Datum>
      </dl>

      <section className="section">
        {/* La seccion ya separa este bloque del resto: el titulo no necesita una
            segunda linea explicando lo obvio. */}
        <PasswordChange bare onSubmit={(password) => api.changePassword(password)} />
      </section>

      {session?.master ? <Notice kind="info">{t('account.masterNotice')}</Notice> : null}
    </>
  );
};
