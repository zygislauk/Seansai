import { useState } from 'react';
import type { Screening } from '@seansai/shared';
import { useT } from '../../../i18n/index.tsx';
import { classNames } from '../../../lib/class-names.ts';
import { Badge } from '../../atoms/Badge/index.ts';
import { Icon } from '../../atoms/Icon/index.ts';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/index.ts';
import styles from './ScreeningRow.module.scss';

/**
 * One screening: time, cinema and city, hall, format and language, and the ticket link. 2D gets no
 * badge: it is the default, so only special formats stand out.
 */
export function ScreeningRow({ screening }: { screening: Screening }) {
  const { t, formatTime, languageName } = useT();
  const [opened, setOpened] = useState(false);
  const { cinema, hall, format, spokenLanguage, subtitleLanguage, isDubbed } = screening;
  const time = formatTime(screening.startsAt);
  const code = (language: string) => (
    <abbr title={languageName(language)}>{language.toUpperCase()}</abbr>
  );

  const badges = [
    format !== null && format !== '2D' && <Badge key="format">{format}</Badge>,
    isDubbed === true && <Badge key="dubbed">{t('screening.dubbed')}</Badge>,
    isDubbed !== true && spokenLanguage !== null && (
      <Badge key="spoken">{code(spokenLanguage)}</Badge>
    ),
    isDubbed !== true && subtitleLanguage !== null && (
      <Badge key="subtitles">
        {t('screening.subtitles', { language: subtitleLanguage.toUpperCase() })}
      </Badge>
    ),
  ].filter(Boolean);

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
        {badges.length > 0 && <p className={styles.badges}>{badges}</p>}
      </div>
      <a
        href={screening.ticketUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={classNames(styles.ticket, opened && styles.opened)}
        onClick={() => {
          setOpened(true);
        }}
        onPointerMove={() => {
          setOpened(false);
        }}
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
