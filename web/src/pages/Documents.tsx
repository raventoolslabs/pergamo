import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { DocumentList, DocumentQuery } from '../api/types';
import { UploadDialog } from '../components/UploadDialog';
import { useToast } from '../components/toast';
import {
  AvisoDeError, Cargando, Marca, VEREDICTO, Vacio, formatearFecha, mensajeDeError
} from '../components/ui';

const POR_PAGINA = 25;

const FILTROS_VACIOS: DocumentQuery = {
  name: '', tag: '', scan_status: '', sort: 'creation_date', order: 'desc'
};

/**
 * Cuenta el fondo en una frase.
 *
 * Una fila de tarjetas con metricas es el tratamiento por defecto de cualquier
 * panel; aqui el mismo dato cabe en una linea y suena a lo que es: el estado de
 * custodia del fondo.
 */
const resumen = (total: number, sinVerificar: number) => {
  if (!total) return 'Todavía no hay nada depositado.';

  const documentos = `${total} documento${total === 1 ? '' : 's'}`;

  if (!sinVerificar) return `${documentos}, todos verificados.`;

  return `${documentos}. ${sinVerificar} sin descarga disponible.`;
};

export const Documents = () => {

  const toast = useToast();

  const [filtros, setFiltros] = useState<DocumentQuery>(FILTROS_VACIOS);
  const [desde, setDesde] = useState(0);
  const [datos, setDatos] = useState<DocumentList | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCargando(true);

    // Espera antes de consultar mientras se escribe: sin esto, cada tecla
    // lanzaria una consulta con COUNT sobre la tabla de documentos.
    const temporizador = setTimeout(() => {
      api.documents({ ...filtros, limit: POR_PAGINA, offset: desde })
        .then((resultado) => { if (vivo) { setDatos(resultado); setError(null); } })
        .catch((fallo) => { if (vivo) setError(fallo); })
        .finally(() => { if (vivo) setCargando(false); });
    }, filtros.name || filtros.tag ? 300 : 0);

    return () => { vivo = false; clearTimeout(temporizador); };
  }, [filtros, desde, recarga]);

  const actualizar = (cambio: Partial<DocumentQuery>) => {
    // Cualquier cambio de filtro vuelve a la primera pagina: mantener el
    // desplazamiento dejaria la lista vacia sin motivo aparente.
    setDesde(0);
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
  const sinVerificar = documentos.filter((documento) => documento.scan_status !== 'clean').length;
  const filtrado = !!(filtros.name || filtros.tag || filtros.scan_status);
  // Sin documentos y sin filtro puesto no hay nada que filtrar: los campos
  // sobran y solo entorpecen el camino al primer deposito.
  const hayQueFiltrar = filtrado || documentos.length > 0;
  const cabeEnUnaPagina = total <= POR_PAGINA;

  return (
    <>
      <div className="encabezado">
        <div className="encabezado__texto">
          <h1>Fondo documental</h1>
          <p>{cargando && !datos ? 'Consultando el fondo…' : resumen(total, sinVerificar)}</p>
        </div>
        <div className="encabezado__acciones">
          <button type="button" className="btn btn--principal" onClick={() => setSubiendo(true)}>
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
          <label htmlFor="filtro-estado">Custodia</label>
          <select
            id="filtro-estado"
            value={filtros.scan_status}
            onChange={(evento) => actualizar({ scan_status: evento.target.value as DocumentQuery['scan_status'] })}
          >
            <option value="">Todos</option>
            <option value="clean">Verificados</option>
            <option value="pending">Sin verificar</option>
            <option value="infected">En cuarentena</option>
            <option value="error">Análisis fallido</option>
          </select>
        </div>

        <div className="campo">
          <label htmlFor="filtro-orden">Orden</label>
          <select
            id="filtro-orden"
            value={`${filtros.sort}:${filtros.order}`}
            onChange={(evento) => {
              const [sort, order] = evento.target.value.split(':');
              actualizar({ sort: sort as DocumentQuery['sort'], order: order as DocumentQuery['order'] });
            }}
          >
            <option value="creation_date:desc">Depósito reciente</option>
            <option value="creation_date:asc">Depósito antiguo</option>
            <option value="modification_date:desc">Cambio reciente</option>
            <option value="modification_date:asc">Cambio antiguo</option>
          </select>
        </div>
      </div>
      ) : null}

      {cargando && !datos ? <Cargando texto="Consultando el fondo…" /> : null}

      {!cargando && !documentos.length ? (
        filtrado
          ? <Vacio titulo="Nada coincide con esta búsqueda">Prueba con otro nombre o quita los filtros para ver el fondo entero.</Vacio>
          : (
            <Vacio titulo="El fondo está vacío">
              Sube el primer documento y Pergamo lo analizará, lo sellará con su huella y
              guardará una versión cada vez que lo reemplaces.
            </Vacio>
          )
      ) : null}

      {documentos.length ? (
        <>
          <div className="registro">
            {documentos.map((documento) => {
              const { metadata } = documento;
              const fichero = `${metadata.name}.${metadata.extension}`;
              const verificado = documento.scan_status === 'clean';

              return (
                <div className="entrada" key={documento.id}>
                  <Marca status={documento.scan_status} />

                  <div className="entrada__titulo">
                    <Link to={`/documento/${documento.id}`}>{metadata.name}</Link>
                    <div className="entrada__pie">
                      <span>{metadata.extension}</span>
                      <span className="mono">{metadata.hash?.slice(0, 8)}</span>
                      {/* Lo verificado no dice nada: es lo normal. Solo se
                          nombra lo que exige atencion, y asi el estado no
                          depende unicamente del color de la marca. */}
                      {verificado ? null : (
                        <span className={`entrada__veredicto entrada__veredicto--${documento.scan_status}`}>
                          {VEREDICTO[documento.scan_status]}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="etiquetas">
                    {(metadata.tags || []).map((etiqueta) => (
                      <span className="etiqueta" key={etiqueta}>{etiqueta}</span>
                    ))}
                  </div>

                  <span className="entrada__fecha">{formatearFecha(documento.creation_date, false)}</span>

                  <span>
                    {verificado ? (
                      <button
                        type="button"
                        className="btn btn--menudo"
                        onClick={() => descargar(documento.id, fichero)}
                      >
                        Descargar
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>

          {cabeEnUnaPagina ? null : (
          <div className="paginacion">
            <span className="paginacion__cuenta">
              {desde + 1}–{Math.min(desde + documentos.length, total)} de {total}
            </span>
            <button
              type="button"
              className="btn btn--menudo"
              onClick={() => setDesde(Math.max(0, desde - POR_PAGINA))}
              disabled={desde === 0 || cargando}
            >Anteriores</button>
            <button
              type="button"
              className="btn btn--menudo"
              onClick={() => setDesde(desde + POR_PAGINA)}
              disabled={desde + documentos.length >= total || cargando}
            >Siguientes</button>
          </div>
          )}
        </>
      ) : null}

      {subiendo ? (
        <UploadDialog
          onClose={() => setSubiendo(false)}
          onUploaded={() => { setDesde(0); refrescar(); toast('Documento subido'); }}
        />
      ) : null}
    </>
  );
};
