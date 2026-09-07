import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { api } from '../api/client';
import type { Organization, OrganizationList } from '../api/types';
import { CambiarContrasena } from '../components/PasswordChange';
import { Comprobacion, contrasenaValida } from '../components/PasswordFields';
import { useToast } from '../components/toast';
import {
  Aviso, AvisoDeError, Cargando, Dialogo, POR_PAGINA, Paginacion, Vacio, formatearFecha
} from '../components/ui';

/**
 * Cuenta el censo en una frase, como hace el fondo documental con los
 * documentos: lo que importa de un vistazo es cuantas organizaciones hay vivas
 * y cuantas se dieron de baja sin borrarse.
 */
const resumen = (activas: number, bajas: number) => {
  if (!activas && !bajas) return 'Todavía no hay ninguna organización.';

  const censo = `${activas} organizaci${activas === 1 ? 'ón' : 'ones'} con fondo propio`;

  if (!bajas) return `${censo} en este servidor.`;

  return `${censo} · ${bajas} dada${bajas === 1 ? '' : 's'} de baja.`;
};

const IconoAlta = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14" /><path d="M5 12h14" />
  </svg>
);

const IconoLlave = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="15.5" r="3.5" />
    <path d="M10.3 13.2 19 4.5" />
    <path d="M15.5 8 18 10.5" />
    <path d="M18.5 5.5 21 8" />
  </svg>
);

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

/**
 * El "estado de éxito dentro del propio componente" del diseño solo tiene
 * sentido si el dialogo NO se cierra solo al terminar: por eso, a diferencia
 * del resto de dialogos de esta pantalla, este no lleva `onChanged` que lo
 * cierre — cierra el master, con Cancelar, clic fuera o Escape, despues de ver
 * confirmado el cambio.
 */
const DialogoDeContrasena = ({ organizacion, onClose }: {
  organizacion: Organization;
  onClose: () => void;
}) => (
  <Dialogo desnudo ariaLabel={`Cambiar la contraseña de ${organizacion.name}`} onClose={onClose}>
    <CambiarContrasena
      titulo={`Contraseña de ${organizacion.name}`}
      descripcion={
        <>No puede coincidir con la actual. No afecta a sus sesiones ya abiertas: los
          tokens que tenga emitidos seguirán valiendo hasta que caduquen.</>
      }
      textoEnvio="Cambiar"
      onSubmit={(contrasena) => api.changeOrganizationPassword(organizacion.id, contrasena)}
      onCancel={onClose}
    />
  </Dialogo>
);

/* ------------------------------------------------------------- registro -- */

