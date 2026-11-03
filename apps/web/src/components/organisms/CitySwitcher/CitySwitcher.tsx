import { useState } from 'react';
import { useCities } from '../../../api/hooks.ts';
import { useCity } from '../../../app/city.tsx';
import { useT } from '../../../i18n/index.tsx';
import { Icon } from '../../atoms/Icon/index.ts';
import { CityPrompt } from '../CityPrompt/index.ts';
import styles from './CitySwitcher.module.scss';

/**
 * The chosen city, always visible in the header; opens the city dialog to change it (US3). Hidden
 * until a known city is chosen, because the page itself asks for one first (FR-013).
 */
export function CitySwitcher() {
  const { t, lang } = useT();
  const { city, chooseCity } = useCity();
  const cities = useCities(lang);
  const [open, setOpen] = useState(false);
  const name =
    city === 'all' ? t('city.all') : cities.data?.cities.find((item) => item.id === city)?.name;
  if (name === undefined) return null;

  return (
    <>
      <button
        type="button"
        className={styles.switcher}
        aria-haspopup="dialog"
        // Starts with the action and ends with the visible city name (WCAG 2.5.3).
        aria-label={`${t('city.change')}: ${name}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name="map-pin" size={18} />
        <span className={styles.name}>{name}</span>
      </button>
      {open && (
        <CityPrompt
          cities={cities.data?.cities ?? null}
          failed={cities.isError}
          selected={city}
          onSelect={(chosen) => {
            chooseCity(chosen);
            setOpen(false);
          }}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
