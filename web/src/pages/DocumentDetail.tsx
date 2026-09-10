import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client';
import { useConfig } from '../api/config';
import type { DocumentMetadata, DocumentVersion, IndexInfo, ScanInfo } from '../api/types';
import { useToast } from '../components/toast';
import { ChunkList } from '../components/ChunkList';
import {
  Card, Dialog, ErrorNotice, INDEX, IndexIcon, IndexState, Loading, Notice, TabPanel, TabStrip, Tabs,
  TagsField, VERDICT, Verdict, VerdictIcon, errorMessage, formatDate, formatSize, isDeliverable,
  verdictOf
} from '../components/ui';
import type { Tab, VerdictState } from '../components/ui';
import { t } from '../i18n';

/** Claves que fija el propio Pergamo al guardar: se muestran, no se editan. */
const SYSTEM_FIELDS = [
  'uuid', 'uuid_sha256', 'organization', 'creation_date',
  'hash', 'mimetype', 'extension', 'original_name', 'size'
];

/** Procedencia del deposito: cuenta como entro el documento, no que es. */
const HIDDEN_FIELDS = ['origin'];

/**
 * Nombres de los campos editables. Las claves son las de VALID_METADATA_MODIFY,
 * que es configurable, asi que lo que no este aqui se muestra tal cual.
 */
const FIELD_LABEL: Record<string, string> = {
  name: t('detail.fieldName'),
  description: t('detail.fieldDescription'),
  tags: t('detail.fieldTags')
};

/** Mientras el trabajo esta vivo. Con el worker parado el estado se queda en
    'pending', asi que el refresco tiene tope: una pestana abierta no debe
    preguntar para siempre. */
const REFRESH_MS = 4000;
const REFRESH_LIMIT = 15;

/**
 * Estados que un reanalisis puede resolver. 'malicious' no esta: esa cuarentena
 * es por lo que el fichero lleva dentro, y la API la rechaza.
 */
const RESCANNABLE: VerdictState[] = ['pending', 'unscanned', 'infected', 'error'];