export const Organizations = () => {

  const toast = useToast();

  const [nombre, setNombre] = useState('');
  const [conBajas, setConBajas] = useState(false);
  const [porPagina, setPorPagina] = useState(POR_PAGINA[0]);
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<OrganizationList | null>(null);
  const [censo, setCenso] = useState<{ activas: number; bajas: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);
  const [cambiando, setCambiando] = useState<Organization | null>(null);
  const [recarga, setRecarga] = useState(0);

  const desde = (pagina - 1) * porPagina;

  useEffect(() => {
    let vivo = true;
    setCargando(true);

    const temporizador = setTimeout(() => {
      api.organizations({ name: nombre, include_discharged: conBajas, limit: porPagina, offset: desde })
        .then((resultado) => { if (vivo) { setDatos(resultado); setError(null); } })
        .catch((fallo) => { if (vivo) setError(fallo); })
        .finally(() => { if (vivo) setCargando(false); });
    }, nombre ? 300 : 0);

    return () => { vivo = false; clearTimeout(temporizador); };
  }, [nombre, conBajas, desde, porPagina, recarga]);

  // El subtitulo cuenta el censo entero, no lo que deja ver el filtro puesto:
  // igual que en el fondo documental, son dos recuentos sin filtrar y sin traer
  // una sola fila. Las bajas salen de la diferencia, que es el unico dato que
  // la API no da hecho.
  useEffect(() => {
    let vivo = true;

    Promise.all([
      api.organizations({ limit: 1 }),
      api.organizations({ limit: 1, include_discharged: true })
    ])
      .then(([activas, todas]) => {
        if (vivo) setCenso({ activas: activas.total, bajas: todas.total - activas.total });
      })
      .catch(() => { if (vivo) setCenso(null); });

    return () => { vivo = false; };
  }, [recarga]);

  const refrescar = useCallback(() => { setPagina(1); setRecarga((valor) => valor + 1); }, []);

  const organizaciones = datos?.organizations ?? [];
  const total = datos?.total ?? 0;
  const filtrado = !!nombre || conBajas;

  const limpiar = () => { setPagina(1); setNombre(''); setConBajas(false); };

  return (
    <>
      <div className="encabezado">
        <div className="encabezado__texto">
          <h1>Organizaciones</h1>
          <p>{censo ? resumen(censo.activas, censo.bajas) : 'Consultando el censo…'}</p>
        </div>
        <div className="encabezado__acciones">
          <button type="button" className="btn btn--principal" onClick={() => setCreando(true)}>
            <IconoAlta />
            Nueva organización
          </button>
        </div>
      </div>

      <AvisoDeError error={error} />

      <div className="filtros">
        <div className="campo">
          <label htmlFor="organizacion-buscar">Buscar</label>
          <input id="organizacion-buscar" type="search" placeholder="Nombre de la organización" value={nombre}
            onChange={(evento) => { setPagina(1); setNombre(evento.target.value); }} />
        </div>
        <div className="campo">
          <label htmlFor="organizacion-bajas">Dadas de baja</label>
          <select id="organizacion-bajas" value={conBajas ? 'true' : 'false'}
            onChange={(evento) => { setPagina(1); setConBajas(evento.target.value === 'true'); }}>
            <option value="false">Ocultar</option>
            <option value="true">Mostrar también</option>
          </select>
        </div>
      </div>

      {cargando && !datos ? <Cargando /> : null}

      {datos ? (
        <>
          <div className="resultado">
            <span className="resultado__cuenta">
              {filtrado
                ? `${total} organizaci${total === 1 ? 'ón coincide' : 'ones coinciden'}`
                : `${total} organizaci${total === 1 ? 'ón' : 'ones'}`}
            </span>
            {filtrado ? (
              <button type="button" className="btn btn--pill" onClick={limpiar}>Limpiar filtros</button>
            ) : null}
          </div>

          <div className="registro">
            <div className="desliza">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Organización</th>
                    <th>Identificador</th>
                    <th>Alta</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {organizaciones.map((organizacion) => (
                    <tr key={organizacion.id}>
                      <td>
                        <div className="tabla__nombre">{organizacion.name}</div>
                        {/* Una baja no borra el fondo: la organizacion sigue en
                            el censo, marcada, porque sus documentos siguen ahi. */}
                        {organizacion.discharge_date ? (
                          <span className="baja" title={`De baja el ${formatearFecha(organizacion.discharge_date, false)}`}>
                            de baja
                          </span>
                        ) : null}
                      </td>
                      <td><span className="mono">{organizacion.id}</span></td>
                      <td className="tabla__fecha">{formatearFecha(organizacion.creation_date, false)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--icono"
                          aria-label={`Cambiar contraseña de ${organizacion.name}`}
                          title="Cambiar contraseña"
                          onClick={() => setCambiando(organizacion)}
                        >
                          <IconoLlave />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!cargando && !organizaciones.length ? (
              <Vacio titulo="Ninguna organización coincide" centrado>
                Cambia la búsqueda o da de alta una nueva.
              </Vacio>
            ) : null}
          </div>

          <Paginacion
            total={total}
            mostrados={organizaciones.length}
            pagina={pagina}
            porPagina={porPagina}
            ocupado={cargando}
            onPagina={setPagina}
            onPorPagina={(cuantos) => { setPagina(1); setPorPagina(cuantos); }}
          />
        </>
      ) : null}

      {creando ? (
        <DialogoDeAlta
          onClose={() => setCreando(false)}
          onCreated={(creada) => { setCreando(false); refrescar(); toast(`Organización ${creada} creada`); }}
        />
      ) : null}

      {cambiando ? (
        <DialogoDeContrasena organizacion={cambiando} onClose={() => setCambiando(null)} />
      ) : null}
    </>
  );
};
