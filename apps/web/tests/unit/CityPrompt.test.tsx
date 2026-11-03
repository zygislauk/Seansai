import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { mockApi } from '../helpers/mock-api.ts';
import { renderApp } from '../helpers/render-app.tsx';

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

test('on a first visit, asks for the city, offering "All of Lithuania" first', async () => {
  mockApi();
  renderApp('/en/');

  const dialog = await screen.findByRole('dialog', { name: 'Choose your city' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  const options = await within(dialog).findAllByRole('button');
  expect(options.map((option) => option.textContent)).toEqual([
    expect.stringContaining('All of Lithuania') as string,
    expect.stringContaining('Vilnius') as string,
    expect.stringContaining('Kaunas') as string,
  ]);
  await waitFor(() => {
    expect(options[0]).toHaveFocus();
  });
});

test('keeps keyboard focus inside the dialog', async () => {
  const user = userEvent.setup();
  mockApi();
  renderApp('/en/');

  const dialog = await screen.findByRole('dialog');
  const options = await within(dialog).findAllByRole('button');
  await waitFor(() => {
    expect(options[0]).toHaveFocus();
  });
  await user.tab({ shift: true });
  expect(options.at(-1)).toHaveFocus();
  await user.tab();
  expect(options[0]).toHaveFocus();
});

test('saves the choice and shows that city’s movies', async () => {
  const user = userEvent.setup();
  const api = mockApi();
  renderApp('/en/');

  await user.click(
    await within(await screen.findByRole('dialog')).findByRole('button', { name: /Vilnius/ }),
  );

  expect(window.localStorage.getItem('seansai.city')).toBe('vilnius');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Zuikis' })).toBeInTheDocument();
  expect(api.requested()).toContain('/api/v1/movies?city=vilnius');
});

test('does not ask again once a city is saved', async () => {
  window.localStorage.setItem('seansai.city', 'kaunas');
  const api = mockApi();
  renderApp('/en/');

  expect(await screen.findByRole('heading', { name: 'Zuikis' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.requested()).toContain('/api/v1/movies?city=kaunas');
});

test('a ?city= link wins over the saved city and becomes the saved city', async () => {
  window.localStorage.setItem('seansai.city', 'kaunas');
  const api = mockApi();
  renderApp('/en/?city=all');

  expect(await screen.findByRole('heading', { name: 'Zuikis' })).toBeInTheDocument();
  expect(api.requested()).toContain('/api/v1/movies?city=all');
  // Saved in an effect, which runs just after the render that shows the heading.
  await waitFor(() => {
    expect(window.localStorage.getItem('seansai.city')).toBe('all');
  });
});

test('asks again when the saved city is no longer supported', async () => {
  window.localStorage.setItem('seansai.city', 'alytus');
  mockApi();
  renderApp('/en/');

  expect(await screen.findByRole('dialog', { name: 'Choose your city' })).toBeInTheDocument();
});
