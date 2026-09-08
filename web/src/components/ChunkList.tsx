import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import type { ChunkList as ChunkPage, DocumentChunk } from '../api/types';
import { t } from '../i18n';
import { ChunkContent } from './ChunkContent';
import { Empty, ErrorNotice, Loading, PAGE_SIZES, Pagination } from './ui';

const BREADCRUMB = ' > ';

/**
 * Un trozo, con su procedencia arriba y su contenido debajo.
 *
 * El interruptor de crudo no es un lujo: lo formateado es una lectura y el
 * texto exacto —migas incluidas— es lo único que enseña qué se embebió de
 * verdad. Cuando el troceado sale mal, la diferencia entre los dos es el
 * diagnóstico.
 */
const Chunk = ({ chunk }: { chunk: DocumentChunk }) => {

  const [raw, setRaw] = useState(false);

  return (
    <article className="chunk">
      <header className="chunk__head">
        <span className="chunk__position">#{chunk.position + 1}</span>
        {chunk.page !== null ? (
          <span className="chunk__page">{t('chunks.page', { page: chunk.page })}</span>
        ) : null}
        {chunk.heading_path.length ? (
          <span className="chunk__path">{chunk.heading_path.join(BREADCRUMB)}</span>
        ) : null}
        <span className="chunk__meta">{t('chunks.length', { count: chunk.length })}</span>
        <span className="chunk__meta mono">{t('chunks.id', { id: chunk.chunk_id })}</span>
        <label className="chunk__raw">
          <input type="checkbox" checked={raw} onChange={(event) => setRaw(event.target.checked)} />
          <span>{t('chunks.raw')}</span>
        </label>
      </header>

      <div className="chunk__body">
        {raw
          ? <pre className="md-code">{chunk.content}</pre>
          : <ChunkContent
              content={chunk.content}
              kind={chunk.content_type}
              headingPath={chunk.heading_path}
            />}
      </div>
    </article>
  );
};

/**
 * Los trozos de un documento. Se piden aquí y no en la ficha porque este panel
 * solo se monta al abrir su pestaña: cargarlos en cada visita costaría una
 * consulta y un montón de texto para algo que casi nunca se mira.
 */
export const ChunkList = ({ document }: { document: string }) => {

  const [page, setPage] = useState<ChunkPage | null>(null);
  const [number, setNumber] = useState(1);
  const [size, setSize] = useState(PAGE_SIZES[0]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      setPage(await api.chunks(document, { limit: size, offset: (number - 1) * size }));
      setError(null);
    } catch (failure) {
      setError(failure);
    } finally {
      setLoading(false);
    }
  }, [document, number, size]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !page) return <Loading text={t('chunks.loading')} />;
  if (error) return <ErrorNotice error={error} />;
  if (!page) return null;

  if (!page.total) return <Empty title={t('chunks.emptyTitle')}>{t('chunks.emptyBody')}</Empty>;

  return (
    <>
      <div className="chunks">
        {page.chunks.map((chunk) => <Chunk key={chunk.chunk_id} chunk={chunk} />)}
      </div>

      <Pagination
        total={page.total}
        page={number}
        pageSize={size}
        shown={page.chunks.length}
        busy={loading}
        onPage={setNumber}
        onPageSize={(value) => { setSize(value); setNumber(1); }}
      />
    </>
  );
};
