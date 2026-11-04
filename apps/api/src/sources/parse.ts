import type { ScreeningFormat } from '@seansai/shared';
import { normalizeTitle } from '../matching/normalize.ts';

/**
 * Parsing helpers shared by the adapters: each cinema spells formats, languages, age ratings and
 * durations its own way, and these turn them into the SourceScreening vocabulary.
 */

/** "IMAX 3D" counts as IMAX: the premium format is what users filter for. */
export function formatOf(label: string | null | undefined): ScreeningFormat | null {
  const text = label?.trim().toLowerCase() ?? '';
  if (text === '') return null;
  if (text.includes('imax')) return 'IMAX';
  if (text.includes('4dx')) return '4DX';
  if (text.includes('screenx')) return 'ScreenX';
  if (/\b3d\b/.test(text)) return '3D';
  if (/\b2d\b/.test(text)) return '2D';
  return 'other';
}

/** Lithuanian and English language names (diacritics stripped), as cinemas print them. */
const LANGUAGE_CODES: Record<string, string> = {
  lietuviu: 'lt',
  lithuanian: 'lt',
  anglu: 'en',
  english: 'en',
  rusu: 'ru',
  russian: 'ru',
  lenku: 'pl',
  polish: 'pl',
  vokieciu: 'de',
  german: 'de',
  prancuzu: 'fr',
  french: 'fr',
  ispanu: 'es',
  spanish: 'es',
  italu: 'it',
  italian: 'it',
  ukrainieciu: 'uk',
  ukrainian: 'uk',
  japonu: 'ja',
  japanese: 'ja',
  korejieciu: 'ko',
  koreju: 'ko',
  korean: 'ko',
  kinu: 'zh',
  chinese: 'zh',
  danu: 'da',
  danish: 'da',
  norvegu: 'no',
  norwegian: 'no',
  svedu: 'sv',
  swedish: 'sv',
  suomiu: 'fi',
  finnish: 'fi',
  estu: 'et',
  estonian: 'et',
  latviu: 'lv',
  latvian: 'lv',
  olandu: 'nl',
  dutch: 'nl',
  portugalu: 'pt',
  portuguese: 'pt',
  ceku: 'cs',
  czech: 'cs',
  vengru: 'hu',
  hungarian: 'hu',
  graiku: 'el',
  greek: 'el',
  turku: 'tr',
  turkish: 'tr',
  arabu: 'ar',
  arabic: 'ar',
  persu: 'fa',
  persian: 'fa',
  hebraju: 'he',
  hebrew: 'he',
  hindi: 'hi',
  islandu: 'is',
  icelandic: 'is',
  rumunu: 'ro',
  romanian: 'ro',
  gruzinu: 'ka',
  kartvelu: 'ka',
  georgian: 'ka',
  armenu: 'hy',
  armenian: 'hy',
};

/**
 * ISO 639-1 code of a language name such as "Anglų k.", "Lietuvių sub.", "Korean" or "EN";
 * null when it is missing or unknown.
 */
export function languageOf(name: string | null | undefined): string | null {
  const words = normalizeWords(name ?? '').filter(
    (word) => !['k', 'kalba', 'sub', 'subtitrai'].includes(word),
  );
  const [word] = words;
  if (word === undefined) return null;
  // A bare code ("EN") is a language; "NO SUBT." is not Norwegian.
  const isBareCode = words.length === 1 && /^[a-z]{2}$/.test(word);
  if (isBareCode && Object.values(LANGUAGE_CODES).includes(word)) return word;
  return LANGUAGE_CODES[word] ?? null;
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length > 0);
}

/** "N-13", "N13" and "18" become "N13"/"N18"; "V" (all ages) stays; placeholders are null. */
export function ageRatingOf(text: string | null | undefined): string | null {
  const value = text?.trim().toUpperCase() ?? '';
  if (value === 'V') return 'V';
  const age = /^N?-?\s*(\d{1,2})\b/.exec(value)?.[1];
  return age === undefined ? null : `N${age}`;
}

/** Minutes from text such as "90 min." or "Komedija · 104 min". */
export function minutesOf(text: string | null | undefined): number | null {
  const minutes = /(\d{1,3})\s*min/i.exec(text ?? '')?.[1];
  return minutes === undefined ? null : Number(minutes);
}

/** Minutes from "H.MM", e.g. Skalvija's "1.58" (1 h 58 min). */
export function hoursAndMinutesOf(text: string | null | undefined): number | null {
  const match = /^(\d{1,2})\.(\d{2})$/.exec(text?.trim() ?? '');
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

type DubbingFacts = {
  title: string;
  originalTitle: string | null;
  spokenLanguage: string | null;
  subtitleLanguage: string | null;
  /** The cinema marked the screening as dubbed ("dubliuotas", "įgarsinta lietuviškai"). */
  marked?: boolean;
};

/**
 * Whether a screening is a Lithuanian-dubbed version (the "dubbed" audio filter, US3). Few
 * cinemas say so directly, so a foreign film (its original title differs from the Lithuanian
 * one) spoken in Lithuanian also counts as dubbed. Null when the source says nothing.
 */
export function dubbingOf(facts: DubbingFacts): boolean | null {
  if (facts.marked) return true;
  if (facts.spokenLanguage === null) return facts.subtitleLanguage === null ? null : false;
  if (facts.spokenLanguage !== 'lt') return false;
  if (facts.originalTitle === null) return null;
  return normalizeTitle(facts.originalTitle) !== normalizeTitle(facts.title);
}

/** Resolves a link from a page against the page's address. */
export function absoluteUrl(href: string, base: string): string {
  return new URL(href, base).toString();
}
