import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { api } from '../api/client';
import type { Organization, OrganizationList } from '../api/types';
import { PasswordChange } from '../components/PasswordChange';
import { PasswordChecklist, isPasswordValid } from '../components/PasswordFields';
import { useToast } from '../components/toast';
import {
  Dialog, Empty, ErrorNotice, Loading, Notice, PAGE_SIZES, Pagination, formatDate
} from '../components/ui';
import { t } from '../i18n';

/**
 * Cuenta el censo en una frase, como hace el fondo documental: lo que importa
 * de un vistazo es cuantas organizaciones hay vivas y cuantas se dieron de baja
 * sin borrarse.
 */
const summary = (active: number, discharged: number) => {
  if (!active && !discharged) return t('organizations.summaryEmpty');

  const census = t('organizations.census', { count: active });

  if (!discharged) return t('organizations.censusOnly', { census });

  return t('organizations.censusWithDischarged', { count: discharged, census });
};

const AddIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14" /><path d="M5 12h14" />
  </svg>
);

const KeyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="15.5" r="3.5" />
    <path d="M10.3 13.2 19 4.5" />
    <path d="M15.5 8 18 10.5" />
    <path d="M18.5 5.5 21 8" />
  </svg>
);

/* ------------------------------------------------------------- new entry -- */

const CreateDialog = ({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (name: string) => void;
}) => {

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [id, setId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);

  const mismatches = !!repeated && password !== repeated;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setCreating(true);

    try {
      // El identificador es opcional: sin el lo genera la base de datos. Se
      // ofrece para conservar uno conocido al migrar desde otra instalacion.
      await api.createOrganization({
        name: name.trim(),
        password,
        ...(id.trim() ? { id: id.trim() } : {})
      });
      onCreated(name.trim());
    } catch (failure) {
      setError(failure);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      title={t('organizations.create')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button
            type="submit"
            form="organization-create"
            className="btn btn--primary"
            disabled={creating || !name.trim() || mismatches || !isPasswordValid(password)}
          >
            {creating
              ? <><span className="spinner" aria-hidden="true" /> {t('organizations.creating')}</>
              : t('organizations.createSubmit')}
          </button>
        </>
      }
    >
      <form id="organization-create" className="dialog__body" onSubmit={submit}>
        <ErrorNotice error={error} />

        <div className="field">
          <label htmlFor="create-name">{t('common.name')}</label>
          <input id="create-name" type="text" autoFocus required maxLength={64} value={name}
            onChange={(event) => setName(event.target.value)} />
          <p className="field__hint">{t('organizations.nameHint')}</p>
        </div>

        <div className="field">
          <label htmlFor="create-password">{t('login.passwordLabel')}</label>
          <input id="create-password" type="password" autoComplete="new-password" value={password}
            onChange={(event) => setPassword(event.target.value)} />
          <PasswordChecklist password={password} />
        </div>

        <div className="field">
          <label htmlFor="create-repeated">{t('password.repeatLabel')}</label>
          <input id="create-repeated" type="password" autoComplete="new-password" value={repeated}
            onChange={(event) => setRepeated(event.target.value)} />
          {mismatches
            ? <p className="field__hint field__hint--error">{t('organizations.repeatMismatch')}</p>
            : null}
        </div>

        <div className="field">
          <label htmlFor="create-id">{t('common.identifier')}</label>
          <input id="create-id" type="text" maxLength={40} value={id}
            onChange={(event) => setId(event.target.value)} placeholder={t('organizations.idPlaceholder')} />
        </div>

        <Notice kind="warn">{t('organizations.passwordWarning')}</Notice>
      </form>
    </Dialog>
  );
};

/* -------------------------------------------------------- password reset -- */

/**
 * El exito se muestra dentro del propio formulario, asi que este dialogo no se
 * cierra solo al terminar: lo cierra el master cuando ha visto la confirmacion.
 */
const PasswordDialog = ({ organization, onClose }: {
  organization: Organization;
  onClose: () => void;
}) => (
  <Dialog bare ariaLabel={t('organizations.changePasswordTitle', { name: organization.name })} onClose={onClose}>
    <PasswordChange
      title={t('organizations.passwordOf', { name: organization.name })}
      description={t('organizations.passwordDescription')}
      submitText={t('organizations.passwordSubmit')}
      onSubmit={(password) => api.changeOrganizationPassword(organization.id, password)}
      onCancel={onClose}
    />
  </Dialog>
);

/* ----------------------------------------------------------------- list --- */

