import { Link } from 'react-router';
import { useDocumentHead } from '../app/document-head.ts';
import { PageLayout } from '../components/templates/PageLayout/index.ts';
import { useT } from '../i18n/index.tsx';
import { pageHead } from '../lib/page-head.ts';

/** An unknown address, or a movie that is no longer listed (`movie_not_found`). */
export function NotFoundPage({ reason = 'page' }: { reason?: 'page' | 'movie' }) {
  const { t, lang } = useT();
  useDocumentHead(pageHead({ kind: 'notFound' }, lang));
  return (
    <PageLayout>
      <h1>{t(reason === 'movie' ? 'notFound.movieTitle' : 'notFound.title')}</h1>
      <p>{t(reason === 'movie' ? 'notFound.movieBody' : 'notFound.body')}</p>
      <p>
        <Link to={`/${lang}/`}>{t('notFound.backToList')}</Link>
      </p>
    </PageLayout>
  );
}
