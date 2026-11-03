import { renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { CityProvider, useCity } from '../../src/app/city.tsx';
import { SITE_URL } from '../../src/lib/site.ts';
import { mockApi, movies } from '../helpers/mock-api.ts';
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

const canonical = () => document.head.querySelector('link[rel="canonical"]')?.getAttribute('href');

describe('a city page (/{lang}/city/{cityId})', () => {
  afterEach(() => {
    document.head.querySelector('link[rel="canonical"]')?.remove();
  });

  test('shows that city, asks nothing and remembers it', async () => {
    const { requested } = mockApi();
    renderApp('/en/city/vilnius');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Cinema screenings in Vilnius' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(window.localStorage.getItem('seansai.city')).toBe('vilnius');
    });
    expect(requested().some((url) => url.includes('/movies?city=vilnius'))).toBe(true);
    expect(screen.queryByRole('region', { name: 'City' })).not.toBeInTheDocument();
    expect(canonical()).toBe(`${SITE_URL}/en/city/vilnius`);
  });

  test('wins over the remembered city', async () => {
    window.localStorage.setItem('seansai.city', 'kaunas');
    const { requested } = mockApi();
    renderApp('/en/city/vilnius');

    await waitFor(() => {
      expect(window.localStorage.getItem('seansai.city')).toBe('vilnius');
    });
    expect(requested().some((url) => url.includes('/movies?city=kaunas'))).toBe(false);
  });

  test('an unknown city shows the not-found page and leaves the remembered city alone', async () => {
    window.localStorage.setItem('seansai.city', 'kaunas');
    mockApi();
    renderApp('/en/city/riga');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem('seansai.city')).toBe('kaunas');
    await waitFor(() => {
      expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
        'content',
        'noindex',
      );
    });
    expect(canonical()).toBeUndefined();
  });

  test('choosing another city goes to its page', async () => {
    const user = userEvent.setup();
    mockApi();
    const app = renderApp('/en/city/vilnius');

    await user.click(await screen.findByRole('button', { name: 'Change city: Vilnius' }));
    await user.click(await screen.findByRole('button', { name: /Kaunas/ }));

    await waitFor(() => {
      expect(app.location()).toBe('/en/city/kaunas');
    });
    expect(window.localStorage.getItem('seansai.city')).toBe('kaunas');
  });

  test('choosing all of Lithuania goes to the general list and stays there', async () => {
    const user = userEvent.setup();
    mockApi();
    const app = renderApp('/en/city/vilnius');

    await user.click(await screen.findByRole('button', { name: 'Change city: Vilnius' }));
    await user.click(await screen.findByRole('button', { name: /All of Lithuania/ }));

    await waitFor(() => {
      expect(app.location()).toBe('/en/');
    });
    await screen.findByRole('button', { name: 'Change city: All of Lithuania' });
    expect(window.localStorage.getItem('seansai.city')).toBe('all');
  });

  test('choosing all of Lithuania from a ?city= link also goes to the general list', async () => {
    const user = userEvent.setup();
    mockApi();
    const app = renderApp('/en/?city=vilnius');

    await user.click(await screen.findByRole('button', { name: 'Change city: Vilnius' }));
    await user.click(await screen.findByRole('button', { name: /All of Lithuania/ }));

    await waitFor(() => {
      expect(app.location()).toBe('/en/');
    });
    await screen.findByRole('button', { name: 'Change city: All of Lithuania' });
    expect(window.localStorage.getItem('seansai.city')).toBe('all');
  });

  test('choosing a city on a movie page stays on that page', async () => {
    const user = userEvent.setup();
    mockApi();
    const app = renderApp('/en/movie/digger-2026');

    await user.click(await screen.findByRole('button', { name: 'Change city: All of Lithuania' }));
    await user.click(await screen.findByRole('button', { name: /Kaunas/ }));

    await waitFor(() => {
      expect(window.localStorage.getItem('seansai.city')).toBe('kaunas');
    });
    expect(app.location()).toBe('/en/movie/digger-2026');
  });

  test('with no current movies, it shows the empty message', async () => {
    mockApi({ movies: { ...movies, movies: [] } });
    renderApp('/en/city/kaunas');

    expect(await screen.findByText('No upcoming screenings in this city.')).toBeInTheDocument();
  });
});

describe('the list page’s preferred address follows its address', () => {
  afterEach(() => {
    document.head.querySelector('link[rel="canonical"]')?.remove();
  });

  test('/lt/?city=vilnius names the city page', async () => {
    mockApi();
    renderApp('/lt/?city=vilnius');

    await waitFor(() => {
      expect(canonical()).toBe(`${SITE_URL}/lt/city/vilnius`);
    });
  });

  test('/lt/ with Vilnius remembered names /lt/', async () => {
    window.localStorage.setItem('seansai.city', 'vilnius');
    mockApi();
    renderApp('/lt/');

    await waitFor(() => {
      expect(canonical()).toBe(`${SITE_URL}/lt/`);
    });
  });

  test('/lt/?city=riga names /lt/ once the unknown city is forgotten', async () => {
    mockApi();
    const app = renderApp('/lt/?city=riga');

    await waitFor(() => {
      expect(app.location()).toBe('/lt/');
    });
    await waitFor(() => {
      expect(canonical()).toBe(`${SITE_URL}/lt/`);
    });
  });
});

describe('links to city pages on the general list', () => {
  const someEmpty = {
    cities: [
      { id: 'vilnius', name: 'Vilnius', cinemaCount: 8, hasMovies: true },
      { id: 'kaunas', name: 'Kaunas', cinemaCount: 3, hasMovies: false },
    ],
  };

  test('link only to cities with current movies', async () => {
    mockApi({ cities: someEmpty });
    renderApp('/en/');

    const nav = await screen.findByRole('navigation', { name: 'Browse by city' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/en/city/vilnius']);
  });

  test('stay off a city page', async () => {
    mockApi();
    renderApp('/en/city/vilnius');

    await screen.findByRole('heading', { level: 1, name: 'Cinema screenings in Vilnius' });
    expect(screen.queryByRole('navigation', { name: 'Browse by city' })).not.toBeInTheDocument();
  });
});
