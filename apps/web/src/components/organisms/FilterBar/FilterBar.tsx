import type { Screening } from '@seansai/shared';
import { useId, useState, type ReactNode } from 'react';
import { useT } from '../../../i18n/index.tsx';
import { classNames } from '../../../lib/class-names.ts';
import {
  filterCount,
  filterOptions,
  hasFilters,
  noFilters,
  type Filters,
} from '../../../lib/filters.ts';
import { Button } from '../../atoms/Button/index.ts';
import { FilterChip } from '../../molecules/FilterChip/index.ts';
import styles from './FilterBar.module.scss';

type FilterBarProps = {
  /** The day's screenings before filtering; options come only from these. */
  screenings: readonly Screening[];
  filters: Filters;
  onChange: (filters: Filters) => void;
};

/** Adds `value` to the list, or removes it when it is already there. */
function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * Cinema, format and audio filters (FR-012). A group with a single choice filters nothing, so it
 * is shown only when something in it is selected. Formats differ: 2D has no chip, so a single chip
 * still narrows the list unless every screening has that format. On small screens the groups fold
 * behind a toggle.
 */
export function FilterBar({ screenings, filters, onChange }: FilterBarProps) {
  const { t } = useT();
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const options = filterOptions(screenings, filters);
  const showCinemas = options.cinemas.length > 1 || filters.cinemas.length > 0;
  const showFormats =
    filters.formats.length > 0 ||
    options.formats.some((format) => screenings.some((screening) => screening.format !== format));
  const showAudio = options.audio.length > 1 || filters.audio !== null;
  if (!showCinemas && !showFormats && !showAudio) return null;
  const count = filterCount(filters);

  return (
    <div className={styles.bar}>
      <Button
        className={styles.toggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => {
          setExpanded(!expanded);
        }}
      >
        {count > 0 ? t('filters.toggleCount', { count }) : t('filters.toggle')}
      </Button>
      <div id={panelId} className={classNames(styles.panel, expanded && styles.expanded)}>
        {showCinemas && (
          <FilterGroup label={t('filters.cinema')}>
            {options.cinemas.map((cinema) => (
              <FilterChip
                key={cinema.id}
                selected={filters.cinemas.includes(cinema.id)}
                onToggle={() => {
                  onChange({ ...filters, cinemas: toggled(filters.cinemas, cinema.id) });
                }}
              >
                {cinema.name}
              </FilterChip>
            ))}
          </FilterGroup>
        )}
        {showFormats && (
          <FilterGroup label={t('filters.format')}>
            {options.formats.map((format) => (
              <FilterChip
                key={format}
                selected={filters.formats.includes(format)}
                onToggle={() => {
                  onChange({ ...filters, formats: toggled(filters.formats, format) });
                }}
              >
                {format === 'other' ? t('filters.otherFormat') : format}
              </FilterChip>
            ))}
          </FilterGroup>
        )}
        {showAudio && (
          <FilterGroup label={t('filters.audio')}>
            {options.audio.map((audio) => (
              <FilterChip
                key={audio}
                selected={filters.audio === audio}
                onToggle={() => {
                  onChange({ ...filters, audio: filters.audio === audio ? null : audio });
                }}
              >
                {t(audio === 'original' ? 'filters.original' : 'filters.dubbed')}
              </FilterChip>
            ))}
          </FilterGroup>
        )}
        {hasFilters(filters) && (
          <Button
            variant="ghost"
            size="sm"
            className={styles.clear}
            onClick={() => {
              onChange(noFilters);
            }}
          >
            {t('filters.clear')}
          </Button>
        )}
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className={styles.group}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <div className={styles.chips}>{children}</div>
    </div>
  );
}
