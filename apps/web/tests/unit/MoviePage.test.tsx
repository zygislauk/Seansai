import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { freshness, mockApi, TODAY } from '../helpers/mock-api.ts';
import { renderApp } from '../helpers/render-app.tsx';

beforeEach(() => {
  window.localStorage.setItem('seansai.city', 'vilnius');
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

test('shows the movie, today’s timeline and when the data was updated', async () => {
  const api = mockApi();
  renderApp('/en/movie/digger-2026');

  expect(await screen.findByRole('heading', { level: 1, name: 'Kasėjas' })).toBeInTheDocument();
  expect(screen.getByText('Digger')).toBeInTheDocument();
  expect(screen.getByText(/101 min · drama/)).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { level: 2, name: 'Today, Friday 30 October' }),
  ).toBeInTheDocument();
  expect(await screen.findByRole('list', { name: 'Screenings' })).toBeInTheDocument();
  expect(screen.getByRole('contentinfo')).toHaveTextContent('Updated 19:45');
  // Today's screenings are asked for without a date (the server's today), alongside the details.
  expect(api.requested()).toContain('/api/v1/movies/digger-2026/screenings?city=vilnius');
});

test('with no screenings left today, links to the next date that has some', async () => {
  mockApi({
    screenings: { date: TODAY, screenings: [], nextDateWithScreenings: '2026-11-06', freshness },
  });
  renderApp('/en/movie/digger-2026');

  expect(await screen.findByText('No more screenings today')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Next screenings: Friday 6 November' })).toHaveAttribute(
    'href',
    '/en/movie/digger-2026?date=2026-11-06',
  );
});

test('today is selected by default; choosing another date puts it in the URL and loads it', async () => {
  const user = userEvent.setup();
  const api = mockApi();
  const { location } = renderApp('/en/movie/digger-2026');

  const picker = await screen.findByRole('toolbar', { name: 'Choose a date' });
  expect(within(picker).getByRole('button', { pressed: true })).toHaveAccessibleName(
    'Today, Friday 30 October, has screenings',
  );

  await user.click(within(picker).getByRole('button', { name: /Saturday 31 October/ }));

  expect(location()).toBe('/en/movie/digger-2026?date=2026-10-31');
  expect(
    await screen.findByRole('heading', { level: 2, name: 'Saturday 31 October' }),
  ).toBeInTheDocument();
  expect(within(picker).getByRole('button', { pressed: true })).toHaveAccessibleName(
    'Saturday 31 October, has screenings',
  );
  expect(await screen.findByRole('list', { name: 'Screenings' })).toBeInTheDocument();
  expect(api.requested()).toContain(
    '/api/v1/movies/digger-2026/screenings?city=vilnius&date=2026-10-31',
  );

  await user.click(within(picker).getByRole('button', { name: /^Today/ }));
  expect(location()).toBe('/en/movie/digger-2026');
});

test('opens on the date in the URL', async () => {
  const api = mockApi();
  renderApp('/en/movie/digger-2026?date=2026-11-01');

  expect(
    await screen.findByRole('heading', { level: 2, name: 'Sunday 1 November' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { pressed: true })).toHaveAccessibleName('Sunday 1 November');
  expect(await screen.findByRole('list', { name: 'Screenings' })).toBeInTheDocument();
  expect(api.requested()).toContain(
    '/api/v1/movies/digger-2026/screenings?city=vilnius&date=2026-11-01',
  );
});

test.each([
  ['a past date', '2026-10-29'],
  ['a date past the published schedules', '2026-12-31'],
  ['something that is not a date', 'tomorrow'],
])('%s in the URL shows today with a notice', async (_, date) => {
  const api = mockApi();
  renderApp(`/en/movie/digger-2026?date=${date}`);

  expect(
    await screen.findByRole('heading', { level: 2, name: 'Today, Friday 30 October' }),
  ).toBeInTheDocument();
  expect(
    screen.getByText('That date can’t be chosen, so today’s screenings are shown.'),
  ).toBeInTheDocument();
  expect(await screen.findByRole('list', { name: 'Screenings' })).toBeInTheDocument();
  expect(api.requested()).toContain('/api/v1/movies/digger-2026/screenings?city=vilnius');
});

test('keeps the previous list visible with a loading indicator while switching dates', async () => {
  const user = userEvent.setup();
  mockApi({ pending: (url) => url.searchParams.get('date') === '2026-10-31' });
  renderApp('/en/movie/digger-2026');
  const list = await screen.findByRole('list', { name: 'Screenings' });

  await user.click(screen.getByRole('button', { name: /Saturday 31 October/ }));

  expect(
    await screen.findByRole('heading', { level: 2, name: 'Saturday 31 October' }),
  ).toBeInTheDocument();
  expect(list).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Loading screenings…');
});

test('filters narrow the list and live in the URL; when nothing matches, one click clears them', async () => {
  const user = userEvent.setup();
  mockApi();
  const { location } = renderApp('/en/movie/digger-2026?date=2026-10-31');
  const list = await screen.findByRole('list', { name: 'Screenings' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(3);

  await user.click(
    within(screen.getByRole('group', { name: 'Format' })).getByRole('button', { name: '4DX' }),
  );
  expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByText('Showing 1 of 3')).toBeInTheDocument();
  expect(location()).toBe('/en/movie/digger-2026?date=2026-10-31&format=4DX');

  await user.click(
    within(screen.getByRole('group', { name: 'Cinema' })).getByRole('button', {
      name: 'Vue Vilnius',
    }),
  );
  expect(screen.queryByRole('list', { name: 'Screenings' })).not.toBeInTheDocument();
  const noMatch = screen.getByText('No screenings match your filters').parentElement;
  if (!noMatch) throw new Error('expected the empty state');
  await user.click(within(noMatch).getByRole('button', { name: 'Clear filters' }));

  expect(
    within(await screen.findByRole('list', { name: 'Screenings' })).getAllByRole('listitem'),
  ).toHaveLength(3);
  expect(location()).toBe('/en/movie/digger-2026?date=2026-10-31');
});

test('opens with the filters in the URL applied', async () => {
  mockApi();
  renderApp('/en/movie/digger-2026?audio=dubbed');

  const rows = within(await screen.findByRole('list', { name: 'Screenings' })).getAllByRole(
    'listitem',
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveTextContent('Vue Vilnius');
  expect(screen.getByRole('button', { name: 'Dubbed' })).toHaveAttribute('aria-pressed', 'true');
});

test('names the cinemas whose data may be out of date', async () => {
  mockApi({
    screenings: {
      date: TODAY,
      screenings: [],
      nextDateWithScreenings: null,
      freshness: {
        ...freshness,
        staleCinemas: [{ id: 'forum-vingis', name: 'Forum Cinemas Vingis', lastSuccessAt: null }],
      },
    },
  });
  renderApp('/en/movie/digger-2026');

  expect(await screen.findByText('Some information may be out of date')).toBeInTheDocument();
  expect(screen.getByText(/Forum Cinemas Vingis/)).toBeInTheDocument();
  expect(
    screen.getByText('There are no upcoming screenings of this movie in this city.'),
  ).toBeInTheDocument();
});

test('an unknown movie shows "movie not found" with a way back', async () => {
  mockApi();
  renderApp('/en/movie/no-such-movie');

  expect(await screen.findByRole('heading', { name: 'Movie not found' })).toBeInTheDocument();
  expect(
    within(screen.getByRole('main')).getByRole('link', { name: 'Back to the movie list' }),
  ).toHaveAttribute('href', '/en/');
});
