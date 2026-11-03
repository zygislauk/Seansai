import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { useDocumentHead } from '../../src/app/document-head.ts';

const metaContents = (name: string) =>
  [...document.head.querySelectorAll<HTMLMetaElement>(`meta[name="${name}"]`)].map(
    (meta) => meta.content,
  );

const head = (title: string, robots: 'noindex' | null = null) => ({
  title,
  description: `About ${title}`,
  robots,
});

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
