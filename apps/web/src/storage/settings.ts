import { LangSchema, type Lang } from '@seansai/shared';

/**
 * Settings remembered on this device (contracts/web-routes.md). Storage can be unavailable
 * (privacy settings, private browsing, full quota); the app then still works: it shows all of
 * Lithuania on each visit and takes the language from the URL.
 */
const CITY_KEY = 'seansai.city';
const LANG_KEY = 'seansai.lang';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage is unavailable: behave as if nothing was saved.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage is unavailable: the setting simply is not remembered.
  }
}

/** A city id or `all`; validated against the city list by the caller. */
export function getCity(): string | null {
  return read(CITY_KEY);
}

export function setCity(city: string): void {
  write(CITY_KEY, city);
}

export function forgetCity(): void {
  try {
    window.localStorage.removeItem(CITY_KEY);
  } catch {
    // Storage is unavailable: nothing was remembered.
  }
}

export function getLang(): Lang | null {
  const parsed = LangSchema.safeParse(read(LANG_KEY));
  return parsed.success ? parsed.data : null;
}

export function setLang(lang: Lang): void {
  write(LANG_KEY, lang);
}
