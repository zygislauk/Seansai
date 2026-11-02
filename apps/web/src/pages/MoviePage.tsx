import type { MovieDetail } from '@seansai/shared';
import { useEffect } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.ts';
import { useMovie, useScreenings } from '../api/hooks.ts';
import { useCity } from '../app/city.tsx';
import { useFilters } from '../app/filters.ts';
import { Badge } from '../components/atoms/Badge/index.ts';
import { Button } from '../components/atoms/Button/index.ts';
import { Poster } from '../components/atoms/Poster/index.ts';
import { Spinner } from '../components/atoms/Spinner/index.ts';
import { DatePicker } from '../components/organisms/DatePicker/index.ts';
import { EmptyState } from '../components/organisms/EmptyState/index.ts';
import { ErrorState } from '../components/organisms/ErrorState/index.ts';
import { FilterBar } from '../components/organisms/FilterBar/index.ts';
import { LoadingState } from '../components/organisms/LoadingState/index.ts';
import { ScreeningTimeline } from '../components/organisms/ScreeningTimeline/index.ts';
import { StaleNotice } from '../components/organisms/StaleNotice/index.ts';
import { PageLayout } from '../components/templates/PageLayout/index.ts';
import { useT } from '../i18n/index.tsx';
import { applyFilters, hasFilters, noFilters } from '../lib/filters.ts';
import { secondaryTitle } from '../lib/text.ts';
import styles from './MoviePage.module.scss';
import { NotFoundPage } from './NotFoundPage.tsx';

/** The page's query string with `date` set, or removed for today (web-routes.md). */
function withDate(params: URLSearchParams, date: string, today: string | null): string {
  const next = new URLSearchParams(params);
  if (date === today) next.delete('date');
  else next.set('date', date);
  const search = next.toString();
  return search === '' ? '' : `?${search}`;
}

