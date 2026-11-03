import { LangSchema, type Lang } from '@seansai/shared';

/**
 * Settings remembered on this device (contracts/web-routes.md). Storage can be unavailable
 * (privacy settings, private browsing, full quota); the app then still works: it shows all of
 * Lithuania on each visit and takes the language from the URL.
 */
const CITY_KEY = 'seansai.city';
const LANG_KEY = 'seansai.lang';
const LANG_COOKIE = 'seansai_lang';
const ONE_YEAR_SECONDS = 31_536_000;

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

/** Only the `/` redirect in vercel.json reads it, as a redirect can't see localStorage. */
function writeLangCookie(lang: Lang): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  try {
    document.cookie = `${LANG_COOKIE}=${lang}; Max-Age=${String(ONE_YEAR_SECONDS)}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // Cookies are unavailable: `/` simply goes to the default language.
  }
}

export function setLang(lang: Lang): void {
  write(LANG_KEY, lang);
  writeLangCookie(lang);
}

/** For a language remembered before the cookie existed, which `/` would otherwise never see. */
export function copyLangToCookie(): void {
  const lang = getLang();
  if (lang !== null) writeLangCookie(lang);
}
