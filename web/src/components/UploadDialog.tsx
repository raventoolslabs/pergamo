import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { api } from '../api/client';
import { useConfig } from '../api/config';
import { Aviso, Dialogo, formatearTamano, mensajeDeError } from './ui';

type Estado = 'pendiente' | 'subiendo' | 'done' | 'error';

interface Item {
  fichero: File;
  estado: Estado;
  nota?: string;
}

/**
 * Nombre corriente de un formato.
 *
 * VALID_MIMETYPE es configurable, asi que la lista no se puede cerrar: lo que
 * no este aqui se muestra con su mimetype entero, que sera largo pero es
 * cierto. Recortar por la barra convertia el ODT en
 * «vnd.oasis.opendocument.text», que no le dice nada a nadie.
 */
const FORMATO: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.oasis.opendocument.text': 'ODT',
  'application/vnd.oasis.opendocument.spreadsheet': 'ODS',
  'application/vnd.oasis.opendocument.presentation': 'ODP',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/tiff': 'TIFF',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
  'application/zip': 'ZIP'
};

const formatoDe = (mimetype: string) => FORMATO[mimetype] || mimetype;

/** «PDF y ODT», «PDF, ODT y DOCX». */
const enumerar = (valores: string[]) => {
  if (valores.length < 2) return valores.join('');
  return `${valores.slice(0, -1).join(', ')} y ${valores[valores.length - 1]}`;
};

/**
 * Deposito de documentos.
 *
 * La API acepta un fichero por peticion, asi que varios ficheros se envian en
 * serie: en paralelo, cada uno ocuparia una conexion y un analisis de ClamAV
 * simultaneos, que es justo lo que el escaner peor lleva.
 */
export const UploadDialog = ({ onClose, onUploaded }: {
  onClose: () => void;
  onUploaded: () => void;
}) => {

  const config = useConfig();
  const entrada = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [encima, setEncima] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [subidos, setSubidos] = useState(0);

  /**
   * Comprobacion previa con los mismos limites que aplica el servidor. No
   * sustituye a la suya: solo evita subir 50 MB para recibir un 400.
   */
  const problemaDe = useCallback((fichero: File): string | null => {
    if (!config) return null;

    if (config.max_file_size && fichero.size > config.max_file_size)
      return `Supera los ${formatearTamano(config.max_file_size)}`;

    if (config.valid_mimetype.length && !config.valid_mimetype.includes(fichero.type))
      return fichero.type ? `Tipo no admitido: ${fichero.type}` : 'El navegador no reconoce su tipo';

    return null;
  }, [config]);

  const anadir = useCallback((ficheros: FileList | null) => {
    if (!ficheros?.length) return;

    setItems((actuales) => [
      ...actuales,
      ...Array.from(ficheros).map((fichero): Item => {
        const problema = problemaDe(fichero);
        return problema ? { fichero, estado: 'error', nota: problema } : { fichero, estado: 'pendiente' };
      })
    ]);
  }, [problemaDe]);

  const soltar = (evento: DragEvent) => {
    evento.preventDefault();
    setEncima(false);
    anadir(evento.dataTransfer.files);
  };

  const enviar = async () => {
    setEnviando(true);
    let correctos = 0;

    for (let indice = 0; indice < items.length; indice += 1) {
      if (items[indice].estado !== 'pendiente') continue;

      setItems((actuales) => actuales.map((item, posicion) =>
        posicion === indice ? { ...item, estado: 'subiendo' } : item));

      try {
        await api.upload(items[indice].fichero);
        correctos += 1;
        setItems((actuales) => actuales.map((item, posicion) =>
          posicion === indice ? { ...item, estado: 'done', nota: 'Subido' } : item));
      } catch (fallo) {
        setItems((actuales) => actuales.map((item, posicion) =>
          posicion === indice ? { ...item, estado: 'error', nota: mensajeDeError(fallo) } : item));
      }
    }

    setEnviando(false);
    setSubidos((actual) => actual + correctos);
    // Se refresca el registro aunque alguno haya fallado: los que si entraron
    // deben verse ya.
    if (correctos) onUploaded();
  };

  const pendientes = items.filter((item) => item.estado === 'pendiente').length;
  const admitidos = config?.valid_mimetype.length ? config.valid_mimetype.join(',') : undefined;

  return (
    <Dialogo
      titulo="Subir documento"
      onClose={onClose}
      pie={
        <>
          <button type="button" className="btn" onClick={onClose}>{subidos ? 'Cerrar' : 'Cancelar'}</button>
          <button type="button" className="btn btn--principal" onClick={enviar} disabled={enviando || !pendientes}>
            {enviando
              ? <><span className="girando" aria-hidden="true" /> Subiendo…</>
              : `Subir${pendientes > 1 ? ` ${pendientes}` : ''}`}
          </button>
        </>
      }
    >
      <div className="dialogo__cuerpo">
        <div
          className={`soltar${encima ? ' encima' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => entrada.current?.click()}
          onKeyDown={(evento) => { if (evento.key === 'Enter' || evento.key === ' ') entrada.current?.click(); }}
          onDragOver={(evento) => { evento.preventDefault(); setEncima(true); }}
          onDragLeave={() => setEncima(false)}
          onDrop={soltar}
        >
          <strong>Arrastra los ficheros aquí</strong>
          <span>o pulsa para elegirlos</span>
        </div>

        <input
          ref={entrada}
          type="file"
          multiple
          accept={admitidos}
          hidden
          onChange={(evento) => { anadir(evento.target.files); evento.target.value = ''; }}
        />

        {config && (config.valid_mimetype.length || config.max_file_size) ? (
          <p className="campo__pista">
            {config.valid_mimetype.length
              ? `Se admiten ${enumerar(config.valid_mimetype.map(formatoDe))}. `
              : ''}
            {config.max_file_size ? `Hasta ${formatearTamano(config.max_file_size)} por fichero.` : ''}
          </p>
        ) : null}

        {items.length ? (
          <div className="cola">
            {items.map((item, indice) => (
              <div key={`${item.fichero.name}-${indice}`} className={`cola__item cola__item--${item.estado}`}>
                <span className="cola__nombre">{item.fichero.name}</span>
                <span className="cola__estado">
                  {item.estado === 'subiendo'
                    ? <span className="girando" aria-hidden="true" />
                    : item.nota || formatearTamano(item.fichero.size)}
                </span>
                {item.estado === 'pendiente' && !enviando ? (
                  <button
                    type="button"
                    className="btn btn--plano btn--menudo"
                    onClick={() => setItems((actuales) => actuales.filter((_, posicion) => posicion !== indice))}
                    aria-label={`Quitar ${item.fichero.name}`}
                  >✕</button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <Aviso tipo="info">
          Cada fichero se analiza antes de guardarse. Si el analizador no está disponible, el
          documento se guarda pero no podrá descargarse hasta que un reanálisis lo apruebe.
        </Aviso>
      </div>
    </Dialogo>
  );
};