export const Organizations = () => {

  const toast = useToast();

  const [name, setName] = useState('');
  const [withDischarged, setWithDischarged] = useState(false);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OrganizationList | null>(null);
  const [census, setCensus] = useState<{ active: number; discharged: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [changing, setChanging] = useState<Organization | null>(null);
  const [reload, setReload] = useState(0);

  const offset = (page - 1) * pageSize;

  useEffect(() => {
    let alive = true;
    setLoading(true);

    const timer = setTimeout(() => {
      api.organizations({ name, include_discharged: withDischarged, limit: pageSize, offset })
        .then((result) => { if (alive) { setData(result); setError(null); } })
        .catch((failure) => { if (alive) setError(failure); })
        .finally(() => { if (alive) setLoading(false); });
    }, name ? 300 : 0);

    return () => { alive = false; clearTimeout(timer); };
  }, [name, withDischarged, offset, pageSize, reload]);

  // El subtitulo cuenta el censo entero, no lo que deja ver el filtro. Las bajas
  // salen de la diferencia, que es el unico dato que la API no da hecho.
  useEffect(() => {
    let alive = true;

    Promise.all([
      api.organizations({ limit: 1 }),
      api.organizations({ limit: 1, include_discharged: true })
    ])
      .then(([active, all]) => {
        if (alive) setCensus({ active: active.total, discharged: all.total - active.total });
      })
      .catch(() => { if (alive) setCensus(null); });

    return () => { alive = false; };
  }, [reload]);

  const refresh = useCallback(() => { setPage(1); setReload((value) => value + 1); }, []);

  const organizations = data?.organizations ?? [];
  const total = data?.total ?? 0;
  const filtered = !!name || withDischarged;

  const clear = () => { setPage(1); setName(''); setWithDischarged(false); };

  return (
    <>
      <div className="pagehead">
        <div className="pagehead__text">
          <h1>{t('organizations.title')}</h1>
          <p>{census ? summary(census.active, census.discharged) : t('organizations.counting')}</p>
        </div>
        <div className="pagehead__actions">
          <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            <AddIcon />
            {t('organizations.create')}
          </button>
        </div>
      </div>

      <ErrorNotice error={error} />

      <div className="filters">
        <div className="field">
          <label htmlFor="organization-search">{t('common.search')}</label>
          <input id="organization-search" type="search" placeholder={t('organizations.searchPlaceholder')}
            value={name} onChange={(event) => { setPage(1); setName(event.target.value); }} />
        </div>
        <div className="field">
          <label htmlFor="organization-discharged">{t('organizations.dischargedLabel')}</label>
          <select id="organization-discharged" value={withDischarged ? 'true' : 'false'}
            onChange={(event) => { setPage(1); setWithDischarged(event.target.value === 'true'); }}>
            <option value="false">{t('organizations.dischargedHide')}</option>
            <option value="true">{t('organizations.dischargedShow')}</option>
          </select>
        </div>
      </div>

      {loading && !data ? <Loading /> : null}

      {data ? (
        <>
          <div className="results">
            <span className="results__count">
              {filtered
                ? t('organizations.matches', { count: total, total })
                : t('organizations.count', { count: total, total })}
            </span>
            {filtered ? (
              <button type="button" className="btn btn--pill" onClick={clear}>{t('common.clearFilters')}</button>
            ) : null}
          </div>

          <div className="ledger">
            <div className="scroller">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('common.organization')}</th>
                    <th>{t('common.identifier')}</th>
                    <th>{t('organizations.columnRegistered')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {organizations.map((organization) => (
                    <tr key={organization.id}>
                      <td>
                        <div className="table__name">{organization.name}</div>
                        {/* Una baja no borra el fondo: la organizacion sigue en
                            el censo, marcada, porque sus documentos siguen ahi. */}
                        {organization.discharge_date ? (
                          <span
                            className="discharged"
                            title={t('organizations.dischargedOn', {
                              date: formatDate(organization.discharge_date, false)
                            })}
                          >
                            {t('organizations.discharged')}
                          </span>
                        ) : null}
                      </td>
                      <td><span className="mono">{organization.id}</span></td>
                      <td className="table__date">{formatDate(organization.creation_date, false)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--icon"
                          aria-label={t('organizations.changePasswordFor', { name: organization.name })}
                          title={t('organizations.changePassword')}
                          onClick={() => setChanging(organization)}
                        >
                          <KeyIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!loading && !organizations.length ? (
              <Empty title={t('organizations.noMatchTitle')} centered>
                {t('organizations.noMatchBody')}
              </Empty>
            ) : null}
          </div>

          <Pagination
            total={total}
            shown={organizations.length}
            page={page}
            pageSize={pageSize}
            busy={loading}
            onPage={setPage}
            onPageSize={(size) => { setPage(1); setPageSize(size); }}
          />
        </>
      ) : null}

      {creating ? (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            refresh();
            toast(t('organizations.created', { name: created }));
          }}
        />
      ) : null}

      {changing ? (
        <PasswordDialog organization={changing} onClose={() => setChanging(null)} />
      ) : null}
    </>
  );
};
