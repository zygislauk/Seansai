import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  copyLangToCookie,
  forgetCity,
  getCity,
  getLang,
  setCity,
  setLang,
} from '../../src/storage/settings.ts';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.cookie = 'seansai_lang=; Max-Age=0; Path=/';
});

describe('settings', () => {
  test('remembers the city under seansai.city', () => {
    expect(getCity()).toBeNull();
    setCity('kaunas');
    expect(getCity()).toBe('kaunas');
    expect(window.localStorage.getItem('seansai.city')).toBe('kaunas');
  });

  test('forgets the remembered city', () => {
    setCity('kaunas');
    forgetCity();
    expect(getCity()).toBeNull();
    expect(window.localStorage.getItem('seansai.city')).toBeNull();
  });

  test('remembers the language under seansai.lang', () => {
    expect(getLang()).toBeNull();
    setLang('en');
    expect(getLang()).toBe('en');
    expect(window.localStorage.getItem('seansai.lang')).toBe('en');
  });

  test('ignores a stored language that is not supported', () => {
    window.localStorage.setItem('seansai.lang', 'de');
    expect(getLang()).toBeNull();
  });

  test('keeps working when storage throws (e.g. blocked by privacy settings)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    expect(() => {
      setCity('vilnius');
      setLang('en');
      forgetCity();
    }).not.toThrow();
    expect(getCity()).toBeNull();
    expect(getLang()).toBeNull();
  });

  test('keeps working when localStorage itself cannot be accessed', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Access is denied', 'SecurityError');
    });

    expect(() => {
      setCity('vilnius');
    }).not.toThrow();
    expect(getCity()).toBeNull();
  });
});

describe('the language cookie', () => {
  const ONE_YEAR = 'Max-Age=31536000';

  test('choosing a language writes it for a year, for the whole site', () => {
    const written = vi.spyOn(document, 'cookie', 'set');

    setLang('en');

    expect(document.cookie).toBe('seansai_lang=en');
    expect(written).toHaveBeenCalledExactlyOnceWith(
      `seansai_lang=en; ${ONE_YEAR}; Path=/; SameSite=Lax`,
    );
  });

  test('is marked Secure on HTTPS', () => {
    const written = vi.spyOn(document, 'cookie', 'set').mockImplementation(() => undefined);
    vi.stubGlobal('location', new URL('https://seansai.lt/lt/'));

    setLang('lt');

    vi.unstubAllGlobals();
    expect(written).toHaveBeenCalledExactlyOnceWith(
      `seansai_lang=lt; ${ONE_YEAR}; Path=/; SameSite=Lax; Secure`,
    );
  });

  test('a language remembered before the cookie existed is copied to it', () => {
    window.localStorage.setItem('seansai.lang', 'en');

    copyLangToCookie();

    expect(document.cookie).toBe('seansai_lang=en');
  });

  test('nothing else writes it: no remembered language, or an unsupported one', () => {
    copyLangToCookie();
    window.localStorage.setItem('seansai.lang', 'de');
    copyLangToCookie();
    getLang();
    setCity('kaunas');
    forgetCity();

    expect(document.cookie).toBe('');
  });

  test('keeps working when cookies are refused', () => {
    vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    expect(() => {
      setLang('en');
    }).not.toThrow();
    expect(getLang()).toBe('en');
  });
});
