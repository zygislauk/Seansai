import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { mockApi } from '../helpers/mock-api.ts';
import { renderApp } from '../helpers/render-app.tsx';

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

test('has a skip link, a site name linking home and a main landmark', async () => {
  renderApp('/lt/movie/digger-2026');

  expect(await screen.findByRole('main')).toHaveAttribute('id', 'main');
  expect(screen.getByRole('link', { name: 'Pereiti prie turinio' })).toHaveAttribute(
    'href',
    '#main',
  );
  expect(screen.getByRole('link', { name: 'Seansai' })).toHaveAttribute('href', '/lt/');
});

test('the language switch marks the current language and names each in its own language', async () => {
  renderApp('/lt/');

  const nav = await screen.findByRole('navigation', { name: 'Kalba' });
  const lithuanian = screen.getByRole('link', { name: 'Lietuvių' });
  const english = screen.getByRole('link', { name: 'English' });
  expect(nav).toContainElement(english);
  expect(lithuanian).toHaveAttribute('aria-current', 'true');
  expect(english).not.toHaveAttribute('aria-current');
  expect(english).toHaveAttribute('lang', 'en');
});

test('switching language keeps the page and its parameters, and is remembered (FR-017)', async () => {
  const user = userEvent.setup();
  window.localStorage.setItem('seansai.city', 'vilnius');
  mockApi();
  const app = renderApp('/lt/movie/digger-2026?date=2026-10-31');

  const english = await screen.findByRole('link', { name: 'English' });
  expect(english).toHaveAttribute('href', '/en/movie/digger-2026?date=2026-10-31');
  await user.click(english);

  await waitFor(() => {
    expect(app.location()).toBe('/en/movie/digger-2026?date=2026-10-31');
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Kasėjas' })).toBeInTheDocument();
  expect(
    await screen.findByRole('heading', { level: 2, name: /^Saturday 31 October/ }),
  ).toBeInTheDocument();
  expect(window.localStorage.getItem('seansai.lang')).toBe('en');
  expect(screen.getByRole('navigation', { name: 'Language' })).toBeInTheDocument();
});

test('the header shows the chosen city and lets the user change it (US3)', async () => {
  const user = userEvent.setup();
  window.localStorage.setItem('seansai.city', 'vilnius');
  const api = mockApi();
  renderApp('/en/');

  await user.click(await screen.findByRole('button', { name: 'Change city: Vilnius' }));
  const dialog = screen.getByRole('dialog', { name: 'Choose your city' });
  expect(within(dialog).getByRole('button', { name: /^Vilnius/ })).toHaveFocus();
  await user.click(within(dialog).getByRole('button', { name: /^Kaunas/ }));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Change city: Kaunas' })).toBeInTheDocument();
  expect(window.localStorage.getItem('seansai.city')).toBe('kaunas');
  await waitFor(() => {
    expect(api.requested()).toContain('/api/v1/movies?city=kaunas');
  });
});

test('the header’s switcher stays available beside the choice of city on a first visit', async () => {
  mockApi();
  renderApp('/en/');

  expect(
    await screen.findByRole('button', { name: 'Change city: All of Lithuania' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'City' })).toBeInTheDocument();
});

test('the city dialog closes unchanged with Escape or the close button', async () => {
  const user = userEvent.setup();
  window.localStorage.setItem('seansai.city', 'vilnius');
  mockApi();
  renderApp('/en/');
  const switcher = await screen.findByRole('button', { name: 'Change city: Vilnius' });

  await user.click(switcher);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(switcher).toHaveFocus();

  await user.click(switcher);
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(window.localStorage.getItem('seansai.city')).toBe('vilnius');
});

test('changing city on a movie page updates a linked city and drops the cinema filter', async () => {
  const user = userEvent.setup();
  mockApi();
  const app = renderApp('/en/movie/digger-2026?city=vilnius&cinema=skalvija&format=3D');

  await user.click(await screen.findByRole('button', { name: 'Change city: Vilnius' }));
  await user.click(screen.getByRole('button', { name: /^All of Lithuania/ }));

  await waitFor(() => {
    expect(app.location()).toBe('/en/movie/digger-2026?city=all&format=3D');
  });
  expect(
    await screen.findByRole('button', { name: 'Change city: All of Lithuania' }),
  ).toBeInTheDocument();
});
