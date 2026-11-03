import { renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { CityProvider, useCity } from '../../src/app/city.tsx';
import { mockApi } from '../helpers/mock-api.ts';
import { renderApp } from '../helpers/render-app.tsx';

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('routes (contracts/web-routes.md)', () => {
  test('"/" redirects to Lithuanian by default', async () => {
    const app = renderApp('/');

    await waitFor(() => {
      expect(app.location()).toBe('/lt/');
    });
  });

  test('"/" redirects to the remembered language', async () => {
    window.localStorage.setItem('seansai.lang', 'en');
    const app = renderApp('/');

    await waitFor(() => {
      expect(app.location()).toBe('/en/');
    });
  });

  test('an unknown language prefix redirects to the same page in Lithuanian', async () => {
    window.localStorage.setItem('seansai.city', 'vilnius');
    mockApi();
    const app = renderApp('/de/movie/digger-2026?date=2026-10-31');

    await waitFor(() => {
      expect(app.location()).toBe('/lt/movie/digger-2026?date=2026-10-31');
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Kasėjas' })).toBeInTheDocument();
  });

  test('the shell renders in Lithuanian and sets <html lang>', async () => {
    renderApp('/lt/');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Dabar rodomi filmai' }),
    ).toBeInTheDocument();
    // Set in an effect, which runs just after the render that shows the heading.
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('lt');
    });
  });

  test('the shell renders in English and sets <html lang>', async () => {
    renderApp('/en/');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Now showing' }),
    ).toBeInTheDocument();
    // Set in an effect, which runs just after the render that shows the heading.
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('en');
    });
  });

  test('the list page describes itself to the document', async () => {
    mockApi();
    renderApp('/en/');

    await screen.findByRole('heading', { name: 'Zuikis' });

    expect(document.title).toBe('Cinema screenings across Lithuania – Seansai');
  });

  test('a first visit offers the choice of city without asking first', async () => {
    mockApi();
    renderApp('/en/');

    expect(await screen.findByRole('region', { name: 'City' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('an unknown page shows "not found" with a link back to the movie list', async () => {
    renderApp('/en/no/such/page');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the movie list' })).toHaveAttribute(
      'href',
      '/en/',
    );
  });
});

describe('useCity', () => {
  const cityAt = (path: string) =>
    renderHook(
      () => {
        const { city, isChosen, forgetCity } = useCity();
        return { city, isChosen, forgetCity, search: useLocation().search };
      },
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <MemoryRouter initialEntries={[path]}>
            <CityProvider>{children}</CityProvider>
          </MemoryRouter>
        ),
      },
    ).result;

  test('is all of Lithuania, not yet chosen, when nothing is remembered', () => {
    expect(cityAt('/lt/').current).toMatchObject({ city: 'all', isChosen: false });
  });

  test('keeps a remembered city, as chosen', () => {
    window.localStorage.setItem('seansai.city', 'kaunas');

    expect(cityAt('/lt/').current).toMatchObject({ city: 'kaunas', isChosen: true });
  });

  test('a remembered choice of all of Lithuania counts as chosen', () => {
    window.localStorage.setItem('seansai.city', 'all');

    expect(cityAt('/lt/').current).toMatchObject({ city: 'all', isChosen: true });
  });

  test('a link names the city, which counts as chosen and is remembered', async () => {
    expect(cityAt('/lt/?city=vilnius').current).toMatchObject({ city: 'vilnius', isChosen: true });
    await waitFor(() => {
      expect(window.localStorage.getItem('seansai.city')).toBe('vilnius');
    });
  });
});

describe('a city that is no longer supported', () => {
  test.each([
    ['list page', '/en/', 'Bunny'],
    ['movie page', '/en/movie/digger-2026', 'Kasėjas'],
  ])('on the %s, a stored city is forgotten', async (_, path, content) => {
    window.localStorage.setItem('seansai.city', 'riga');
    const api = mockApi();
    const { location } = renderApp(path);

    expect((await screen.findAllByText(content))[0]).toBeInTheDocument();
    await waitFor(() => {
      expect(window.localStorage.getItem('seansai.city')).toBeNull();
    });
    expect(location()).toBe(path);
    expect(api.requested().some((url) => url.includes('city=all'))).toBe(true);
  });

  test.each([
    ['list page', '/en/?city=riga', '/en/', 'Bunny'],
    [
      'movie page',
      '/en/movie/digger-2026?city=riga&date=2026-10-31',
      '/en/movie/digger-2026?date=2026-10-31',
      'Kasėjas',
    ],
  ])('on the %s, a link drops the option from the address', async (_, path, clean, content) => {
    const api = mockApi();
    const { location } = renderApp(path);

    expect((await screen.findAllByText(content))[0]).toBeInTheDocument();
    await waitFor(() => {
      expect(location()).toBe(clean);
    });
    expect(window.localStorage.getItem('seansai.city')).toBeNull();
    expect(api.requested().some((url) => url.includes('city=all'))).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
