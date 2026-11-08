import type { Screening } from '@seansai/shared';
import { useT } from '../../../i18n/index.tsx';
import { Badge } from '../../atoms/Badge/index.ts';
import { Icon } from '../../atoms/Icon/index.ts';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/index.ts';
import styles from './ScreeningRow.module.scss';

/**
 * One screening: time, cinema and city, hall, format, and the ticket link. 2D gets no badge: it is
 * the default, so only special formats stand out. Language and dubbing are not shown: most films
 * here are in the original language with Lithuanian subtitles, and the cinemas' own pages state
 * the exceptions more reliably than our scraped labels.
 */
export function ScreeningRow({ screening }: { screening: Screening }) {
  const { t, formatTime } = useT();
  const { cinema, hall, format } = screening;
  const time = formatTime(screening.startsAt);
  const showFormat = format !== null && format !== '2D';

  return (
    <li className={styles.row} data-screening={screening.id}>
      <time dateTime={screening.startsAt} className={styles.time}>
        {time}
      </time>
      <div className={styles.details}>
        <p className={styles.cinema}>{cinema.name}</p>
        <p className={styles.place}>
          <Icon name="map-pin" size={14} />
          {[cinema.cityName, hall].filter(Boolean).join(' · ')}
        </p>
        {showFormat && (
          <p className={styles.badges}>
            <Badge>{format}</Badge>
          </p>
        )}
      </div>
      <a
        href={screening.ticketUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.ticket}
      >
        {t('screening.buyTicket')}
        <VisuallyHidden>
          {' '}
          ({t('screening.ticketContext', { time, cinema: cinema.name })})
        </VisuallyHidden>
        <Icon name="external-link" size={16} />
      </a>
    </li>
  );
}
