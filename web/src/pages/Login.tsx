import { useState } from 'react';
import type { FormEvent } from 'react';

import { useSession } from '../auth/session';
import { AvisoDeError } from '../components/ui';

/**
 * El ojo de la contraseña. La barra diagonal aparece cuando la contraseña esta
 * a la vista: el icono dice lo que pasa ahora, no lo que haria el boton.
 */
const Ojo = ({ tachado }: { tachado: boolean }) => (
  <svg
    width="19"
    height="19"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M1.8 12S5.4 5.4 12 5.4 22.2 12 22.2 12 18.6 18.6 12 18.6 1.8 12 1.8 12Z" />
    <circle cx="12" cy="12" r="3.1" />
    {tachado ? <path d="M3.5 20.5 20.5 3.5" /> : null}
  </svg>
);

export const Login = () => {

  const { login } = useSession();

  const [nombre, setNombre] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [verContrasena, setVerContrasena] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [entrando, setEntrando] = useState(false);

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    setError(null);
    setEntrando(true);

    try {
      await login(nombre.trim(), contrasena);
    } catch (fallo) {
      setError(fallo);
    } finally {
      setEntrando(false);
    }
  };

  const rotulo = verContrasena ? 'Ocultar contraseña' : 'Ver contraseña';

  return (
    <div className="acceso">

      {/*
       * El panel no es decoracion: es lo unico que explica que es esto a quien
       * llega a la direccion sin saberlo. Por debajo de 900px desaparece —el
       * formulario manda— y el logotipo sube a la columna.
       */}
      <aside className="acceso__marca">
        <div className="acceso__velo" aria-hidden="true" />
        <div className="acceso__trama" aria-hidden="true" />
        <div className="acceso__filigrana" aria-hidden="true" />

        <div className="acceso__chapa">
          <img src="/img/logo.png" alt="Pergamo" />
        </div>

        <div className="acceso__discurso">
          <h1>Toda tu documentación, en un solo lugar.</h1>
          <p>
            Base de datos documental que centraliza, versiona y expone tus archivos para que
            cualquier aplicación de tu organización acceda a ellos de forma segura.
          </p>
          <div className="acceso__pauta" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>

        <p className="acceso__pie">© 2026 Pergamo</p>
      </aside>

      <main className="acceso__panel">
        <div className="acceso__hoja">

          {/* El mismo logotipo repetido no le dice nada a un lector de pantalla:
              en la columna es decorativo y va sin texto alternativo. */}
          <img src="/img/logo.png" alt="" className="acceso__logo-movil" />

          <div className="acceso__encabezado">
            <h2>Inicia sesión</h2>
            <p>Accede con tu cuenta corporativa para continuar.</p>
          </div>

          <AvisoDeError error={error} />

          <form onSubmit={enviar} className="acceso__entrada">
            <div className="campo">
              <label htmlFor="acceso-nombre">Organización o usuario</label>
              <input
                id="acceso-nombre"
                type="text"
                autoComplete="username"
                autoFocus
                required
                value={nombre}
                onChange={(evento) => setNombre(evento.target.value)}
              />
            </div>

            <div className="campo">
              <label htmlFor="acceso-contrasena">Contraseña</label>
              <span className="acceso__secreto">
                <input
                  id="acceso-contrasena"
                  type={verContrasena ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={contrasena}
                  onChange={(evento) => setContrasena(evento.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setVerContrasena((visible) => !visible)}
                  aria-label={rotulo}
                  aria-pressed={verContrasena}
                  title={rotulo}
                >
                  <Ojo tachado={verContrasena} />
                </button>
              </span>
            </div>

            <button type="submit" className="acceso__entrar" disabled={entrando || !nombre || !contrasena}>
              {entrando ? <><span className="girando" aria-hidden="true" /> Entrando…</> : 'Entrar'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};
