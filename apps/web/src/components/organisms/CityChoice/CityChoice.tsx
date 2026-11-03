import { useState } from 'react';
import { useCities } from '../../../api/hooks.ts';
import { useCity } from '../../../app/city.tsx';
import { useT } from '../../../i18n/index.tsx';
import { Button } from '../../atoms/Button/index.ts';
import { CityPrompt } from '../CityPrompt/index.ts';
import styles from './CityChoice.module.scss';

/**
 * Offers a first-time visitor their city, beside content they can already read (FR-006): normal page
 * content in reading order, rather than a dialog that would cover it and take focus.
 */
export function CityChoice() {
  const { t, lang } = useT();
  const { chooseCity } = useCity();
  const cities = useCities(lang);
  const [open, setOpen] = useState(false);

  const answer = (city: string) => {
    chooseCity(city);
    // This section goes away with the button that has focus, so keyboard users continue from here.
    document.getElementById('main')?.focus();
  };

  return (
    <section aria-label={t('city.choiceLabel')} className={styles.choice}>
      <p>{t('city.choiceBody')}</p>
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('city.choose')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            answer('all');
          }}
        >
          {t('city.keepAll')}
        </Button>
      </div>
      {open && (
        <CityPrompt
          cities={cities.data?.cities ?? null}
          onSelect={answer}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </section>
  );
}
