import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { useSession } from '../auth/session';
import { t } from '../i18n';

const UserIcon = ({ size = 19 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M4.8 20c.9-3.6 3.7-5.4 7.2-5.4s6.3 1.8 7.2 5.4" />
  </svg>
);

const LogoutIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <path d="M15 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3" />
    <path d="M10 8l-4 4 4 4" />
    <path d="M6 12h9" />
  </svg>
);

/**
 * Membrete del registro. Para dos destinos, una barra lateral es cromo que roba
 * ancho al contenido. Lo que no es navegacion —cuenta y salida— vive en el menu
 * de usuario: son cosas que se hacen una vez.
 */
export const Layout = () => {

  const { session, logout } = useSession();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Un menu que solo se cierra volviendo a pulsar su boton se queda por
    // encima de lo que se ha ido a mirar.
    const onClick = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };

    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : undefined);

  return (
    <div className="shell">
      <header className="masthead">
        <NavLink to="/" className="masthead__brand">
          <img src="/img/logo-without-tittle.png" alt="" />
          <span>pergamo</span>
        </NavLink>

        <nav className="masthead__nav">
          {/* El token master no lleva organizacion: se le ofrece solo lo que
              puede usar. */}
          {session?.master ? (
            <NavLink to="/organizations" className={linkClass}>{t('masthead.organizations')}</NavLink>
          ) : (
            <NavLink to="/" end className={linkClass}>{t('masthead.documents')}</NavLink>
          )}
        </nav>

        <div className="masthead__gap" />

        <div className="masthead__session">
          <dl className="masthead__who">
            <dt>{session?.master ? t('masthead.session') : t('common.organization')}</dt>
            <dd>{session?.master ? t('masthead.master') : session?.name}</dd>
          </dl>

          <div className="masthead__user" ref={menu}>
            <button
              type="button"
              className="masthead__avatar"
              onClick={() => setOpen((current) => !current)}
              aria-label={t('a11y.userMenu')}
              aria-haspopup="true"
              aria-expanded={open}
            >
              <UserIcon />
            </button>

            {open ? (
              <div className="masthead__menu">
                {/* El master no tiene organizacion propia: la pantalla de
                    cuenta cambiaria una contrasena que no es la suya. */}
                {session?.master ? null : (
                  <NavLink to="/account" onClick={() => setOpen(false)}>
                    <UserIcon size={15} />
                    {t('masthead.account')}
                  </NavLink>
                )}
                <button type="button" onClick={logout}>
                  <LogoutIcon />
                  {t('masthead.logout')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="page">
        <div className="page__inner"><Outlet /></div>
      </main>
    </div>
  );
};
