import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { useSession } from '../auth/session';

/**
 * Membrete del registro.
 *
 * Sustituye a la barra lateral con iconos: para dos destinos, una columna
 * lateral es cromo de plantilla que roba ancho al contenido, que aqui es lo
 * unico que importa.
 */
export const Layout = () => {

  const { session, logout } = useSession();
  const [abierto, setAbierto] = useState(false);

  const cerrar = () => setAbierto(false);
  const clase = ({ isActive }: { isActive: boolean }) => (isActive ? 'activo' : undefined);

  return (
    <div className="shell">
      <header className={`membrete${abierto ? ' membrete--abierto' : ''}`}>
        <button
          type="button"
          className="membrete__menu"
          onClick={() => setAbierto((estado) => !estado)}
          aria-label="Menú"
          aria-expanded={abierto}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <NavLink to="/" className="membrete__marca" onClick={cerrar}>
          <img src="/img/logo-without-tittle.png" alt="" />
          <span>pergamo</span>
        </NavLink>

        <nav className="membrete__nav" onClick={cerrar}>
          {/* El token master no lleva organizacion, asi que ninguna ruta de
              documentos funciona con el: se le ofrece solo lo que puede usar. */}
          {session?.master ? (
            <NavLink to="/organizaciones" className={clase}>Organizaciones</NavLink>
          ) : (
            <>
              <NavLink to="/" end className={clase}>Fondo documental</NavLink>
              <NavLink to="/cuenta" className={clase}>Mi cuenta</NavLink>
            </>
          )}
        </nav>

        <div className="membrete__hueco" />

        <div className="membrete__sesion">
          <span className="membrete__quien" title={session?.master ? 'Sesión master' : 'Organización'}>
            {session?.name}
          </span>
          <button type="button" className="btn btn--menudo" onClick={logout}>Salir</button>
        </div>
      </header>

      <main className="pagina">
        <div className="pagina__interior"><Outlet /></div>
      </main>
    </div>
  );
};