const asTags = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const Icon = ({ size = 12, children }: { size?: number; children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

const FileIcon = ({ size }: { size?: number }) => (
  <Icon size={size}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Icon>
);

const LinesIcon = ({ size }: { size?: number }) => (
  <Icon size={size}><path d="M4 7h16" /><path d="M4 12h10" /><path d="M4 17h6" /></Icon>
);

const SearchIcon = ({ size }: { size?: number }) => (
  <Icon size={size}><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></Icon>
);

const TypeIcon = () => <Icon><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /></Icon>;
const ClockIcon = () => <Icon><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>;
const ShieldIcon = () => <Icon><path d="M12 3l7 4v5c0 5-3 8-7 9-4-1-7-4-7-9V7z" /></Icon>;
const CopyIcon = () => <Icon><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 5H6a2 2 0 0 0-2 2v9" /></Icon>;
const SizeIcon = () => (
  <Icon size={11}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
    <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
  </Icon>
);
const DownloadIcon = ({ size = 15 }: { size?: number }) => (
  <Icon size={size}><path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M5 20h14" /></Icon>
);
const RescanIcon = () => <Icon size={13}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></Icon>;
const BackIcon = () => <Icon size={14}><path d="M19 12H5" /><path d="M11 18l-6-6 6-6" /></Icon>;

export const DocumentDetail = () => {

  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const config = useConfig();
  const replacementInput = useRef<HTMLInputElement>(null);
  const refreshes = useRef(0);

  const [metadata, setMetadata] = useState<DocumentMetadata | null>(null);
  const [scanInfo, setScanInfo] = useState<ScanInfo | null>(null);
  const [indexInfo, setIndexInfo] = useState<IndexInfo | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState('general');
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const editable = useMemo(() => config?.valid_metadata_modify ?? [], [config]);

  const load = useCallback(async () => {
    setLoading(true);
    refreshes.current = 0;

    try {
      // El estado de analisis, el del indice y las versiones viven en endpoints
      // propios: se piden a la vez para no encadenar cuatro esperas.
      //
      // El del indice cae a null si falla, como las versiones: un servidor sin
      // esa ruta no puede dejar la ficha en blanco.
      const [document, scan, index, versionList] = await Promise.all([
        api.document(id),
        api.scan(id),
        api.indexInfo(id).catch(() => null),
        api.versions(id).catch(() => [] as DocumentVersion[])
      ]);

      setMetadata(document);
      setScanInfo(scan);
      setIndexInfo(index);
      setVersions(versionList);
      setError(null);
    } catch (failure) {
      setError(failure);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Indexar tarda segundos, no dias: sin esto la ficha ensena una cola que ya se
  // vacio hasta que alguien recarga.
  useEffect(() => {
    const status = indexInfo?.index_status;

    if (status !== 'pending' && status !== 'indexing') return;
    if (refreshes.current >= REFRESH_LIMIT) return;

    const timer = setTimeout(() => {
      refreshes.current += 1;
      api.indexInfo(id).then(setIndexInfo).catch(() => {});
    }, REFRESH_MS);

    return () => clearTimeout(timer);
  }, [indexInfo, id]);

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

  const downloadVersion = async (version: number) => {
    setBusy(`version-${version}`);

    try {
      await api.downloadVersion(id, version, `${metadata?.name}.v${version}.zip`);
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

  const rescan = async () => {
    setBusy('rescan');

    try {
      const result = await api.rescan(id);
      setScanInfo(result);
      toast(t('detail.rescanned', {
        verdict: VERDICT[verdictOf(result.scan_status, result.scan_engine)]?.label
      }));
    } catch (failure) {
      toast(errorMessage(failure), 'error');
    } finally {
      setBusy(null);
    }
  };

  const copyFingerprint = async () => {
    try {
      await navigator.clipboard.writeText(metadata?.hash ?? '');
      toast(t('detail.fingerprintCopied'));
    } catch {
      // Sin permiso o sin contexto seguro no hay portapapeles: se dice, en
      // lugar de dejar un boton que no hace nada.
      toast(t('detail.copyFailed'), 'error');
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
    !SYSTEM_FIELDS.includes(key) && !HIDDEN_FIELDS.includes(key)
    && !editable.includes(key) && key !== 'name' && key !== 'tags');

  // Sin motor en el despliegue no se ofrece: la API responde 400, y un boton
  // que solo sabe fallar es peor que ninguno.
  const canRescan = config?.enable_antivirus === true && RESCANNABLE.includes(state);

  const rescanButton = canRescan ? (
    <button type="button" className="btn btn--tiny" onClick={rescan} disabled={busy === 'rescan'}>
      {busy === 'rescan'
        ? <><span className="spinner" aria-hidden="true" /> {t('detail.rescanning')}</>
        : <><RescanIcon /> {t('detail.rescan')}</>}
    </button>
  ) : null;

  // Lo que hay que saber antes de fiarse de un documento, con la palabra del
  // veredicto por titulo y su explicacion por cuerpo.
  const signature = scanInfo?.scan_signature ? (
    <div className="notice__signature">
      {t('detail.scanSignature')}: <span className="mono">{scanInfo.scan_signature}</span>
    </div>
  ) : null;

  const verdictNotice = !downloadable ? (
    <Notice
      wide
      kind="error"
      title={VERDICT[state]?.label}
      icon={<VerdictIcon state={state} />}
      action={rescanButton}
    >
      {state === 'infected'
        ? t('detail.infectedNotice')
        // En 'malicious' y en 'error' esperar no sirve de nada: el reanalisis ni
        // mira los primeros ni devuelve un fichero que no esta. Se dice a quien
        // le toca actuar.
        : state === 'malicious' ? t('detail.maliciousNotice') : t('detail.missingNotice')}
      {signature}
    </Notice>
  ) : state === 'unscanned' || state === 'pending' ? (
    <Notice
      wide
      kind={state === 'pending' ? 'warn' : 'info'}
      title={VERDICT[state]?.label}
      icon={<VerdictIcon state={state} />}
      action={rescanButton}
    >
      {state === 'pending' ? t('detail.pendingNotice') : VERDICT.unscanned.detail}
      {signature}
    </Notice>
  ) : null;

  const general = (
    <div className="doc-panel">
      {verdictNotice}

      <div className="cards">
        <Card term={t('detail.originalName')} icon={<FileIcon />} wide>
          {metadata.original_name || t('common.none')}
        </Card>
        <Card term={t('detail.mimetype')} icon={<TypeIcon />}>
          <span className="mono">{metadata.mimetype}</span>
        </Card>
        <Card term={t('detail.deposited')} icon={<ClockIcon />}>
          {formatDate(metadata.creation_date ? Number.parseFloat(String(metadata.creation_date)) : null)}
        </Card>

        {/* La huella SHA-256 es lo unico que acredita que el contenido no ha
            cambiado desde el deposito, asi que se puede llevar de aqui. */}
        <Card
          term={t('detail.fingerprint')}
          icon={<ShieldIcon />}
          action={
            <button
              type="button"
              className="btn btn--icon btn--small"
              title={t('detail.copyFingerprint')}
              aria-label={t('detail.copyFingerprint')}
              onClick={copyFingerprint}
            ><CopyIcon /></button>
          }
        >
          <span className="mono truncate" title={metadata.hash}>{metadata.hash}</span>
        </Card>

        {scanInfo?.scan_engine || scanInfo?.scan_date ? (
          <Card term={t('detail.scan')} icon={<VerdictIcon state={state} size={12} />}>
            {scanInfo.scan_engine ? (
              <div className="truncate" title={scanInfo.scan_engine}>{scanInfo.scan_engine}</div>
            ) : null}
            {scanInfo.scan_date ? (
              <div className="card__note">{formatDate(scanInfo.scan_date)}</div>
            ) : null}
          </Card>
        ) : null}

        {otherFields.map(([key, value]) => (
          <Card term={key} key={key}>{String(value)}</Card>
        ))}
      </div>

      <div className="doc-columns">
        <section>
          <h2>{t('detail.metadata')}</h2>
          <p className="section__note">
            {editable.length ? t('detail.metadataEditable') : t('detail.metadataLocked')}
          </p>

          {editable.length ? (
            <div className="panel form">
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

              <div className="doc-actions">
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

        <section>
          <h2>{t('detail.versions')}</h2>
          <p className="section__note">
            {versions?.length
              ? t('detail.versionsKept')
              : config?.max_version_file
                ? t('detail.versionsNoneLimited', { limit: config.max_version_file })
                : t('detail.versionsNone')}
          </p>

          {versions?.length ? (
            <ul className="versions">
              {versions.map((version) => (
                <li className="version" key={version.version}>
                  <span className="version__number" aria-hidden="true">{version.version}</span>
                  <div className="version__text">
                    <div className="version__title">
                      {t('detail.versionNumber')} {version.version}
                    </div>
                    <div className="version__note">{t('detail.versionArchive')}</div>
                  </div>
                  <span className="version__date">{formatDate(version.created_at)}</span>
                  <button
                    type="button"
                    className="btn btn--icon"
                    title={t('detail.versionDownload', { version: version.version })}
                    aria-label={t('detail.versionDownload', { version: version.version })}
                    onClick={() => downloadVersion(version.version)}
                    disabled={busy === `version-${version.version}`}
                  >
                    {busy === `version-${version.version}`
                      ? <span className="spinner" aria-hidden="true" />
                      : <DownloadIcon />}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </div>
  );

  const semanticIndex = indexInfo ? (
    <div className="doc-panel">
      <Notice
        wide
        kind={indexInfo.index_status === 'indexed' ? 'success'
          : indexInfo.index_status === 'error' ? 'error'
          : indexInfo.index_status === 'pending' || indexInfo.index_status === 'indexing' ? 'warn'
          : 'info'}
        title={INDEX[indexInfo.index_status]?.label}
        icon={<IndexIcon status={indexInfo.index_status} />}
      >
        {INDEX[indexInfo.index_status]?.detail}
      </Notice>

      {indexInfo.index_status === 'indexed' ? (
        <div className="cards">
          <Card term={t('detail.indexChunks')} icon={<LinesIcon />}>
            {typeof indexInfo.index_chunks === 'number'
              ? t('detail.indexChunkCount', { count: indexInfo.index_chunks })
              : t('common.none')}
          </Card>
          <Card term={t('detail.indexModel')} icon={<SearchIcon />}>
            <span className="mono">{indexInfo.index_model || t('common.none')}</span>
          </Card>
          <Card term={t('detail.indexDate')} icon={<ClockIcon />}>
            {formatDate(indexInfo.index_date)}
          </Card>
        </div>
      ) : null}

      {/* El motivo, tal como lo guardo el trabajo. 'EMPTY_CONTENT' es el unico
          codigo fijo y el caso frecuente —un PDF escaneado sin capa de texto—,
          asi que se traduce; el resto es el mensaje de la excepcion y se
          muestra tal cual antes que inventarle una explicacion. */}
      {indexInfo.index_error ? (
        <Notice wide kind={indexInfo.index_status === 'error' ? 'error' : 'warn'}>
          {indexInfo.index_error === 'EMPTY_CONTENT'
            ? t('detail.indexEmptyContent')
            : indexInfo.index_error}
        </Notice>
      ) : null}

      {indexInfo.index_status === 'indexed' ? (
        <section>
          <h2>{t('detail.chunks')}</h2>
          <ChunkList document={id} />
        </section>
      ) : null}
    </div>
  ) : null;

  // Solo donde significa algo: un despliegue que no indexa no gana una pestana
  // sobre algo que no hace, y un documento que nadie pidio indexar en uno que si
  // la tiene explica por que no esta.
  const showIndex = indexInfo && (config?.indexing_enabled || indexInfo.index_status !== 'none');

  const tabs: Tab[] = [
    { id: 'general', label: t('detail.tabGeneral'), icon: <LinesIcon size={14} />, panel: general },
    ...(showIndex
      ? [{ id: 'index', label: t('detail.tabIndex'), icon: <SearchIcon size={14} />, panel: semanticIndex }]
      : [])
  ];

  return (
    <Tabs tabs={tabs} active={tab} onChange={setTab} label={t('detail.index')}>
      <div className="doc-bar">
        <Link to="/" className="back back--pill"><BackIcon />{t('detail.back')}</Link>
        {tabs.length > 1 ? <TabStrip segmented /> : null}
      </div>

      <div className="doc-title">
        <span className="doc-type" aria-hidden="true">
          <FileIcon size={20} />
          <span className="doc-type__extension">{metadata.extension}</span>
        </span>
        <h1 title={metadata.name}>{metadata.name}</h1>
      </div>

      <div className="doc-status">
        <div className="chips">
          <Verdict status={scan} engine={scanInfo?.scan_engine} chip />
          {indexInfo ? <IndexState status={indexInfo.index_status} chip /> : null}
          {typeof metadata.size === 'number' ? (
            <span className="chip chip--plain"><SizeIcon />{formatSize(metadata.size)}</span>
          ) : null}
        </div>

        <div className="doc-actions">
          {/* En cuarentena no hay boton deshabilitado, hay una explicacion: un
              boton que no responde obliga a adivinar por que. */}
          {downloadable ? (
            <button type="button" className="btn btn--primary" onClick={download} disabled={busy === 'download'}>
              {busy === 'download'
                ? <><span className="spinner" aria-hidden="true" /> {t('detail.downloading')}</>
                : <><DownloadIcon size={16} /> {t('documents.download')}</>}
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

      <TabPanel />

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
    </Tabs>
  );
};
