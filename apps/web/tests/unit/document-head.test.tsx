import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { useDocumentHead } from '../../src/app/document-head.ts';
import { pageHead, type PageHead } from '../../src/lib/page-head.ts';
import { diggerDetail } from '../helpers/mock-api.ts';

const metaContents = (name: string) =>
  [...document.head.querySelectorAll<HTMLMetaElement>(`meta[name="${name}"]`)].map(
    (meta) => meta.content,
  );

const SITE = 'https://seansai.vercel.app';

const head = (title: string, robots: 'noindex' | null = null): PageHead => ({
  title,
  description: `About ${title}`,
  robots,
  image: `${SITE}/og-default.png`,
  imageAlt: 'Seansai',
  type: 'website',
  canonical: robots === null ? `${SITE}/lt/${title}` : null,
  alternates:
    robots === null
      ? [
          { hreflang: 'lt', href: `${SITE}/lt/${title}` },
          { hreflang: 'en', href: `${SITE}/en/${title}` },
          { hreflang: 'x-default', href: `${SITE}/lt/${title}` },
        ]
      : [],
});

const canonicals = () =>
  [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]')].map(
    (link) => link.href,
  );

const alternates = () =>
  [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="alternate"]')].map(
    (link) => `${link.hreflang} ${link.href}`,
  );

beforeEach(() => {
  document.head.innerHTML = '<meta name="description" content="From the page">';
  document.title = 'Seansai';
});

afterEach(() => {
  document.head.replaceChildren();
});

test('takes the page’s title and description, updating the tag already there', () => {
  renderHook(() => {
    useDocumentHead(head('One'));
  });

  expect(document.title).toBe('One');
  expect(metaContents('description')).toEqual(['About One']);
});

test('follows the page as people navigate', () => {
  const { rerender } = renderHook(
    ({ page }) => {
      useDocumentHead(page);
    },
    { initialProps: { page: head('One') } },
  );

  rerender({ page: head('Two') });

  expect(document.title).toBe('Two');
  expect(metaContents('description')).toEqual(['About Two']);
});

test('adds a description tag when the page has none, once', () => {
  document.head.replaceChildren();

  const { rerender } = renderHook(
    ({ page }) => {
      useDocumentHead(page);
    },
    { initialProps: { page: head('One') } },
  );
  rerender({ page: head('Two') });

  expect(metaContents('description')).toEqual(['About Two']);
});

test('adds noindex for the not-found page and removes it when leaving', () => {
  const { rerender } = renderHook(
    ({ page }) => {
      useDocumentHead(page);
    },
    { initialProps: { page: head('Not found', 'noindex') } },
  );

  expect(metaContents('robots')).toEqual(['noindex']);

  rerender({ page: head('A movie') });

  expect(metaContents('robots')).toEqual([]);
});

test('leaves everything as it is while the page has nothing to say yet', () => {
  renderHook(() => {
    useDocumentHead(null);
  });

  expect(document.title).toBe('Seansai');
  expect(metaContents('description')).toEqual(['From the page']);
});

test('names the preferred address and the language versions, updating the tags already there', () => {
  document.head.innerHTML = `<link rel="canonical" href="${SITE}/lt/old">
    <link rel="alternate" hreflang="lt" href="${SITE}/lt/old">
    <link rel="alternate" hreflang="en" href="${SITE}/en/old">
    <link rel="alternate" hreflang="x-default" href="${SITE}/lt/old">`;

  const { rerender } = renderHook(
    ({ page }) => {
      useDocumentHead(page);
    },
    { initialProps: { page: head('one') } },
  );
  rerender({ page: head('two') });

  expect(canonicals()).toEqual([`${SITE}/lt/two`]);
  expect(alternates()).toEqual([
    `lt ${SITE}/lt/two`,
    `en ${SITE}/en/two`,
    `x-default ${SITE}/lt/two`,
  ]);
});

test('names neither for a page that has no preferred address', () => {
  const { rerender } = renderHook(
    ({ page }) => {
      useDocumentHead(page);
    },
    { initialProps: { page: head('one') } },
  );

  rerender({ page: head('Not found', 'noindex') });

  expect(canonicals()).toEqual([]);
  expect(alternates()).toEqual([]);
});

describe('at an address with options', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  test('a movie with a date names the plain movie', () => {
    window.history.pushState({}, '', '/lt/movie/digger-2026?date=2026-10-31&format=other');

    renderHook(() => {
      useDocumentHead(pageHead({ kind: 'movie', detail: diggerDetail, city: 'kaunas' }, 'lt'));
    });

    expect(canonicals()).toEqual([`${SITE}/lt/movie/digger-2026`]);
  });

  test('the list for all of Lithuania names the plain list', () => {
    window.history.pushState({}, '', '/en/?city=all');

    renderHook(() => {
      useDocumentHead(pageHead({ kind: 'list' }, 'en'));
    });

    expect(canonicals()).toEqual([`${SITE}/en/`]);
  });
});

describe('after opening 404.html', () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta name="robots" content="noindex">';
  });

  test('a real page removes its noindex', () => {
    renderHook(() => {
      useDocumentHead(pageHead({ kind: 'movie', detail: diggerDetail, city: 'all' }, 'lt'));
    });

    expect(metaContents('robots')).toEqual([]);
  });

  test('the not-found page keeps its noindex', () => {
    renderHook(() => {
      useDocumentHead(pageHead({ kind: 'notFound' }, 'lt'));
    });

    expect(metaContents('robots')).toEqual(['noindex']);
  });

  test('a page still loading keeps its noindex', () => {
    renderHook(() => {
      useDocumentHead(null);
    });

    expect(metaContents('robots')).toEqual(['noindex']);
  });
});