/** One movie's screenings in the city on one date, today by default (FR-006 to FR-011). */
export function MoviePage() {
  const { t, formatTime } = useT();
  const { movieId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { city, forgetCity } = useCity();
  const detail = useMovie(movieId, city);

  // "Today" comes from the server, so it matches the data even on a device with a wrong clock.
  const dates = detail.data?.availableDates ?? [];
  const today = dates[0] ?? null;
  // A past, unpublished or malformed date falls back to today, with a notice.
  const requested = params.get('date');
  const unavailableDate =
    detail.data !== undefined && requested !== null && !dates.includes(requested);
  const date = requested !== null && dates.includes(requested) ? requested : today;
  // Requested at once, in parallel with the details: today (null, the server's today) unless the
  // link names a date. A date the details show to be unavailable falls back to today.
  const screenings = useScreenings(
    movieId,
    city,
    requested === null || unavailableDate ? null : requested,
  );

  const unknownCity = detail.error instanceof ApiError && detail.error.code === 'invalid_city';
  useEffect(() => {
    if (unknownCity) forgetCity();
  }, [unknownCity, forgetCity]);

  // Replaces the history entry, so Back leaves the movie instead of stepping through dates.
  const chooseDate = (next: string) => {
    void navigate(
      { search: withDate(params, next, today) },
      { replace: true, preventScrollReset: true },
    );
  };

  if (detail.error instanceof ApiError && detail.error.code === 'movie_not_found') {
    return <NotFoundPage reason="movie" />;
  }

  return (
    <PageLayout
      footer={
        screenings.data &&
        t('layout.updatedAt', { time: formatTime(screenings.data.freshness.updatedAt) })
      }
    >
      {(detail.isPending || unknownCity) && <LoadingState />}
      {/* Only with nothing to show: a failed refresh leaves the movie in place (research.md §7). */}
      {detail.isError && detail.data === undefined && !unknownCity && (
        <ErrorState
          onRetry={() => {
            void detail.refetch();
          }}
        />
      )}
      {detail.data && date !== null && (
        <div className={styles.page}>
          <MovieHeader movie={detail.data.movie} />
          <section className={styles.screenings} aria-labelledby="screenings-heading">
            <DatePicker
              dates={dates}
              selected={date}
              screeningDates={detail.data.screeningDates}
              onSelect={chooseDate}
            />
            <h2 id="screenings-heading" className={styles.date}>
              <DateHeading date={date} isToday={date === today} />
            </h2>
            {unavailableDate && <p className={styles.notice}>{t('movie.unavailableDate')}</p>}
            <ScreeningsContent
              query={screenings}
              today={today}
              nextDateHref={(next) => withDate(params, next, today)}
            />
          </section>
        </div>
      )}
    </PageLayout>
  );
}

function DateHeading({ date, isToday }: { date: string; isToday: boolean }) {
  const { t, formatDate } = useT();
  return isToday ? `${t('movie.today')}, ${formatDate(date)}` : formatDate(date);
}

function MovieHeader({ movie }: { movie: MovieDetail }) {
  const { t } = useT();
  const subtitle = secondaryTitle(movie);
  const facts = [
    movie.durationMinutes !== null && t('movie.duration', { minutes: movie.durationMinutes }),
    ...movie.genres,
  ].filter(Boolean);
  return (
    <header className={styles.movie}>
      <Poster
        src={movie.posterUrl}
        alt=""
        width={160}
        height={240}
        loading="eager"
        className={styles.poster}
      />
      <div className={styles.titles}>
        <h1 className={styles.title}>{movie.title}</h1>
        {subtitle !== null && <p className={styles.original}>{subtitle}</p>}
        <p className={styles.facts}>
          {movie.ageRating !== null && (
            <Badge>
              <abbr title={t('movie.ageRating')}>{movie.ageRating}</abbr>
            </Badge>
          )}
          {facts.join(' · ')}
        </p>
      </div>
    </header>
  );
}

function ScreeningsContent({
  query,
  today,
  nextDateHref,
}: {
  query: ReturnType<typeof useScreenings>;
  today: string | null;
  nextDateHref: (date: string) => string;
}) {
  const { t, formatDate } = useT();
  const [filters, setFilters] = useFilters();
  if (query.isPending) return <LoadingState />;
  if (query.data === undefined) {
    return (
      <ErrorState
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  // While another date loads, the previous list stays visible (placeholder data).
  const { date, screenings, nextDateWithScreenings, freshness } = query.data;
  const shown = applyFilters(screenings, filters);
  return (
    <div className={styles.results} aria-busy={query.isPlaceholderData}>
      {query.isPlaceholderData && <Spinner label={t('movie.loadingDate')} />}
      <StaleNotice staleCinemas={freshness.staleCinemas} />
      {screenings.length > 0 && (
        <FilterBar screenings={screenings} filters={filters} onChange={setFilters} />
      )}
      {/* Always present, so screen readers announce the count as filters change. */}
      <p aria-live="polite" className={styles.count}>
        {screenings.length > 0 &&
          hasFilters(filters) &&
          t('filters.shown', { shown: shown.length, total: screenings.length })}
      </p>
      {screenings.length > 0 && shown.length === 0 && (
        <EmptyState title={t('filters.noMatch')}>
          <p>{t('filters.noMatchBody')}</p>
          <Button
            variant="primary"
            onClick={() => {
              setFilters(noFilters);
            }}
          >
            {t('filters.clear')}
          </Button>
        </EmptyState>
      )}
      {shown.length > 0 && <ScreeningTimeline screenings={shown} />}
      {screenings.length === 0 && (
        <EmptyState title={t(date === today ? 'movie.noMoreToday' : 'movie.noScreeningsOnDate')}>
          {nextDateWithScreenings === null ? (
            <p>{t('movie.noUpcoming')}</p>
          ) : (
            <p>
              <Link to={nextDateHref(nextDateWithScreenings)}>
                {t('movie.nextDate', { date: formatDate(nextDateWithScreenings) })}
              </Link>
            </p>
          )}
        </EmptyState>
      )}
    </div>
  );
}
