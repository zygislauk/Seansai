import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useMatch, useNavigate, useParams, useSearchParams } from 'react-router';
import { forgetCity as forgetStoredCity, getCity, setCity } from '../storage/settings.ts';

type RememberedCity = {
  city: string | null;
  /** The city last found to be unsupported; a link naming it is ignored. */
  forgotten: string | null;
  remember: (city: string) => void;
  forget: (city: string) => void;
};

const RememberedCityContext = createContext<RememberedCity | null>(null);

/**
 * Holds the city remembered on this device, shared by every component that shows or changes it
 * (the header's city switcher and the pages). Still works for the visit when storage is
 * unavailable.
 */
export function CityProvider({ children }: { children: ReactNode }) {
  const [city, setRemembered] = useState(getCity);
  const [forgotten, setForgotten] = useState<string | null>(null);
  // Stable, so an effect that remembers a city runs for a new city, not for each change of it.
  const remember = useCallback((next: string) => {
    setCity(next);
    setRemembered(next);
  }, []);
  const forget = useCallback((unsupported: string) => {
    forgetStoredCity();
    setRemembered(null);
    setForgotten(unsupported);
  }, []);
  const value = useMemo<RememberedCity>(
    () => ({ city, forgotten, remember, forget }),
    [city, forgotten, remember, forget],
  );
  return <RememberedCityContext value={value}>{children}</RememberedCityContext>;
}

/**
 * The city to show (contracts/web-routes.md): a city page's own city; then a `?city=` link, so
 * shared links show the same screenings, which becomes the remembered city; otherwise the city
 * remembered on this device; otherwise all of Lithuania, with `isChosen` false.
 */
export function useCity(): {
  city: string;
  isChosen: boolean;
  /** Remembers the city, and on a list page goes to that city's page. */
  chooseCity: (city: string) => void;
  /** Only the page can tell a city page's city is real, so it remembers it once it knows. */
  rememberCity: (city: string) => void;
  /** For a city the API doesn't know: only the pages can see that error (research.md §9). */
  forgetCity: () => void;
} {
  const remembered = useContext(RememberedCityContext);
  if (!remembered) throw new Error('useCity() must be used inside <CityProvider>');
  const { city, forgotten, remember, forget } = remembered;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { lang, cityId } = useParams();
  const { pathname } = useLocation();
  const onGeneralList = useMatch('/:lang') !== null;
  const onCityPage = useMatch('/:lang/city/:cityId') !== null;
  const named = params.get('city');
  const fromLink = onCityPage || named === forgotten ? null : named;
  const chosen = cityId ?? fromLink ?? city;

  useEffect(() => {
    if (fromLink !== null) remember(fromLink);
  }, [fromLink, remember]);

  const replaceSearch = useCallback(
    (search: URLSearchParams) => {
      const query = search.toString();
      void navigate(
        { search: query === '' ? '' : `?${query}` },
        { replace: true, preventScrollReset: true },
      );
    },
    [navigate],
  );

  const chooseCity = (next: string) => {
    remember(next);
    if (onGeneralList || onCityPage) {
      const page = next === 'all' ? `/${lang ?? ''}/` : `/${lang ?? ''}/city/${next}`;
      if (page !== pathname || params.size > 0) void navigate(page);
      return;
    }
    // A link's city would otherwise keep overriding the new choice, and cinema filters name
    // cinemas of the old city.
    if (fromLink === null && !params.has('cinema')) return;
    const search = new URLSearchParams(params);
    if (fromLink !== null) search.set('city', next);
    search.delete('cinema');
    replaceSearch(search);
  };

  const forgetCity = useCallback(() => {
    if (chosen !== null) forget(chosen);
    if (named === null) return;
    const search = new URLSearchParams(params);
    search.delete('city');
    replaceSearch(search);
  }, [chosen, forget, named, params, replaceSearch]);

  return {
    city: chosen ?? 'all',
    isChosen: chosen !== null,
    chooseCity,
    rememberCity: remember,
    forgetCity,
  };
}
