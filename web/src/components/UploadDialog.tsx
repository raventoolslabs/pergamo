import { useCallback, useRef, useState } from 'react';
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
 */
const FORMAT: Record<string, string> = {
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
  const input = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<QueueItem[]>([]);
  const [over, setOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploaded, setUploaded] = useState(0);

  // Comprobacion previa con los mismos limites que aplica el servidor. No
  // sustituye a la suya: solo evita subir 50 MB para recibir un 400.
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

    setItems((current) => [
      ...current,
      ...Array.from(files).map((file): QueueItem => {
        const problem = problemWith(file);
        return problem ? { file, state: 'error', note: problem } : { file, state: 'pending' };
      })
    ]);
  }, [problemWith]);

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    add(event.dataTransfer.files);
  };

  const submit = async () => {
    setSending(true);
    let succeeded = 0;

    for (let index = 0; index < items.length; index += 1) {
      if (items[index].state !== 'pending') continue;

      setItems((current) => current.map((item, position) =>
        position === index ? { ...item, state: 'uploading' } : item));

      try {
        await api.upload(items[index].file);
        succeeded += 1;
        setItems((current) => current.map((item, position) =>
          position === index ? { ...item, state: 'done', note: t('upload.done') } : item));
      } catch (failure) {
        setItems((current) => current.map((item, position) =>
          position === index ? { ...item, state: 'error', note: errorMessage(failure) } : item));
      }
    }

    setSending(false);
    setUploaded((current) => current + succeeded);
    // Se refresca aunque alguno haya fallado: los que si entraron deben verse.
    if (succeeded) onUploaded();
  };

  const pending = items.filter((item) => item.state === 'pending').length;
  const accept = config?.valid_mimetype.length ? config.valid_mimetype.join(',') : undefined;

  return (
    <Dialog
      title={t('upload.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {uploaded ? t('common.close') : t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={sending || !pending}>
            {sending
              ? <><span className="spinner" aria-hidden="true" /> {t('upload.submitting')}</>
              : pending > 1 ? t('upload.submitCount', { count: pending }) : t('upload.submit')}
          </button>
        </>
      }
    >
      <div className="dialog__body">
        <div
          className={`dropzone${over ? ' over' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') input.current?.click(); }}
          onDragOver={(event) => { event.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          <strong>{t('upload.dropHere')}</strong>
          <span>{t('upload.orClick')}</span>
        </div>

        <input
          ref={input}
          type="file"
          multiple
          accept={accept}
          hidden
          onChange={(event) => { add(event.target.files); event.target.value = ''; }}
        />

        {config && (config.valid_mimetype.length || config.max_file_size) ? (
          <p className="field__hint">
            {config.valid_mimetype.length
              ? t('upload.accepted', { formats: listOut(config.valid_mimetype.map(formatOf)) })
              : ''}
            {config.max_file_size ? t('upload.maxSize', { limit: formatSize(config.max_file_size) }) : ''}
          </p>
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

        {/* No se promete lo que este despliegue no hace: con el antivirus
            apagado el fichero entra tal cual. */}
        <Notice kind={config?.enable_antivirus === false ? 'warn' : 'info'}>
          {config?.enable_antivirus === false ? t('upload.antivirusOff') : t('upload.antivirusOn')}
        </Notice>
      </div>
    </Dialog>
  );
};
