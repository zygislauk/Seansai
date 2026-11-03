import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  cities,
  diggerDetail,
  diggerScreenings,
  freshness,
  mockApi,
  movies,
  TODAY,
} from '../helpers/mock-api.ts';

/** `main.tsx` starts the app when it's imported, so each test imports its own copy. */
const startApp = () => import('../../src/main.tsx');

/** A page as `prerender.ts` writes it. */
async function writeSnapshot(path: string, { withData = true } = {}) {
  const { citiesQuery, movieQuery, moviesQuery, screeningsQuery } =
    await import('../../src/api/hooks.ts');
  const { createQueryClient } = await import('../../src/app/providers.tsx');
  const { renderPage } = await import('../../src/entry-prerender.tsx');

  const queryClient = createQueryClient();
  queryClient.setQueryData(citiesQuery('lt').queryKey, cities);
  queryClient.setQueryData(moviesQuery('all').queryKey, movies);
  queryClient.setQueryData(movieQuery('digger-2026', 'all', 'lt').queryKey, diggerDetail);
  queryClient.setQueryData(screeningsQuery('digger-2026', 'all', null).queryKey, {
    date: TODAY,
    screenings: diggerScreenings,
    nextDateWithScreenings: null,
    freshness,
  });
  const { markup, initialData } = await renderPage(path, queryClient);

  window.history.pushState({}, '', path);
  document.body.innerHTML = `<div id="root">${markup}</div>`;
  if (withData) {
    const data = document.createElement('script');
    data.id = 'initial-data';
    data.type = 'application/json';
    data.textContent = JSON.stringify(initialData);
    document.body.append(data);
  }
  const heading = document.querySelector('h1');
  if (!heading) throw new Error('expected the snapshot to have a heading');
  return heading;
}

/** The old heading goes first: the snapshot holds the same movies the app then renders. */
async function expectReplaced(snapshotHeading: HTMLElement) {
  await waitFor(() => {
    expect(snapshotHeading.isConnected).toBe(false);
  });
  expect(await screen.findByRole('heading', { name: 'Zuikis' })).toBeInTheDocument();
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  consoleError = vi.spyOn(console, 'error');
  document.documentElement.removeAttribute('data-boot');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.body.replaceChildren();
});

test.each([
  ['movie list', '/lt/', '/api/v1/movies?city=all'],
  ['movie', '/lt/movie/digger-2026', '/api/v1/movies/digger-2026?city=all&lang=lt'],
])('takes over a %s snapshot without replacing it, then refreshes', async (_, path, request) => {
  const heading = await writeSnapshot(path);
  const api = mockApi();

  await startApp();

  await waitFor(() => {
    expect(api.requested()).toContain(request);
  });
  expect(heading.isConnected).toBe(true);
  expect(consoleError).not.toHaveBeenCalled();
});

test('with data-boot="client", replaces the snapshot and shows the page again', async () => {
  const heading = await writeSnapshot('/lt/');
  document.documentElement.dataset.boot = 'client';
  mockApi();

  await startApp();

  await expectReplaced(heading);
  expect(document.documentElement.dataset.boot).toBeUndefined();
  expect(consoleError).not.toHaveBeenCalled();
});

test('with no embedded data, replaces the snapshot', async () => {
  const heading = await writeSnapshot('/lt/', { withData: false });
  mockApi();

  await startApp();

  await expectReplaced(heading);
});

test('with malformed embedded data, says so and replaces the snapshot', async () => {
  const heading = await writeSnapshot('/lt/');
  const data = document.getElementById('initial-data');
  if (data) data.textContent = '{ not json';
  mockApi();

  await startApp();

  await expectReplaced(heading);
  expect(consoleError).toHaveBeenCalledWith(
    expect.stringContaining('page data'),
    expect.anything(),
  );
});

test('with no snapshot at all (self-hosted, or a page newer than the snapshot), renders the app', async () => {
  window.history.pushState({}, '', '/lt/');
  document.body.innerHTML = '<div id="root"></div>';
  document.documentElement.dataset.boot = 'client';
  mockApi();

  await startApp();

  expect(await screen.findByRole('heading', { name: 'Zuikis' })).toBeInTheDocument();
  expect(document.documentElement.dataset.boot).toBeUndefined();
});
