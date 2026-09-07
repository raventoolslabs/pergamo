import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { useSession } from '../auth/session';

const IconoUsuario = ({ tamano = 19 }: { tamano?: number }) => (
  <svg width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M4.8 20c.9-3.6 3.7-5.4 7.2-5.4s6.3 1.8 7.2 5.4" />
  </svg>
);

const IconoSalir = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <path d="M15 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3" />
    <path d="M10 8l-4 4 4 4" />
    <path d="M6 12h9" />
  </svg>
);

/**
 * Membrete del registro.
 *
 * Sustituye a la barra lateral con iconos: para dos destinos, una columna
 * lateral es cromo de plantilla que roba ancho al contenido, que aqui es lo
 * unico que importa.
 *
 * Lo que no es navegacion —la cuenta y la salida— vive en el menu de usuario y
 * no en la barra: son cosas que se hacen una vez, y compitiendo por el mismo
 * espacio hacian que el unico destino real pareciera uno de tres.
 */
export const Layout = () => {

  const { session, logout } = useSession();
  const [abierto, setAbierto] = useState(false);
  const usuario = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;

    // Un menu que solo se cierra volviendo a pulsar su boton se queda abierto
    // por encima de lo que el usuario ha ido a mirar.
    const alPulsar = (evento: MouseEvent) => {
      if (!usuario.current?.contains(evento.target as Node)) setAbierto(false);
    };
    const alTeclear = (evento: KeyboardEvent) => { if (evento.key === 'Escape') setAbierto(false); };

    document.addEventListener('mousedown', alPulsar);
    document.addEventListener('keydown', alTeclear);

    return () => {
      document.removeEventListener('mousedown', alPulsar);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [abierto]);

  const clase = ({ isActive }: { isActive: boolean }) => (isActive ? 'activo' : undefined);

  return (
    <div className="shell">
      <header className="membrete">
        <NavLink to="/" className="membrete__marca">
          <img src="/img/logo-without-tittle.png" alt="" />
          <span>pergamo</span>
        </NavLink>

        <nav className="membrete__nav">
          {/* El token master no lleva organizacion, asi que ninguna ruta de
              documentos funciona con el: se le ofrece solo lo que puede usar. */}
          {session?.master ? (
            <NavLink to="/organizaciones" className={clase}>Organizaciones</NavLink>
          ) : (
            <NavLink to="/" end className={clase}>Documentos</NavLink>
          )}
        </nav>

        <div className="membrete__hueco" />

        <div className="membrete__sesion">
          <dl className="membrete__quien">
            <dt>{session?.master ? 'Sesión' : 'Organización'}</dt>
            <dd>{session?.master ? 'Master' : session?.name}</dd>
          </dl>

          <div className="membrete__usuario" ref={usuario}>
            <button
              type="button"
              className="membrete__avatar"
              onClick={() => setAbierto((estado) => !estado)}
              aria-label="Menú de usuario"
              aria-haspopup="true"
              aria-expanded={abierto}
            >
              <IconoUsuario />
            </button>

            {abierto ? (
              <div className="membrete__menu">
                {/* El master no tiene organizacion propia: la pantalla de
                    cuenta cambiaria una contraseña que no es la suya. */}
                {session?.master ? null : (
                  <NavLink to="/cuenta" onClick={() => setAbierto(false)}>
                    <IconoUsuario tamano={15} />
                    Mi cuenta
                  </NavLink>
                )}
                <button type="button" onClick={logout}>
                  <IconoSalir />
                  Salir
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="pagina">
        <div className="pagina__interior"><Outlet /></div>
      </main>
    </div>
  );
};
