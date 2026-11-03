import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { mockApi } from '../helpers/mock-api.ts';
import { renderApp } from '../helpers/render-app.tsx';

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

/** A first visit shows all of Lithuania, with the dialog a click away in the header. */
async function openFromHeader(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Change city: All of Lithuania' }));
  return screen.getByRole('dialog', { name: 'Choose your city' });
}

test('offers "All of Lithuania" first, with focus on the current choice', async () => {
  const user = userEvent.setup();
  mockApi();
  renderApp('/en/');

  const dialog = await openFromHeader(user);
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  await within(dialog).findByRole('button', { name: /Kaunas/ });
  const options = within(within(dialog).getByRole('list')).getAllByRole('button');
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

  const dialog = await openFromHeader(user);
  await within(dialog).findByRole('button', { name: /Kaunas/ });
  const buttons = within(dialog).getAllByRole('button');
  buttons.at(-1)?.focus();
  await user.tab();
  expect(buttons[0]).toHaveFocus();
  await user.tab({ shift: true });
  expect(buttons.at(-1)).toHaveFocus();
});

test('saves the choice and shows that city’s movies', async () => {
  const user = userEvent.setup();
  const api = mockApi();
  renderApp('/en/');

  await user.click(
    await within(await openFromHeader(user)).findByRole('button', { name: /Vilnius/ }),
  );

  expect(window.localStorage.getItem('seansai.city')).toBe('vilnius');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Zuikis' })).toBeInTheDocument();
  expect(api.requested()).toContain('/api/v1/movies?city=vilnius');
});

test('a first visit shows all of Lithuania without opening the dialog', async () => {
  const api = mockApi();
  renderApp('/en/');

  expect(await screen.findByRole('heading', { name: 'Zuikis' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.requested()).toContain('/api/v1/movies?city=all');
  expect(window.localStorage.getItem('seansai.city')).toBeNull();
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
