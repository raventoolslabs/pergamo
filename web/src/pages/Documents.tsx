import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { DocumentList, DocumentQuery } from '../api/types';
import { UploadDialog } from '../components/UploadDialog';
import { useToast } from '../components/toast';
import {
  AvisoDeError, Cargando, ESTADO, POR_PAGINA, Paginacion, Vacio, Veredicto,
  formatearFecha, formatearTamano, mensajeDeError
} from '../components/ui';

/**
 * Estados tal y como los ofrece el filtro: tres, no los cuatro de la base.
 * 'En cuarentena' pide los dos que bloquean por algo que hay que mirar, porque
 * si solo pidiera 'infected' la mitad de lo que la tabla marca en ambar seria
 * imposible de encontrar.
 */
const ESTADOS_FILTRO = [
  { valor: '', texto: 'Todos' },
  { valor: 'clean', texto: 'Analizado' },
  { valor: 'pending', texto: 'Sin analizar' },
  { valor: 'infected,error', texto: 'En cuarentena' }
];

const FILTROS_VACIOS: DocumentQuery = {
  name: '', tag: '', scan_status: '', from: '', to: '', sort: 'creation_date', order: 'desc'
};

/**
 * Cuenta el fondo en una frase.
 *
 * Una fila de tarjetas con metricas es el tratamiento por defecto de cualquier
 * panel; aqui el mismo dato cabe en una linea y suena a lo que es: el estado de
 * custodia del fondo.
 */
const resumen = (total: number, analizados: number) => {
  if (!total) return 'Todavía no hay nada depositado.';

  const documentos = `${total} documento${total === 1 ? '' : 's'} depositado${total === 1 ? '' : 's'}`;

  return `${documentos} · ${analizados} analizado${analizados === 1 ? '' : 's'}.`;
};

/**
 * Un valor de <input type="datetime-local"> es hora local sin zona, y
 * creation_date se guarda en UTC. Sin convertir, el filtro se desplazaria tantas
 * horas como diferencia tenga el navegador con el servidor.
 */
const comoInstante = (local: string) => {
  if (!local) return '';

  const fecha = new Date(local);

  return Number.isNaN(fecha.getTime()) ? '' : fecha.toISOString();
};

const IconoSubir = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 19V5" /><path d="M6 11l6-6 6 6" />
  </svg>
);

const IconoDescargar = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 19.5h14" />
  </svg>
);

