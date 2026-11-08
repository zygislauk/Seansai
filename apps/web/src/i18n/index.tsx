import type { Lang } from '@seansai/shared';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { en } from './en.ts';
import { lt, type Messages } from './lt.ts';

const catalogues: Record<Lang, Messages> = { lt, en };

/** Dates and times are always shown in Lithuanian local time (FR-016). */
const TIME_ZONE = 'Europe/Vilnius';
const LOCALES: Record<Lang, string> = { lt: 'lt-LT', en: 'en-GB' };

type MessageKey = keyof Messages;
type TextKey = { [Key in MessageKey]: Messages[Key] extends string ? Key : never }[MessageKey];
type PluralKey = Exclude<MessageKey, TextKey>;
type Params = Record<string, string | number>;

function interpolate(template: string, params: Params = {}): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}

export type Translator = {
  lang: Lang;
  t: (key: TextKey, params?: Params) => string;
  /** Picks the plural form for `count` and fills in `{count}`. */
  plural: (key: PluralKey, count: number, params?: Params) => string;
  /** `HH:MM` of an instant, in Vilnius time. */
  formatTime: (instant: string | Date) => string;
  /** A `YYYY-MM-DD` calendar date, e.g. "Saturday 31 October". */
  formatDate: (date: string, options?: Intl.DateTimeFormatOptions) => string;
};

export function createTranslator(lang: Lang): Translator {
  const messages = catalogues[lang];
  const locale = LOCALES[lang];
  const pluralRules = new Intl.PluralRules(locale);
  const timeFormat = new Intl.DateTimeFormat(locale, {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  return {
    lang,
    t: (key, params) => interpolate(messages[key], params),
    plural: (key, count, params) => {
      const forms = messages[key];
      const form = forms[pluralRules.select(count)] ?? forms.other;
      return interpolate(form, { count, ...params });
    },
    formatTime: (instant) => timeFormat.format(new Date(instant)),
    formatDate: (date, options = { weekday: 'long', day: 'numeric', month: 'long' }) =>
      // Noon UTC falls on the same calendar day in Vilnius (UTC+2/+3), so the day never shifts.
      new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, ...options }).format(
        new Date(`${date}T12:00:00Z`),
      ),
  };
}

const I18nContext = createContext<Translator | null>(null);

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const translator = useMemo(() => createTranslator(lang), [lang]);
  return <I18nContext.Provider value={translator}>{children}</I18nContext.Provider>;
}

export function useT(): Translator {
  const translator = useContext(I18nContext);
  if (!translator) throw new Error('useT() must be used inside <I18nProvider>');
  return translator;
}
