import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client';
import { useConfig } from '../api/config';
import type { DocumentMetadata, DocumentVersion, ScanInfo } from '../api/types';
import { useToast } from '../components/toast';
import {
  Aviso, AvisoDeError, CampoEtiquetas, Cargando, Dato, Dialogo, VEREDICTO,
  formatearFecha, mensajeDeError
} from '../components/ui';

/** Claves que fija el propio Pergamo al guardar: se muestran, no se editan. */
const DE_SISTEMA = [
  'uuid', 'uuid_sha256', 'organization', 'creation_date',
  'hash', 'mimetype', 'extension', 'original_name'
];

/**
 * Nombres de los campos editables en lenguaje de quien los rellena. Las claves
 * son las de VALID_METADATA_MODIFY, que es configurable, asi que lo que no
 * este aqui se muestra con su clave tal cual.
 */
const NOMBRE_DE_CAMPO: Record<string, string> = {
  name: 'Nombre',
  description: 'Descripción',
  tags: 'Etiquetas'
};

const comoEtiquetas = (valor: unknown): string[] =>
  Array.isArray(valor) ? valor.filter((item): item is string => typeof item === 'string') : [];

export const DocumentDetail = () => {

  const { id = '' } = useParams();
  const navegar = useNavigate();
  const toast = useToast();
  const config = useConfig();
  const entradaReemplazo = useRef<HTMLInputElement>(null);

  const [metadatos, setMetadatos] = useState<DocumentMetadata | null>(null);
  const [analisis, setAnalisis] = useState<ScanInfo | null>(null);
  const [versiones, setVersiones] = useState<DocumentVersion[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cargando, setCargando] = useState(true);

  const [borrador, setBorrador] = useState<Record<string, unknown>>({});
  const [guardando, setGuardando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const editables = useMemo(() => config?.valid_metadata_modify ?? [], [config]);

  const cargar = useCallback(async () => {
    setCargando(true);

    try {
      // El estado de analisis y las versiones viven en endpoints propios: se
      // piden a la vez para no encadenar tres esperas.
      const [documento, sello, listaVersiones] = await Promise.all([
        api.document(id),
        api.scan(id),
        api.versions(id).catch(() => [] as DocumentVersion[])
      ]);

      setMetadatos(documento);
      setAnalisis(sello);
      setVersiones(listaVersiones);
      setError(null);
    } catch (fallo) {
      setError(fallo);
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => { void cargar(); }, [cargar]);

  const reiniciarBorrador = useCallback(() => {
    if (!metadatos) return;

    setBorrador(editables.reduce((valores, clave) => ({
      ...valores,
      [clave]: clave === 'tags' ? comoEtiquetas(metadatos.tags) : (metadatos[clave] ?? '')
    }), {} as Record<string, unknown>));
  }, [metadatos, editables]);

  // El borrador se rehace cada vez que llegan metadatos nuevos, para no dejar
  // en pantalla valores de una version anterior del documento.
  useEffect(reiniciarBorrador, [reiniciarBorrador]);

  const hayCambios = useMemo(() => {
    if (!metadatos) return false;
    return editables.some((clave) => {
      const original = clave === 'tags' ? comoEtiquetas(metadatos.tags) : (metadatos[clave] ?? '');
      return JSON.stringify(original) !== JSON.stringify(borrador[clave] ?? (clave === 'tags' ? [] : ''));
    });
  }, [borrador, metadatos, editables]);

  const guardar = async () => {
    setGuardando(true);

    try {
      setMetadatos(await api.updateMetadata(id, borrador));
      toast('Cambios guardados');
    } catch (fallo) {
      toast(mensajeDeError(fallo), 'error');
    } finally {
      setGuardando(false);
    }
  };

  const descargar = async () => {
    setOcupado('descarga');

    try {
      await api.download(id, `${metadatos?.name}.${metadatos?.extension}`);
    } catch (fallo) {
      toast(mensajeDeError(fallo), 'error');
    } finally {
      setOcupado(null);
    }
  };

  const reemplazar = async (fichero: File) => {
    // La API rechaza un reemplazo con otro mimetype. Avisar aqui evita subir el
    // fichero entero para recibir un 400.
    if (metadatos && fichero.type !== metadatos.mimetype) {
      toast(`El reemplazo debe ser del mismo tipo que el original: ${metadatos.mimetype}`, 'error');
      return;
    }

    setOcupado('reemplazo');

    try {
      await api.replaceFile(id, fichero);
      await cargar();
      toast('Fichero reemplazado');
    } catch (fallo) {
      toast(mensajeDeError(fallo), 'error');
    } finally {
      setOcupado(null);
    }
  };

  const eliminar = async () => {
    setOcupado('borrado');

    try {
      await api.remove(id);
      toast('Documento eliminado');
      navegar('/');
    } catch (fallo) {
      setConfirmando(false);
      toast(mensajeDeError(fallo), 'error');
    } finally {
      setOcupado(null);
    }
  };

  if (cargando && !metadatos) return <Cargando texto="Abriendo el documento…" />;

  if (!metadatos) {
    return (
      <>
        <AvisoDeError error={error} />
        <p className="separado"><Link to="/">Volver al fondo documental</Link></p>
      </>
    );
  }

  const fichero = `${metadatos.name}.${metadatos.extension}`;
  const estado = analisis?.scan_status ?? 'pending';
  const verificado = estado === 'clean';

  const otrosCampos = Object.entries(metadatos).filter(([clave]) =>
    !DE_SISTEMA.includes(clave) && !editables.includes(clave) && clave !== 'name' && clave !== 'tags');

  return (
    <>
      <Link to="/" className="volver">Volver al fondo documental</Link>

      <div className="encabezado">
        <div className="encabezado__texto">
          <h1>{metadatos.name}</h1>
          <p>{fichero}</p>
        </div>
        <div className="encabezado__acciones">
          {/* En cuarentena no hay boton deshabilitado: hay una explicacion. Un
              boton que no responde obliga a adivinar por que. */}
          {verificado ? (
            <button type="button" className="btn btn--principal" onClick={descargar} disabled={ocupado === 'descarga'}>
              {ocupado === 'descarga' ? <><span className="girando" aria-hidden="true" /> Descargando…</> : 'Descargar'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            onClick={() => entradaReemplazo.current?.click()}
            disabled={ocupado === 'reemplazo'}
          >
            {ocupado === 'reemplazo' ? <><span className="girando" aria-hidden="true" /> Reemplazando…</> : 'Reemplazar fichero'}
          </button>
          <button type="button" className="btn btn--riesgo" onClick={() => setConfirmando(true)}>Eliminar</button>
        </div>
      </div>

      <input
        ref={entradaReemplazo}
        type="file"
        hidden
        accept={metadatos.mimetype}
        onChange={(evento) => {
          const elegido = evento.target.files?.[0];
          evento.target.value = '';
          if (elegido) void reemplazar(elegido);
        }}
      />

      <AvisoDeError error={error} />

      <div className="ficha">
        {/*
          * El sello: la huella SHA-256 es lo unico que acredita que el
          * contenido no ha cambiado desde que se deposito, asi que se compone
          * como un sello y no como una linea gris al fondo de una tabla.
          */}
        <div className={`sello sello--${estado}`}>
          <div className="sello__huella">{metadatos.hash?.slice(0, 8)}</div>
          <div className="sello__veredicto">{VEREDICTO[estado]}</div>
          {analisis?.scan_signature ? <div className="sello__detalle">{analisis.scan_signature}</div> : null}
          {analisis?.scan_engine ? <div className="sello__detalle">{analisis.scan_engine}</div> : null}
          {analisis?.scan_date ? <div className="sello__detalle">{formatearFecha(analisis.scan_date, false)}</div> : null}
          <div className="sello__completo">{metadatos.hash}</div>
        </div>

        <div>
          <dl className="datos">
            <Dato termino="Nombre original">{metadatos.original_name || '—'}</Dato>
            <Dato termino="Tipo">{metadatos.mimetype}</Dato>
            <Dato termino="Depositado">{formatearFecha(metadatos.creation_date ? Number.parseFloat(String(metadatos.creation_date)) : null)}</Dato>
            <Dato termino="Identificador"><span className="mono">{metadatos.uuid}</span></Dato>
            {otrosCampos.map(([clave, valor]) => (
              <Dato termino={clave} key={clave}>{String(valor)}</Dato>
            ))}
          </dl>

          {!verificado ? (
            <div className="separado">
              <Aviso tipo={estado === 'infected' ? 'error' : 'warn'}>
                {estado === 'infected'
                  ? 'El análisis encontró una firma conocida en este fichero, así que Pergamo no lo entrega. Sus metadatos siguen disponibles, y un reanálisis puede liberarlo si resulta ser un falso positivo.'
                  : 'Este fichero se guardó sin poder analizarse. No se entrega hasta que un reanálisis lo apruebe.'}
              </Aviso>
            </div>
          ) : null}
        </div>
      </div>

      <section className="seccion">
        <h2>Metadatos</h2>
        <p className="seccion__nota">
          {editables.length
            ? 'Los campos que este servidor permite modificar. El resto los fija Pergamo al guardar el fichero.'
            : 'Este servidor no permite modificar ningún campo.'}
        </p>

        {editables.length ? (
          <div className="formulario">
            {editables.map((clave) => (
              <div className="campo" key={clave}>
                <label htmlFor={`meta-${clave}`}>{NOMBRE_DE_CAMPO[clave] || clave}</label>
                {clave === 'tags' ? (
                  <CampoEtiquetas
                    id={`meta-${clave}`}
                    value={comoEtiquetas(borrador.tags)}
                    onChange={(etiquetas) => setBorrador((actual) => ({ ...actual, tags: etiquetas }))}
                  />
                ) : (
                  <input
                    id={`meta-${clave}`}
                    type="text"
                    value={String(borrador[clave] ?? '')}
                    onChange={(evento) => setBorrador((actual) => ({ ...actual, [clave]: evento.target.value }))}
                  />
                )}
              </div>
            ))}

            <div className="encabezado__acciones">
              <button type="button" className="btn btn--principal" onClick={guardar} disabled={!hayCambios || guardando}>
                {guardando ? <><span className="girando" aria-hidden="true" /> Guardando…</> : 'Guardar cambios'}
              </button>
              <button type="button" className="btn" onClick={reiniciarBorrador} disabled={!hayCambios || guardando}>
                Descartar
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="seccion">
        <h2>Versiones anteriores</h2>
        <p className="seccion__nota">
          {versiones?.length
            ? 'Pergamo conserva estas copias en disco. La API no ofrece descargarlas: solo pueden recuperarse desde el servidor.'
            : `Se guarda una copia cada vez que reemplazas el fichero${config?.max_version_file ? `, hasta ${config.max_version_file}` : ''}.`}
        </p>

        {versiones?.length ? (
          <div className="desliza">
            <table className="tabla">
              <thead><tr><th>Versión</th><th>Guardada</th></tr></thead>
              <tbody>
                {versiones.map((version) => (
                  <tr key={version.version}>
                    <td>{version.version}</td>
                    <td>{formatearFecha(version.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {confirmando ? (
        <Dialogo
          titulo="Eliminar documento"
          onClose={() => setConfirmando(false)}
          pie={
            <>
              <button type="button" className="btn" onClick={() => setConfirmando(false)}>Cancelar</button>
              <button type="button" className="btn btn--riesgo" onClick={eliminar} disabled={ocupado === 'borrado'}>
                {ocupado === 'borrado' ? <><span className="girando" aria-hidden="true" /> Eliminando…</> : 'Eliminar'}
              </button>
            </>
          }
        >
          <div className="dialogo__cuerpo">
            <p>Se eliminan <strong>{fichero}</strong> y todas sus versiones guardadas.</p>
            <Aviso tipo="warn">Esto no se puede deshacer.</Aviso>
          </div>
        </Dialogo>
      ) : null}
    </>
  );
};
