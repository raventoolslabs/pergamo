import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { api } from '../api/client';
import type { Organization, OrganizationList } from '../api/types';
import { Comprobacion, contrasenaValida } from '../components/PasswordFields';
import { useToast } from '../components/toast';
import { Aviso, AvisoDeError, Cargando, Dialogo, Vacio, formatearFecha } from '../components/ui';

const POR_PAGINA = 25;

/* ------------------------------------------------------------ alta nueva -- */

const DialogoDeAlta = ({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (nombre: string) => void;
}) => {

  const [nombre, setNombre] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [repetida, setRepetida] = useState('');
  const [id, setId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [creando, setCreando] = useState(false);

  const noCoinciden = !!repetida && contrasena !== repetida;

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    setError(null);
    setCreando(true);

    try {
      // El identificador es opcional: sin el lo genera la base de datos. Se
      // ofrece porque la API lo admite y sirve para conservar un identificador
      // conocido al migrar desde otra instalacion.
      await api.createOrganization({
        name: nombre.trim(),
        password: contrasena,
        ...(id.trim() ? { id: id.trim() } : {})
      });
      onCreated(nombre.trim());
    } catch (fallo) {
      setError(fallo);
    } finally {
      setCreando(false);
    }
  };

  return (
    <Dialogo
      titulo="Nueva organización"
      onClose={onClose}
      pie={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button
            type="submit"
            form="alta-organizacion"
            className="btn btn--principal"
            disabled={creando || !nombre.trim() || noCoinciden || !contrasenaValida(contrasena)}
          >
            {creando ? <><span className="girando" aria-hidden="true" /> Creando…</> : 'Crear'}
          </button>
        </>
      }
    >
      <form id="alta-organizacion" className="dialogo__cuerpo" onSubmit={enviar}>
        <AvisoDeError error={error} />

        <div className="campo">
          <label htmlFor="alta-nombre">Nombre</label>
          <input id="alta-nombre" type="text" autoFocus required maxLength={64} value={nombre}
            onChange={(evento) => setNombre(evento.target.value)} />
          <p className="campo__pista">Con este nombre iniciará sesión. Debe ser único.</p>
        </div>

        <div className="campo">
          <label htmlFor="alta-contrasena">Contraseña</label>
          <input id="alta-contrasena" type="password" autoComplete="new-password" value={contrasena}
            onChange={(evento) => setContrasena(evento.target.value)} />
          <Comprobacion contrasena={contrasena} />
        </div>

        <div className="campo">
          <label htmlFor="alta-repetida">Repetir contraseña</label>
          <input id="alta-repetida" type="password" autoComplete="new-password" value={repetida}
            onChange={(evento) => setRepetida(evento.target.value)} />
          {noCoinciden ? <p className="campo__pista campo__pista--error">No coincide con la anterior.</p> : null}
        </div>

        <div className="campo">
          <label htmlFor="alta-id">Identificador</label>
          <input id="alta-id" type="text" maxLength={40} value={id}
            onChange={(evento) => setId(evento.target.value)} placeholder="Se genera solo si lo dejas vacío" />
        </div>

        <Aviso tipo="warn">
          Apunta la contraseña ahora. Después no hay forma de consultarla, solo de cambiarla.
        </Aviso>
      </form>
    </Dialogo>
  );
};

/* ------------------------------------------------------ cambio de clave -- */

const DialogoDeContrasena = ({ organizacion, onClose, onChanged }: {
  organizacion: Organization;
  onClose: () => void;
  onChanged: () => void;
}) => {

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
      await api.changeOrganizationPassword(organizacion.id, contrasena);
      onChanged();
    } catch (fallo) {
      setError(fallo);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialogo
      titulo={`Contraseña de ${organizacion.name}`}
      onClose={onClose}
      pie={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" form="cambio-contrasena" className="btn btn--principal"
            disabled={guardando || noCoinciden || !contrasenaValida(contrasena)}>
            {guardando ? <><span className="girando" aria-hidden="true" /> Guardando…</> : 'Cambiar'}
          </button>
        </>
      }
    >
      <form id="cambio-contrasena" className="dialogo__cuerpo" onSubmit={enviar}>
        <AvisoDeError error={error} />

        <div className="campo">
          <label htmlFor="cambio-nueva">Contraseña nueva</label>
          <input id="cambio-nueva" type="password" autoComplete="new-password" autoFocus value={contrasena}
            onChange={(evento) => setContrasena(evento.target.value)} />
          <Comprobacion contrasena={contrasena} />
        </div>

        <div className="campo">
          <label htmlFor="cambio-repetida">Repetir contraseña</label>
          <input id="cambio-repetida" type="password" autoComplete="new-password" value={repetida}
            onChange={(evento) => setRepetida(evento.target.value)} />
          {noCoinciden ? <p className="campo__pista campo__pista--error">No coincide con la anterior.</p> : null}
        </div>

        <p className="campo__pista">El servidor la rechaza si coincide con la actual.</p>
      </form>
    </Dialogo>
  );
};

