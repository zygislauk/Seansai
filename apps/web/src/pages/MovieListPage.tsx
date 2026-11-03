import { ApiError } from '../api/client.ts';
import { useCities, useMovies } from '../api/hooks.ts';
import { useCity } from '../app/city.tsx';
import { CityPrompt } from '../components/organisms/CityPrompt/index.ts';
import { EmptyState } from '../components/organisms/EmptyState/index.ts';
import { ErrorState } from '../components/organisms/ErrorState/index.ts';
import { LoadingState } from '../components/organisms/LoadingState/index.ts';
import { MovieGrid } from '../components/organisms/MovieGrid/index.ts';
import { StaleNotice } from '../components/organisms/StaleNotice/index.ts';
import { PageLayout } from '../components/templates/PageLayout/index.ts';
import { useT } from '../i18n/index.tsx';
import styles from './MovieListPage.module.scss';

/** The "currently showing" list for the chosen city (FR-003, FR-013, FR-014). */
export function MovieListPage() {
  const { t, lang, formatTime } = useT();
  const { city, chooseCity } = useCity();
  const movies = useMovies(city);
  const cities = useCities(lang);

  // A city remembered from before that is no longer supported is asked for again. Changing a
  // known city is done with the switcher in the header.
  const unknownCity = movies.error instanceof ApiError && movies.error.code === 'invalid_city';
  const askForCity = city === null || unknownCity;

  return (
    <PageLayout
      footer={
        movies.data && t('layout.updatedAt', { time: formatTime(movies.data.freshness.updatedAt) })
      }
    >
      <div className={styles.page}>
        <h1 className={styles.title}>{t('movieList.title')}</h1>
        {!askForCity && <MovieListContent query={movies} />}
      </div>
      {askForCity && (
        <CityPrompt
          cities={cities.data?.cities ?? null}
          failed={cities.isError}
          onSelect={chooseCity}
        />
      )}
    </PageLayout>
  );
}

function MovieListContent({ query }: { query: ReturnType<typeof useMovies> }) {
  const { t, lang } = useT();
  if (query.isPending) return <LoadingState />;
  if (query.isError) {
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
