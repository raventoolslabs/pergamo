import { api } from '../api/client';
import { useSession } from '../auth/session';
import { CambiarContrasena } from '../components/PasswordChange';
import { Aviso, Dato } from '../components/ui';

export const Account = () => {

  const { session } = useSession();

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
      </dl>

      <section className="seccion">
        {/* Sin tarjeta ni descripcion: el .seccion de arriba ya separa este
            bloque del resto de la pagina, y el titulo "Cambiar la contraseña"
            no necesita una segunda linea explicando lo obvio. */}
        <CambiarContrasena desnudo onSubmit={(contrasena) => api.changePassword(contrasena)} />
      </section>

      {session?.master ? <Aviso tipo="info">Estás usando el usuario master.</Aviso> : null}
    </>
  );
};
