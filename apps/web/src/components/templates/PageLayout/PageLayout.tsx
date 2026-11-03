import type { Lang } from '@seansai/shared';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useCity } from '../../../app/city.tsx';
import { useT } from '../../../i18n/index.tsx';
import { setLang } from '../../../storage/settings.ts';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/index.ts';
import { CityChoice } from '../../organisms/CityChoice/index.ts';
import { CitySwitcher } from '../../organisms/CitySwitcher/index.ts';
import styles from './PageLayout.module.scss';

/** Each language is named in its own language, so speakers recognise it (FR-017). */
const LANGUAGES: ReadonlyArray<{ code: Lang; name: string }> = [
  { code: 'lt', name: 'Lietuvių' },
  { code: 'en', name: 'English' },
];

type PageLayoutProps = {
  children: ReactNode;
  /** E.g. the "last updated" time (FR-014). */
  footer?: ReactNode;
};

export function PageLayout({ children, footer }: PageLayoutProps) {
  const { t, lang } = useT();
  const { isChosen } = useCity();
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main">
        {t('layout.skipToContent')}
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to={`/${lang}/`} className={styles.siteName}>
            {t('app.name')}
          </Link>
          <div className={styles.headerControls}>
            <CitySwitcher />
            <LanguageSwitch />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        {!isChosen && <CityChoice />}
        {children}
      </main>
      {footer !== undefined && <footer className={styles.footer}>{footer}</footer>}
    </div>
  );
}

/** Switches the language prefix of the current page, keeping the rest of the address. */
function LanguageSwitch() {
  const { t, lang } = useT();
  const { pathname, search } = useLocation();
  return (
    <nav aria-label={t('layout.languageSwitch')}>
      <ul className={styles.languages}>
        {LANGUAGES.map(({ code, name }) => (
          <li key={code}>
            <Link
              to={pathname.replace(/^\/[^/]+/, `/${code}`) + search}
              lang={code}
              hrefLang={code}
              aria-current={code === lang ? 'true' : undefined}
              className={styles.language}
              onClick={() => {
                setLang(code);
              }}
            >
              <span aria-hidden="true">{code.toUpperCase()}</span>
              <VisuallyHidden>{name}</VisuallyHidden>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
