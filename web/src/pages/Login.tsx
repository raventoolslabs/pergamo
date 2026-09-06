import { useState } from 'react';
import type { FormEvent } from 'react';

import { useSession } from '../auth/session';
import { AvisoDeError } from '../components/ui';

export const Login = () => {

  const { login } = useSession();

  const [nombre, setNombre] = useState('');
  const [contrasena, setContrasena] = useState('');
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

  return (
    <div className="acceso">
      <div className="acceso__hoja">
        <img src="/img/logo.png" alt="Pergamo" className="acceso__logo" />

        <p className="acceso__entradilla">El fondo documental de tu organización.</p>

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
            <input
              id="acceso-contrasena"
              type="password"
              autoComplete="current-password"
              required
              value={contrasena}
              onChange={(evento) => setContrasena(evento.target.value)}
            />
          </div>

          <button type="submit" className="btn btn--principal btn--ancho" disabled={entrando || !nombre || !contrasena}>
            {entrando ? <><span className="girando" aria-hidden="true" /> Entrando…</> : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
};
