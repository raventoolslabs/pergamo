import { useCallback, useState } from 'react';
import type { DragEvent } from 'react';

import { api } from '../api/client';
import { useConfig } from '../api/config';
import { t } from '../i18n';
import { Dialog, Notice, errorMessage, formatSize } from './ui';

type ItemState = 'pending' | 'uploading' | 'done' | 'error';

interface QueueItem {
  file: File;
  state: ItemState;
  note?: string;
}

/**
 * Nombre corriente de un formato. VALID_MIMETYPE es configurable, asi que lo
 * que no este aqui se muestra con su mimetype entero: sera largo, pero es
 * cierto. Recortar por la barra convertia el ODT en
 * «vnd.oasis.opendocument.text».
 *
 * Solo los que el servidor puede verificar por firma: anunciar DOC, XLS o ZIP
 * ofrecia formatos que la subida rechaza con un 400.
 */
const FORMAT: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/rtf': 'RTF',
  'application/epub+zip': 'EPUB',
  'application/vnd.oasis.opendocument.text': 'ODT',
  'application/vnd.oasis.opendocument.spreadsheet': 'ODS',
  'application/vnd.oasis.opendocument.presentation': 'ODP',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX'
};

const formatOf = (mimetype: string) => FORMAT[mimetype] || mimetype;

/** «PDF y ODT», «PDF, ODT y DOCX». */
const listOut = (values: string[]) => {
  if (values.length < 2) return values.join('');
  return `${values.slice(0, -1).join(', ')}${t('upload.listJoin')}${values[values.length - 1]}`;
};

/**
 * La API acepta un fichero por peticion, asi que varios se envian en serie: en
 * paralelo, cada uno ocuparia una conexion y un analisis de ClamAV
 * simultaneos, que es lo que el escaner peor lleva.
 */
