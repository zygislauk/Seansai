import { useEffect } from 'react';
import { ApiError } from '../api/client.ts';
import { useMovies } from '../api/hooks.ts';
import { useCity } from '../app/city.tsx';
import { useDocumentHead } from '../app/document-head.ts';
import { EmptyState } from '../components/organisms/EmptyState/index.ts';
import { ErrorState } from '../components/organisms/ErrorState/index.ts';
import { LoadingState } from '../components/organisms/LoadingState/index.ts';
import { MovieGrid } from '../components/organisms/MovieGrid/index.ts';
import { StaleNotice } from '../components/organisms/StaleNotice/index.ts';
import { PageLayout } from '../components/templates/PageLayout/index.ts';
import { useT } from '../i18n/index.tsx';
import { pageHead } from '../lib/page-head.ts';
import styles from './MovieListPage.module.scss';

/** The "currently showing" list for the city, all of Lithuania until one is chosen (FR-003, FR-014). */
export function MovieListPage() {
  const { t, lang, formatTime } = useT();
  const { city, forgetCity } = useCity();
  const movies = useMovies(city);
  useDocumentHead(pageHead({ kind: 'list' }, lang));

  const unknownCity = movies.error instanceof ApiError && movies.error.code === 'invalid_city';
  useEffect(() => {
    if (unknownCity) forgetCity();
  }, [unknownCity, forgetCity]);

  return (
    <PageLayout
      footer={
        movies.data && t('layout.updatedAt', { time: formatTime(movies.data.freshness.updatedAt) })
      }
    >
      <div className={styles.page}>
        <h1 className={styles.title}>{t('movieList.title')}</h1>
        {unknownCity ? <LoadingState /> : <MovieListContent query={movies} />}
      </div>
    </PageLayout>
  );
}

function MovieListContent({ query }: { query: ReturnType<typeof useMovies> }) {
  const { t, lang } = useT();
  if (query.isPending) return <LoadingState />;
  // Only with nothing to show: a failed refresh leaves the movies in place (research.md §7).
  if (query.data === undefined) {
    return (
      <ErrorState
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  const { movies, freshness } = query.data;
  return (
    <>
      <StaleNotice staleCinemas={freshness.staleCinemas} />
      {movies.length === 0 ? (
        <EmptyState title={t('movieList.empty')}>
          <p>{t('movieList.emptyBody')}</p>
        </EmptyState>
      ) : (
        <MovieGrid movies={movies} movieHref={(movieId) => `/${lang}/movie/${movieId}`} />
      )}
    </>
  );
}
