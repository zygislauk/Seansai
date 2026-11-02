import { afterEach, describe, expect, test, vi } from 'vitest';
import { forgetCity, getCity, getLang, setCity, setLang } from '../../src/storage/settings.ts';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
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