export const UploadDialog = ({ onClose, onUploaded }: {
  onClose: () => void;
  onUploaded: () => void;
}) => {

  const config = useConfig();

  const [items, setItems] = useState<QueueItem[]>([]);
  const [indexing, setIndexing] = useState(true);
  const [over, setOver] = useState(false);
  const [sending, setSending] = useState(false);
  // Enviado y con algo que contar: el dialogo deja de pedir ficheros y pasa a
  // ser el resumen de lo que ha pasado con los que se enviaron.
  const [settled, setSettled] = useState(false);

  // Comprobacion previa con los mismos limites que aplica el servidor. No
  // sustituye a la suya: solo evita subir el fichero entero para recibir un 400.
  const problemWith = useCallback((file: File): string | null => {
    if (!config) return null;

    if (config.max_file_size && file.size > config.max_file_size)
      return t('upload.tooLarge', { limit: formatSize(config.max_file_size) });

    if (config.valid_mimetype.length && !config.valid_mimetype.includes(file.type))
      return file.type ? t('upload.badType', { type: file.type }) : t('upload.unknownType');

    return null;
  }, [config]);

  const add = useCallback((files: FileList | null) => {
    if (!files?.length) return;

    // La lista se copia antes de tocar el estado: el input se limpia nada mas
    // volver de elegir, y su FileList no puede quedar a merced de cuando React
    // ejecute el actualizador.
    const queued = Array.from(files).map((file): QueueItem => {
      const problem = problemWith(file);
      return problem ? { file, state: 'error', note: problem } : { file, state: 'pending' };
    });

    setItems((current) => [...current, ...queued]);
  }, [problemWith]);

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    add(event.dataTransfer.files);
  };

  const submit = async () => {
    setSending(true);
    let succeeded = 0;
    // Los rechazados antes de enviarse ya cuentan: si hay alguno, el dialogo se
    // queda abierto para que se vea cual.
    let failed = items.filter((item) => item.state === 'error').length;

    // La casilla viene marcada, pero pedir indexacion donde no la hay es un 400.
    const wantIndex = indexing && config?.indexing_enabled === true;

    for (let index = 0; index < items.length; index += 1) {
      if (items[index].state !== 'pending') continue;

      setItems((current) => current.map((item, position) =>
        position === index ? { ...item, state: 'uploading' } : item));

      try {
        await api.upload(items[index].file, wantIndex);
        succeeded += 1;
        setItems((current) => current.map((item, position) =>
          position === index ? { ...item, state: 'done', note: t('upload.done') } : item));
      } catch (failure) {
        failed += 1;
        setItems((current) => current.map((item, position) =>
          position === index ? { ...item, state: 'error', note: errorMessage(failure) } : item));
      }
    }

    setSending(false);
    setSettled(true);
    // Se refresca aunque alguno haya fallado: los que si entraron deben verse.
    if (succeeded) onUploaded();
    // Sin nada que mirar el dialogo estorba; con un error se queda, porque el
    // motivo solo se cuenta aqui.
    if (succeeded && !failed) onClose();
  };

  const pending = items.filter((item) => item.state === 'pending').length;
  const accept = config?.valid_mimetype.length ? config.valid_mimetype.join(',') : undefined;

  return (
    <Dialog
      title={t('upload.title')}
      onClose={onClose}
      footer={
        settled ? (
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t('common.close')}
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn--primary" onClick={submit} disabled={sending || !pending}>
              {sending
                ? <><span className="spinner" aria-hidden="true" /> {t('upload.submitting')}</>
                : pending > 1 ? t('upload.submitCount', { count: pending }) : t('upload.submit')}
            </button>
          </>
        )
      }
    >
      <div className="dialog__body">
        {/* Una etiqueta con el input dentro, y no un div que llama a click():
            un input `hidden` no responde a la llamada en todos los navegadores,
            y asi abre el selector el propio navegador. */}
        {settled ? null : (
          <label
            className={`dropzone${over ? ' over' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={drop}
          >
            <strong>{t('upload.dropHere')}</strong>
            <span>{t('upload.orClick')}</span>

            <input
              className="sr-only"
              type="file"
              multiple
              accept={accept}
              onChange={(event) => { add(event.target.files); event.target.value = ''; }}
            />
          </label>
        )}

        {!settled && config && (config.valid_mimetype.length || config.max_file_size) ? (
          <p className="field__hint">
            {config.valid_mimetype.length
              ? t('upload.accepted', { formats: listOut(config.valid_mimetype.map(formatOf)) })
              : ''}
            {config.max_file_size ? t('upload.maxSize', { limit: formatSize(config.max_file_size) }) : ''}
          </p>
        ) : null}

        {/* Solo si el despliegue indexa: una casilla que siempre devuelve un 400
            es peor que no ofrecer la funcionalidad. */}
        {!settled && config?.indexing_enabled ? (
          <label className="check">
            <input
              type="checkbox"
              checked={indexing}
              disabled={sending}
              onChange={(event) => setIndexing(event.target.checked)}
            />
            <span>
              <strong>{t('upload.index')}</strong>
              {t('upload.indexHint')}
            </span>
          </label>
        ) : null}

        {items.length ? (
          <div className="queue">
            {items.map((item, index) => (
              <div key={`${item.file.name}-${index}`} className={`queue__item queue__item--${item.state}`}>
                <span className="queue__name">{item.file.name}</span>
                <span className="queue__status">
                  {item.state === 'uploading'
                    ? <span className="spinner" aria-hidden="true" />
                    : item.note || formatSize(item.file.size)}
                </span>
                {item.state === 'pending' && !sending ? (
                  <button
                    type="button"
                    className="btn btn--flat btn--tiny"
                    onClick={() => setItems((current) => current.filter((_, position) => position !== index))}
                    aria-label={t('common.remove', { name: item.file.name })}
                  >✕</button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {/* Solo cuando este despliegue no analiza: que analice es lo que se
            espera, y repetirlo en cada subida no dice nada. */}
        {!settled && config?.enable_antivirus === false ? (
          <Notice kind="warn">{t('upload.antivirusOff')}</Notice>
        ) : null}
      </div>
    </Dialog>
  );
};
