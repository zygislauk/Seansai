import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { mockApi } from '../helpers/mock-api.ts';
import { renderApp } from '../helpers/render-app.tsx';

const choice = () => screen.queryByRole('region', { name: 'City' });

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

test('on a first visit, shows beside the content, as normal page content', async () => {
  mockApi();
  renderApp('/en/');

  expect(await screen.findByRole('heading', { name: 'Zuikis' })).toBeInTheDocument();
  expect(choice()).toBeInTheDocument();
  expect(screen.getByRole('main')).toContainElement(choice());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('doesn’t take focus', async () => {
  mockApi();
  renderApp('/en/');

  await screen.findByRole('heading', { name: 'Zuikis' });

  expect(document.body).toHaveFocus();
});

test.each([
  ['a remembered city', 'vilnius', '/en/'],
  ['a remembered all of Lithuania', 'all', '/en/'],
])('doesn’t show with %s', async (_, city, path) => {
  window.localStorage.setItem('seansai.city', city);
  mockApi();
  renderApp(path);

  await screen.findByRole('heading', { name: 'Zuikis' });

  expect(choice()).not.toBeInTheDocument();
});

test('doesn’t show with a city in the address', async () => {
  mockApi();
  renderApp('/en/?city=vilnius');

  await screen.findByRole('heading', { name: 'Zuikis' });

  expect(choice()).not.toBeInTheDocument();
});

test('shows on a movie page too', async () => {
  mockApi();
  renderApp('/en/movie/digger-2026');

  expect(await screen.findByRole('heading', { level: 1, name: 'Kasėjas' })).toBeInTheDocument();
  expect(choice()).toBeInTheDocument();
});

test('"Keep all of Lithuania" remembers it and removes the choice', async () => {
  const user = userEvent.setup();
  mockApi();
  renderApp('/en/');

  await user.click(await screen.findByRole('button', { name: 'Keep all of Lithuania' }));

  expect(window.localStorage.getItem('seansai.city')).toBe('all');
  expect(choice()).not.toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveFocus();
});

test('"Choose city" opens the dialog, and choosing there removes the choice', async () => {
  const user = userEvent.setup();
  const api = mockApi();
  renderApp('/en/');

  await user.click(await screen.findByRole('button', { name: 'Choose city' }));
  const dialog = screen.getByRole('dialog', { name: 'Choose your city' });
  await user.click(await within(dialog).findByRole('button', { name: /^Vilnius/ }));

  expect(window.localStorage.getItem('seansai.city')).toBe('vilnius');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(choice()).not.toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveFocus();
  await waitFor(() => {
    expect(api.requested()).toContain('/api/v1/movies?city=vilnius');
  });
});

test('closing the dialog unchanged keeps the choice, and returns focus to its button', async () => {
  const user = userEvent.setup();
  mockApi();
  renderApp('/en/');

  const open = await screen.findByRole('button', { name: 'Choose city' });
  await user.click(open);
  await user.keyboard('{Escape}');

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(choice()).toBeInTheDocument();
  expect(open).toHaveFocus();
  expect(window.localStorage.getItem('seansai.city')).toBeNull();
});

test('a click outside the dialog keeps the choice, and returns focus to its button', async () => {
  const user = userEvent.setup();
  mockApi();
  renderApp('/en/');

  const open = await screen.findByRole('button', { name: 'Choose city' });
  await user.click(open);
  await user.click(screen.getByRole('dialog').parentElement as HTMLElement);

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(choice()).toBeInTheDocument();
  expect(open).toHaveFocus();
  expect(window.localStorage.getItem('seansai.city')).toBeNull();
});
