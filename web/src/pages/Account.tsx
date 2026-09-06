import { useState } from 'react';
import type { FormEvent } from 'react';

import { api } from '../api/client';
import { useSession } from '../auth/session';
import { Comprobacion, contrasenaValida } from '../components/PasswordFields';
import { useToast } from '../components/toast';
import { Aviso, AvisoDeError, Dato, formatearFecha } from '../components/ui';

export const Account = () => {

  const { session } = useSession();
  const toast = useToast();

  const [contrasena, setContrasena] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [guardando, setGuardando] = useState(false);

  const noCoinciden = !!repetida && contrasena !== repetida;

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    setError(null);
    setGuardando(true);

    try {
      await api.changePassword(contrasena);
      setContrasena('');
      setRepetida('');
      toast('Contraseña cambiada');
    } catch (fallo) {
      setError(fallo);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <div className="encabezado">
        <div className="encabezado__texto">
          <h1>Mi cuenta</h1>
          <p>La sesión con la que estás trabajando y su contraseña.</p>
        </div>
      </div>

      <dl className="datos">
        <Dato termino="Organización">{session?.name}</Dato>
        <Dato termino="Identificador"><span className="mono">{session?.organization || '—'}</span></Dato>
        <Dato termino="La sesión caduca">{formatearFecha(session?.expiresAt)}</Dato>
      </dl>

      <section className="seccion">
        <h2>Cambiar la contraseña</h2>
        <p className="seccion__nota">
          El servidor rechaza repetir la actual. El cambio no cierra esta sesión: el token que
          tienes sigue valiendo hasta que caduque.
        </p>

        <form onSubmit={enviar} className="formulario">
          <AvisoDeError error={error} />

          <div className="campo">
            <label htmlFor="contrasena-nueva">Contraseña nueva</label>
            <input
              id="contrasena-nueva"
              type="password"
              autoComplete="new-password"
              value={contrasena}
              onChange={(evento) => setContrasena(evento.target.value)}
            />
            <Comprobacion contrasena={contrasena} />
          </div>

          <div className="campo">
            <label htmlFor="contrasena-repetida">Repetir contraseña</label>
            <input
              id="contrasena-repetida"
              type="password"
              autoComplete="new-password"
              value={repetida}
              onChange={(evento) => setRepetida(evento.target.value)}
            />
            {noCoinciden ? <p className="campo__pista campo__pista--error">No coincide con la anterior.</p> : null}
          </div>

          <div>
            <button
              type="submit"
              className="btn btn--principal"
              disabled={guardando || noCoinciden || !contrasenaValida(contrasena)}
            >
              {guardando ? <><span className="girando" aria-hidden="true" /> Guardando…</> : 'Cambiar contraseña'}
            </button>
          </div>
        </form>
      </section>

      {session?.master ? <Aviso tipo="info">Estás usando el usuario master.</Aviso> : null}
    </>
  );
};
