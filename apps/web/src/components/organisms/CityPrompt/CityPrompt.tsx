import type { CitiesResponse } from '@seansai/shared';
import { useEffect, useId, useRef } from 'react';
import { useT } from '../../../i18n/index.tsx';
import { Button } from '../../atoms/Button/index.ts';
import { Icon } from '../../atoms/Icon/index.ts';
import { Spinner } from '../../atoms/Spinner/index.ts';
import { CityOption } from '../../molecules/CityOption/index.ts';
import styles from './CityPrompt.module.scss';

type CityPromptProps = {
  /** Null while the cities are loading, or when they couldn't be loaded. */
  cities: CitiesResponse['cities'] | null;
  /** The cities couldn't be loaded. All of Lithuania needs no list, so it's still offered. */
  failed?: boolean;
  /** The current choice, when changing an earlier one. */
  selected?: string | null;
  onSelect: (city: string) => void;
  /**
   * When changing an earlier choice: the dialog can be closed (button, Escape or a click outside)
   * unchanged.
   */
  onClose?: () => void;
};

/**
 * Asks for the city on the first visit (FR-013), or lets the user change it, as a modal dialog:
 * focus moves into it (to the current city, if any) and stays there until it closes, then
 * returns to where it was.
 */
export function CityPrompt({
  cities,
  failed = false,
  selected = null,
  onSelect,
  onClose,
}: CityPromptProps) {
  const { t } = useT();
  const titleId = useId();
  const bodyId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const pressStartedOnBackdrop = useRef(false);
  const hasOptions = cities !== null || failed;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    if (!hasOptions) return;
    const current = dialog.current?.querySelector<HTMLElement>('li [aria-pressed="true"]');
    (current ?? dialog.current?.querySelector<HTMLElement>('li button'))?.focus();
  }, [hasOptions]);

  useEffect(() => {
    const element = dialog.current;
    if (!onClose || !element) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    element.addEventListener('keydown', closeOnEscape);
    return () => {
      element.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  // Tab and Shift+Tab wrap around inside the dialog.
  useEffect(() => {
    const element = dialog.current;
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !element) return;
      const buttons = [...element.querySelectorAll('button')];
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    element?.addEventListener('keydown', keepFocusInside);
    return () => element?.removeEventListener('keydown', keepFocusInside);
  }, []);

  return (
    // A pointer shortcut only: keyboard users have Escape and the close button.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Dragging out of the dialog, to select text or with its scrollbar, also ends in a click
        // here.
        if (event.target === event.currentTarget && pressStartedOnBackdrop.current) onClose?.();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className={styles.dialog}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {t('city.promptTitle')}
          </h2>
          {onClose && (
            <Button variant="ghost" size="sm" aria-label={t('common.close')} onClick={onClose}>
              <Icon name="close" />
            </Button>
          )}
        </div>
        <p id={bodyId} className={styles.body}>
          {t('city.promptBody')}
        </p>
        {cities === null && failed && <p role="alert">{t('error.title')}</p>}
        {!hasOptions ? (
          <Spinner label={t('common.loading')} />
        ) : (
          <ul className={styles.options}>
            <li>
              <CityOption
                name={t('city.all')}
                selected={selected === 'all'}
                onSelect={() => {
                  onSelect('all');
                }}
              />
            </li>
            {cities?.map((city) => (
              <li key={city.id}>
                <CityOption
                  name={city.name}
                  cinemaCount={city.cinemaCount}
                  selected={selected === city.id}
                  onSelect={() => {
                    onSelect(city.id);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
