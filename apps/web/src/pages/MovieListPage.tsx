import type { CitiesResponse } from '@seansai/shared';
import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.ts';
import { useCities, useMovies } from '../api/hooks.ts';
import { useCity } from '../app/city.tsx';
import { useDocumentHead } from '../app/document-head.ts';
import { EmptyState } from '../components/organisms/EmptyState/index.ts';
import { ErrorState } from '../components/organisms/ErrorState/index.ts';
import { LoadingState } from '../components/organisms/LoadingState/index.ts';
import { MovieGrid } from '../components/organisms/MovieGrid/index.ts';
import { StaleNotice } from '../components/organisms/StaleNotice/index.ts';
import { PageLayout } from '../components/templates/PageLayout/index.ts';
import { useT } from '../i18n/index.tsx';
import { cityTitle, pageHead, type PageHead } from '../lib/page-head.ts';
import { NotFoundPage } from './NotFoundPage.tsx';
import styles from './MovieListPage.module.scss';

/**
 * The "currently showing" list for the city, all of Lithuania until one is chosen (FR-003, FR-014),
 * or a city's own page when the address names one.
 */
export function MovieListPage() {
  const translator = useT();
  const { t, lang, formatTime } = translator;
  const { city, rememberCity, forgetCity } = useCity();
  const { cityId } = useParams();
  const [params] = useSearchParams();
  const movies = useMovies(city);
  const cities = useCities(lang);
  const pageCity = cities.data?.cities.find((item) => item.id === cityId);

  const unknownCity = movies.error instanceof ApiError && movies.error.code === 'invalid_city';
  const hasMovies = movies.data !== undefined;

  // A city page waits to name itself, as its address might not be a city.
  let head: PageHead | null = null;
  if (cityId === undefined) head = pageHead({ kind: 'list', city: params.get('city') }, lang);
  else if (pageCity && !unknownCity) {
    head = pageHead({ kind: 'city', cityId, name: pageCity.name }, lang);
  }
  useDocumentHead(head);

  useEffect(() => {
    // An address naming an unknown city says nothing about the city remembered on this device.
    if (unknownCity && cityId === undefined) forgetCity();
  }, [unknownCity, cityId, forgetCity]);

  useEffect(() => {
    if (cityId !== undefined && hasMovies) rememberCity(cityId);
  }, [cityId, hasMovies, rememberCity]);

  if (unknownCity && cityId !== undefined) return <NotFoundPage />;

  return (
    <PageLayout
      footer={
        movies.data && t('layout.updatedAt', { time: formatTime(movies.data.freshness.updatedAt) })
      }
    >
      <div className={styles.page}>
        <h1 className={styles.title}>
          {pageCity && cityId !== undefined
            ? cityTitle(cityId, pageCity.name, translator)
            : t('movieList.title')}
        </h1>
        {cityId === undefined && city === 'all' && cities.data && (
          <CityLinks cities={cities.data.cities} />
        )}
        {unknownCity ? <LoadingState /> : <MovieListContent query={movies} />}
      </div>
    </PageLayout>
  );
}

/** Plain links, so that search engines find each city's page from the general list. */
function CityLinks({ cities }: { cities: CitiesResponse['cities'] }) {
  const { t, lang } = useT();
  const withMovies = cities.filter((city) => city.hasMovies);
  if (withMovies.length === 0) return null;
  return (
    <nav aria-label={t('movieList.byCity')}>
      <ul className={styles.cityLinks}>
        {withMovies.map((city) => (
          <li key={city.id}>
            <Link to={`/${lang}/city/${city.id}`}>{city.name}</Link>
          </li>
        ))}
      </ul>
    </nav>
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