export const Documents = () => {

  const toast = useToast();

  const [filtros, setFiltros] = useState<DocumentQuery>(FILTROS_VACIOS);
  const [porPagina, setPorPagina] = useState(POR_PAGINA[0]);
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<DocumentList | null>(null);
  const [fondo, setFondo] = useState<{ total: number; analizados: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const desde = (pagina - 1) * porPagina;

  useEffect(() => {
    let vivo = true;
    setCargando(true);

    // Espera antes de consultar mientras se escribe: sin esto, cada tecla
    // lanzaria una consulta con COUNT sobre la tabla de documentos.
    const temporizador = setTimeout(() => {
      api.documents({
        ...filtros,
        from: comoInstante(filtros.from || ''),
        to: comoInstante(filtros.to || ''),
        limit: porPagina,
        offset: desde
      })
        .then((resultado) => { if (vivo) { setDatos(resultado); setError(null); } })
        .catch((fallo) => { if (vivo) setError(fallo); })
        .finally(() => { if (vivo) setCargando(false); });
    }, filtros.name || filtros.tag ? 300 : 0);

    return () => { vivo = false; clearTimeout(temporizador); };
  }, [filtros, desde, porPagina, recarga]);

  // El subtitulo habla del fondo entero: ni de la pagina que se esta mirando
  // —contar sobre las filas recibidas daria "8 analizados" en cualquier fondo de
  // mas de ocho— ni del filtro puesto, que cambia lo que se busca y no lo que
  // hay depositado. Son dos recuentos sin filtrar y sin traer una sola fila.
  useEffect(() => {
    let vivo = true;

    Promise.all([
      api.documents({ limit: 1 }),
      api.documents({ scan_status: 'clean', limit: 1 })
    ])
      .then(([todo, limpios]) => { if (vivo) setFondo({ total: todo.total, analizados: limpios.total }); })
      .catch(() => { if (vivo) setFondo(null); });

    return () => { vivo = false; };
  }, [recarga]);

  const actualizar = (cambio: Partial<DocumentQuery>) => {
    // Cualquier cambio de filtro vuelve a la primera pagina: mantener el
    // desplazamiento dejaria la lista vacia sin motivo aparente.
    setPagina(1);
    setFiltros((actuales) => ({ ...actuales, ...cambio }));
  };

  const refrescar = useCallback(() => setRecarga((valor) => valor + 1), []);

  const descargar = async (id: string, nombre: string) => {
    try {
      await api.download(id, nombre);
    } catch (fallo) {
      toast(mensajeDeError(fallo), 'error');
    }
  };

  const total = datos?.total ?? 0;
  const documentos = datos?.documents ?? [];
  const filtrado = !!(filtros.name || filtros.tag || filtros.scan_status || filtros.from || filtros.to);
  // Sin documentos y sin filtro puesto no hay nada que filtrar: los campos
  // sobran y solo entorpecen el camino al primer deposito.
  const hayQueFiltrar = filtrado || documentos.length > 0;

  return (
    <>
      <div className="encabezado">
        <div className="encabezado__texto">
          <h1>Documentos</h1>
          <p>
            {fondo ? resumen(fondo.total, fondo.analizados) : 'Consultando el fondo…'}
          </p>
        </div>
        <div className="encabezado__acciones">
          <button type="button" className="btn btn--principal" onClick={() => setSubiendo(true)}>
            <IconoSubir />
            Subir documento
          </button>
        </div>
      </div>

      <AvisoDeError error={error} />

      {hayQueFiltrar ? (
      <div className="filtros">
        <div className="campo">
          <label htmlFor="filtro-nombre">Buscar</label>
          <input
            id="filtro-nombre"
            type="search"
            placeholder="Nombre del documento"
            value={filtros.name}
            onChange={(evento) => actualizar({ name: evento.target.value })}
          />
        </div>

        <div className="campo">
          <label htmlFor="filtro-etiqueta">Etiqueta</label>
          <input
            id="filtro-etiqueta"
            type="search"
            placeholder="Exacta"
            value={filtros.tag}
            onChange={(evento) => actualizar({ tag: evento.target.value })}
          />
        </div>

        <div className="campo">
          <label htmlFor="filtro-estado">Analizado</label>
          <select
            id="filtro-estado"
            value={filtros.scan_status}
            onChange={(evento) => actualizar({ scan_status: evento.target.value })}
          >
            {ESTADOS_FILTRO.map((estado) => (
              <option value={estado.valor} key={estado.texto}>{estado.texto}</option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="filtro-desde">Fecha/hora desde</label>
          <input
            id="filtro-desde"
            type="datetime-local"
            value={filtros.from}
            onChange={(evento) => actualizar({ from: evento.target.value })}
          />
        </div>

        <div className="campo">
          <label htmlFor="filtro-hasta">Fecha/hora hasta</label>
          <input
            id="filtro-hasta"
            type="datetime-local"
            value={filtros.to}
            onChange={(evento) => actualizar({ to: evento.target.value })}
          />
        </div>
      </div>
      ) : null}

      {cargando && !datos ? <Cargando texto="Consultando el fondo…" /> : null}

      {!cargando && !documentos.length && !filtrado ? (
        <Vacio titulo="El fondo está vacío">
          Sube el primer documento y Pergamo lo analizará, lo sellará con su huella y
          guardará una versión cada vez que lo reemplaces.
        </Vacio>
      ) : null}

      {documentos.length || filtrado ? (
        <>
          <div className="resultado">
            <span className="resultado__cuenta">
              {filtrado
                ? `${total} documento${total === 1 ? '' : 's'} coincide${total === 1 ? '' : 'n'}`
                : `${total} documento${total === 1 ? '' : 's'}`}
            </span>
            {filtrado ? (
              <button
                type="button"
                className="btn btn--pill"
                onClick={() => { setPagina(1); setFiltros(FILTROS_VACIOS); }}
              >Limpiar filtros</button>
            ) : null}
          </div>

          <div className="registro">
            <div className="registro__cabecera">
              <span>Documento</span>
              <span>Etiqueta</span>
              <span>Analizado</span>
              <span>Depósito</span>
              <span />
            </div>

            {documentos.map((documento) => {
              const { metadata } = documento;
              const fichero = `${metadata.name}.${metadata.extension}`;
              const verificado = documento.scan_status === 'clean';

              return (
                <div className="entrada" key={documento.id}>
                  <div className="entrada__titulo">
                    <Link to={`/documento/${documento.id}`}>{metadata.name}</Link>
                    <div className="entrada__pie">
                      <span>{metadata.extension}</span>
                      <span>{metadata.hash?.slice(0, 8)}</span>
                      {/* Los documentos anteriores a que se guardara el tamano
                          no lo tienen: mejor sin el dato que con un cero. */}
                      {typeof metadata.size === 'number' ? <span>{formatearTamano(metadata.size)}</span> : null}
                    </div>
                  </div>

                  <div className="etiquetas">
                    {(metadata.tags || []).map((etiqueta) => (
                      <span className="etiqueta" key={etiqueta}>{etiqueta}</span>
                    ))}
                  </div>

                  <Veredicto status={documento.scan_status} />

                  <span className="entrada__fecha">
                    {formatearFecha(documento.creation_date, true, '·')}
                  </span>

                  <span className="entrada__accion">
                    {/* Lo que no esta analizado no se descarga: el backend
                        responde 423. El boton se queda, deshabilitado y con el
                        motivo, porque quitarlo dejaba la columna vacia sin
                        decir por que. */}
                    <button
                      type="button"
                      className="btn btn--icono"
                      aria-label={`Descargar ${metadata.name}`}
                      title={verificado ? 'Descargar' : ESTADO[documento.scan_status]?.explicacion}
                      disabled={!verificado}
                      onClick={() => descargar(documento.id, fichero)}
                    >
                      <IconoDescargar />
                    </button>
                  </span>
                </div>
              );
            })}

            {!cargando && !documentos.length ? (
              <Vacio titulo="Sin resultados" centrado>
                Ajusta la búsqueda, la etiqueta o el rango de fechas.
              </Vacio>
            ) : null}
          </div>

          <Paginacion
            total={total}
            mostrados={documentos.length}
            pagina={pagina}
            porPagina={porPagina}
            ocupado={cargando}
            onPagina={setPagina}
            onPorPagina={(cuantos) => { setPagina(1); setPorPagina(cuantos); }}
          />
        </>
      ) : null}

      {subiendo ? (
        <UploadDialog
          onClose={() => setSubiendo(false)}
          onUploaded={() => { setPagina(1); refrescar(); toast('Documento subido'); }}
        />
      ) : null}
    </>
  );
};
