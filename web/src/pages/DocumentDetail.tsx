import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client';
import { useConfig } from '../api/config';
import type { DocumentMetadata, DocumentVersion, ScanInfo } from '../api/types';
import { useToast } from '../components/toast';
import {
  Datum, Dialog, ErrorNotice, Loading, Notice, TagsField, VERDICT,
  errorMessage, formatDate, formatSize, isDeliverable, verdictOf
} from '../components/ui';
import { t } from '../i18n';

/** Claves que fija el propio Pergamo al guardar: se muestran, no se editan. */
const SYSTEM_FIELDS = [
  'uuid', 'uuid_sha256', 'organization', 'creation_date',
  'hash', 'mimetype', 'extension', 'original_name', 'size'
];

/**
 * Nombres de los campos editables. Las claves son las de VALID_METADATA_MODIFY,
 * que es configurable, asi que lo que no este aqui se muestra tal cual.
 */
const FIELD_LABEL: Record<string, string> = {
  name: t('detail.fieldName'),
  description: t('detail.fieldDescription'),
  tags: t('detail.fieldTags')
};

const asTags = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export const DocumentDetail = () => {

  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const config = useConfig();
  const replacementInput = useRef<HTMLInputElement>(null);

  const [metadata, setMetadata] = useState<DocumentMetadata | null>(null);
  const [scanInfo, setScanInfo] = useState<ScanInfo | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const editable = useMemo(() => config?.valid_metadata_modify ?? [], [config]);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      // El estado de analisis y las versiones viven en endpoints propios: se
      // piden a la vez para no encadenar tres esperas.
      const [document, scan, versionList] = await Promise.all([
        api.document(id),
        api.scan(id),
        api.versions(id).catch(() => [] as DocumentVersion[])
      ]);

      setMetadata(document);
      setScanInfo(scan);
      setVersions(versionList);
      setError(null);
    } catch (failure) {
      setError(failure);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const resetDraft = useCallback(() => {
    if (!metadata) return;

    setDraft(editable.reduce((values, key) => ({
      ...values,
      [key]: key === 'tags' ? asTags(metadata.tags) : (metadata[key] ?? '')
    }), {} as Record<string, unknown>));
  }, [metadata, editable]);

  // El borrador se rehace cada vez que llegan metadatos nuevos, para no dejar en
  // pantalla valores de una version anterior.
  useEffect(resetDraft, [resetDraft]);

  const hasChanges = useMemo(() => {
    if (!metadata) return false;
    return editable.some((key) => {
      const original = key === 'tags' ? asTags(metadata.tags) : (metadata[key] ?? '');
      return JSON.stringify(original) !== JSON.stringify(draft[key] ?? (key === 'tags' ? [] : ''));
    });
  }, [draft, metadata, editable]);

  const save = async () => {
    setSaving(true);

    try {
      setMetadata(await api.updateMetadata(id, draft));
      toast(t('detail.saved'));
    } catch (failure) {
      toast(errorMessage(failure), 'error');
    } finally {
      setSaving(false);
    }
  };

  const download = async () => {
    setBusy('download');

    try {
      await api.download(id, `${metadata?.name}.${metadata?.extension}`);
    } catch (failure) {
      toast(errorMessage(failure), 'error');
    } finally {
      setBusy(null);
    }
  };

  const replace = async (file: File) => {
    // La API rechaza un reemplazo con otro mimetype: avisar aqui evita subir el
    // fichero entero para recibir un 400.
    if (metadata && file.type !== metadata.mimetype) {
      toast(t('detail.replaceTypeMismatch', { mimetype: metadata.mimetype }), 'error');
      return;
    }

    setBusy('replace');

    try {
      await api.replaceFile(id, file);
      await load();
      toast(t('detail.replaced'));
    } catch (failure) {
      toast(errorMessage(failure), 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');

    try {
      await api.remove(id);
      toast(t('detail.deleted'));
      navigate('/');
    } catch (failure) {
      setConfirming(false);
      toast(errorMessage(failure), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !metadata) return <Loading text={t('detail.opening')} />;

  if (!metadata) {
    return (
      <>
        <ErrorNotice error={error} />
        <p className="spaced"><Link to="/">{t('detail.back')}</Link></p>
      </>
    );
  }

  const filename = `${metadata.name}.${metadata.extension}`;

  // Dos preguntas distintas. `downloadable` es la del backend —¿se entrega?— y
  // solo mira scan_status; `state` es lo que se le cuenta a quien esta delante,
  // donde un 'clean' sin motor no es un analisis.
  const scan = scanInfo?.scan_status ?? 'pending';
  const downloadable = isDeliverable(scan);
  const state = verdictOf(scan, scanInfo?.scan_engine);

  const otherFields = Object.entries(metadata).filter(([key]) =>
    !SYSTEM_FIELDS.includes(key) && !editable.includes(key) && key !== 'name' && key !== 'tags');

  return (
    <>
      <Link to="/" className="back">{t('detail.back')}</Link>

      <div className="pagehead">
        <div className="pagehead__text">
          <h1>{metadata.name}</h1>
          <p>{filename}</p>
        </div>
        <div className="pagehead__actions">
          {/* En cuarentena no hay boton deshabilitado, hay una explicacion: un
              boton que no responde obliga a adivinar por que. */}
          {downloadable ? (
            <button type="button" className="btn btn--primary" onClick={download} disabled={busy === 'download'}>
              {busy === 'download'
                ? <><span className="spinner" aria-hidden="true" /> {t('detail.downloading')}</>
                : t('documents.download')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            onClick={() => replacementInput.current?.click()}
            disabled={busy === 'replace'}
          >
            {busy === 'replace'
              ? <><span className="spinner" aria-hidden="true" /> {t('detail.replacing')}</>
              : t('detail.replace')}
          </button>
          <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
            {t('common.delete')}
          </button>
        </div>
      </div>

      <input
        ref={replacementInput}
        type="file"
        hidden
        accept={metadata.mimetype}
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = '';
          if (chosen) void replace(chosen);
        }}
      />

      <ErrorNotice error={error} />

      <div className="detail">
        {/* La huella SHA-256 es lo unico que acredita que el contenido no ha
            cambiado desde el deposito: se compone como un sello y no como una
            linea gris al fondo de una tabla. */}
        <div className={`seal seal--${state}`}>
          <div className="seal__fingerprint">{metadata.hash?.slice(0, 8)}</div>
          <div className="seal__verdict">{VERDICT[state]?.label}</div>
          {scanInfo?.scan_signature ? <div className="seal__detail">{scanInfo.scan_signature}</div> : null}
          {scanInfo?.scan_engine ? <div className="seal__detail">{scanInfo.scan_engine}</div> : null}
          {scanInfo?.scan_date ? <div className="seal__detail">{formatDate(scanInfo.scan_date, false)}</div> : null}
          <div className="seal__full">{metadata.hash}</div>
        </div>

        <div>
          <dl className="data">
            <Datum term={t('detail.originalName')}>{metadata.original_name || t('common.none')}</Datum>
            <Datum term={t('detail.mimetype')}>{metadata.mimetype}</Datum>
            <Datum term={t('detail.size')}>
              {typeof metadata.size === 'number' ? formatSize(metadata.size) : t('common.none')}
            </Datum>
            <Datum term={t('detail.deposited')}>
              {formatDate(metadata.creation_date ? Number.parseFloat(String(metadata.creation_date)) : null)}
            </Datum>
            <Datum term={t('common.identifier')}><span className="mono">{metadata.uuid}</span></Datum>
            {otherFields.map(([key, value]) => (
              <Datum term={key} key={key}>{String(value)}</Datum>
            ))}
          </dl>

          {/* Lo que hay que saber antes de fiarse de un documento que si se
              entrega. */}
          {state === 'unscanned' ? (
            <div className="spaced">
              <Notice kind="info">{VERDICT.unscanned.detail}</Notice>
            </div>
          ) : null}

          {state === 'pending' ? (
            <div className="spaced">
              <Notice kind="warn">{t('detail.pendingNotice')}</Notice>
            </div>
          ) : null}

          {!downloadable ? (
            <div className="spaced">
              <Notice kind="error">
                {state === 'infected'
                  ? t('detail.infectedNotice')
                  // En 'malicious' y en 'error' esperar no sirve de nada: el
                  // reanalisis ni mira los primeros ni devuelve un fichero que
                  // no esta. Se dice a quien le toca actuar.
                  : state === 'malicious' ? t('detail.maliciousNotice') : t('detail.missingNotice')}
              </Notice>
            </div>
          ) : null}
        </div>
      </div>

      <section className="section">
        <h2>{t('detail.metadata')}</h2>
        <p className="section__note">
          {editable.length ? t('detail.metadataEditable') : t('detail.metadataLocked')}
        </p>

        {editable.length ? (
          <div className="form">
            {editable.map((key) => (
              <div className="field" key={key}>
                <label htmlFor={`meta-${key}`}>{FIELD_LABEL[key] || key}</label>
                {key === 'tags' ? (
                  <TagsField
                    id={`meta-${key}`}
                    value={asTags(draft.tags)}
                    onChange={(tags) => setDraft((current) => ({ ...current, tags }))}
                  />
                ) : (
                  <input
                    id={`meta-${key}`}
                    type="text"
                    value={String(draft[key] ?? '')}
                    onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                  />
                )}
              </div>
            ))}

            <div className="pagehead__actions">
              <button type="button" className="btn btn--primary" onClick={save} disabled={!hasChanges || saving}>
                {saving
                  ? <><span className="spinner" aria-hidden="true" /> {t('common.saving')}</>
                  : t('common.save')}
              </button>
              <button type="button" className="btn" onClick={resetDraft} disabled={!hasChanges || saving}>
                {t('common.discard')}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="section">
        <h2>{t('detail.versions')}</h2>
        <p className="section__note">
          {versions?.length
            ? t('detail.versionsKept')
            : config?.max_version_file
              ? t('detail.versionsNoneLimited', { limit: config.max_version_file })
              : t('detail.versionsNone')}
        </p>

        {versions?.length ? (
          <div className="scroller">
            <table className="table">
              <thead><tr><th>{t('detail.versionNumber')}</th><th>{t('detail.versionSaved')}</th></tr></thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.version}>
                    <td>{version.version}</td>
                    <td>{formatDate(version.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {confirming ? (
        <Dialog
          title={t('detail.deleteTitle')}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn--danger" onClick={remove} disabled={busy === 'delete'}>
                {busy === 'delete'
                  ? <><span className="spinner" aria-hidden="true" /> {t('detail.deleting')}</>
                  : t('common.delete')}
              </button>
            </>
          }
        >
          <div className="dialog__body">
            <p>{t('detail.deleteBodyBefore')}<strong>{filename}</strong>{t('detail.deleteBodyAfter')}</p>
            <Notice kind="warn">{t('detail.deleteWarning')}</Notice>
          </div>
        </Dialog>
      ) : null}
    </>
  );
};