/* ------------------------------------------------------------- registro -- */

export const Organizations = () => {

  const toast = useToast();

  const [nombre, setNombre] = useState('');
  const [conBajas, setConBajas] = useState(false);
  const [desde, setDesde] = useState(0);
  const [datos, setDatos] = useState<OrganizationList | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);
  const [cambiando, setCambiando] = useState<Organization | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCargando(true);

    const temporizador = setTimeout(() => {
      api.organizations({ name: nombre, include_discharged: conBajas, limit: POR_PAGINA, offset: desde })
        .then((resultado) => { if (vivo) { setDatos(resultado); setError(null); } })
        .catch((fallo) => { if (vivo) setError(fallo); })
        .finally(() => { if (vivo) setCargando(false); });
    }, nombre ? 300 : 0);

    return () => { vivo = false; clearTimeout(temporizador); };
  }, [nombre, conBajas, desde, recarga]);

  const refrescar = useCallback(() => setRecarga((valor) => valor + 1), []);

  const organizaciones = datos?.organizations ?? [];
  const total = datos?.total ?? 0;
  const cabeEnUnaPagina = total <= POR_PAGINA;

  return (
    <>
      <div className="encabezado">
        <div className="encabezado__texto">
          <h1>Organizaciones</h1>
          <p>
            {total} organizaci{total === 1 ? 'ón' : 'ones'} con fondo propio en este servidor.
          </p>
        </div>
        <div className="encabezado__acciones">
          <button type="button" className="btn btn--principal" onClick={() => setCreando(true)}>
            Nueva organización
          </button>
        </div>
      </div>

      <Aviso tipo="info">
        El usuario master no pertenece a ninguna organización, así que desde aquí no se ven ni se
        suben documentos. Para trabajar con un fondo hay que entrar con su organización.
      </Aviso>

      <div className="separado">
        <AvisoDeError error={error} />
      </div>

      <div className="filtros">
        <div className="campo">
          <label htmlFor="organizacion-buscar">Buscar</label>
          <input id="organizacion-buscar" type="search" placeholder="Nombre de la organización" value={nombre}
            onChange={(evento) => { setDesde(0); setNombre(evento.target.value); }} />
        </div>
        <div className="campo">
          <label htmlFor="organizacion-bajas">Dadas de baja</label>
          <select id="organizacion-bajas" value={conBajas ? 'true' : 'false'}
            onChange={(evento) => { setDesde(0); setConBajas(evento.target.value === 'true'); }}>
            <option value="false">Ocultar</option>
            <option value="true">Mostrar también</option>
          </select>
        </div>
      </div>

      {cargando && !datos ? <Cargando /> : null}

      {!cargando && !organizaciones.length ? (
        <Vacio titulo="Ninguna organización coincide">Cambia la búsqueda o da de alta una nueva.</Vacio>
      ) : null}

      {organizaciones.length ? (
        <>
          <div className="desliza">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Identificador</th>
                  <th>Alta</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {organizaciones.map((organizacion) => (
                  <tr key={organizacion.id}>
                    <td>
                      {organizacion.name}
                      {organizacion.discharge_date
                        ? <div className="entrada__veredicto entrada__veredicto--infected">de baja</div>
                        : null}
                    </td>
                    <td><span className="mono">{organizacion.id}</span></td>
                    <td>{formatearFecha(organizacion.creation_date, false)}</td>
                    <td>
                      <button type="button" className="btn btn--menudo" onClick={() => setCambiando(organizacion)}>
                        Cambiar contraseña
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {cabeEnUnaPagina ? null : (
          <div className="paginacion">
            <span className="paginacion__cuenta">
              {desde + 1}–{Math.min(desde + organizaciones.length, total)} de {total}
            </span>
            <button type="button" className="btn btn--menudo"
              onClick={() => setDesde(Math.max(0, desde - POR_PAGINA))} disabled={desde === 0 || cargando}>
              Anteriores
            </button>
            <button type="button" className="btn btn--menudo"
              onClick={() => setDesde(desde + POR_PAGINA)}
              disabled={desde + organizaciones.length >= total || cargando}>
              Siguientes
            </button>
          </div>
          )}
        </>
      ) : null}

      {creando ? (
        <DialogoDeAlta
          onClose={() => setCreando(false)}
          onCreated={(creada) => { setCreando(false); refrescar(); toast(`Organización ${creada} creada`); }}
        />
      ) : null}

      {cambiando ? (
        <DialogoDeContrasena
          organizacion={cambiando}
          onClose={() => setCambiando(null)}
          onChanged={() => {
            const cambiada = cambiando.name;
            setCambiando(null);
            toast(`Contraseña de ${cambiada} cambiada`);
          }}
        />
      ) : null}
    </>
  );
};
