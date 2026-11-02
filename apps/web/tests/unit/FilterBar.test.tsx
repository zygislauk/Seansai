import type { Screening } from '@seansai/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { useFilters } from '../../src/app/filters.ts';
import { FilterBar } from '../../src/components/organisms/FilterBar/index.ts';
import { I18nProvider } from '../../src/i18n/index.tsx';
import { diggerScreenings, screening } from '../helpers/mock-api.ts';

/** FilterBar wired to the URL as the movie page wires it; shows the query string. */
function Harness({ screenings }: { screenings: Screening[] }) {
  const [filters, setFilters] = useFilters();
  const { search } = useLocation();
  return (
    <>
      <FilterBar screenings={screenings} filters={filters} onChange={setFilters} />
      <output aria-label="query">{search}</output>
    </>
  );
}

function renderBar(path = '/en/movie/digger-2026?date=2026-10-31', screenings = diggerScreenings) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider lang="en">
        <Harness screenings={screenings} />
      </I18nProvider>
    </MemoryRouter>,
  );
  return { query: () => screen.getByRole('status', { name: 'query' }).textContent };
}

const group = (name: string) => screen.getByRole('group', { name });

test('offers only the cinemas, formats and audio present in the list', () => {
  renderBar();

  const names = (groupName: string) =>
    within(group(groupName))
      .getAllByRole('button')
      .map((button) => button.textContent);
  expect(names('Cinema')).toEqual(['Apollo Akropolis', 'Skalvija', 'Vue Vilnius']);
  expect(names('Format')).toEqual(['4DX', 'ScreenX']);
  expect(names('Language')).toEqual(['Original language', 'Dubbed']);
});

test('hides a group with a single option', () => {
  renderBar(undefined, diggerScreenings.slice(0, 1));

  expect(screen.queryByRole('group', { name: 'Cinema' })).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Format' })).not.toBeInTheDocument();
});

test('offers a lone format only when other screenings lack it, as it then narrows the list', () => {
  renderBar(undefined, [
    screening({ id: 'a', format: 'IMAX' }),
    screening({ id: 'b', format: null }),
  ]);
  expect(within(group('Format')).getByRole('button', { name: 'IMAX' })).toBeInTheDocument();
  cleanup();

  renderBar(undefined, [
    screening({ id: 'a', format: 'IMAX' }),
    screening({ id: 'b', format: 'IMAX' }),
  ]);
  expect(screen.queryByRole('group', { name: 'Format' })).not.toBeInTheDocument();
});

test('selected chips are pressed and written to the cinema, format and audio parameters', async () => {
  const user = userEvent.setup();
  const { query } = renderBar();

  const vue = within(group('Cinema')).getByRole('button', { name: 'Vue Vilnius' });
  await user.click(vue);
  await user.click(within(group('Cinema')).getByRole('button', { name: 'Skalvija' }));
  await user.click(within(group('Format')).getByRole('button', { name: '4DX' }));
  await user.click(within(group('Language')).getByRole('button', { name: 'Original language' }));

  expect(vue).toHaveAttribute('aria-pressed', 'true');
  expect(new URLSearchParams(query())).toEqual(
    new URLSearchParams('date=2026-10-31&cinema=vue-vilnius,skalvija&format=4DX&audio=original'),
  );

  await user.click(vue);
  expect(vue).toHaveAttribute('aria-pressed', 'false');
  expect(new URLSearchParams(query()).get('cinema')).toBe('skalvija');
});

test('the two audio choices exclude each other', async () => {
  const user = userEvent.setup();
  const { query } = renderBar();
  const audio = within(group('Language'));

  await user.click(audio.getByRole('button', { name: 'Original language' }));
  await user.click(audio.getByRole('button', { name: 'Dubbed' }));

  expect(audio.getByRole('button', { name: 'Original language' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(new URLSearchParams(query()).get('audio')).toBe('dubbed');
});

test('reads filters from the URL, and "Clear filters" resets them', async () => {
  const user = userEvent.setup();
  const { query } = renderBar('/en/movie/digger-2026?date=2026-10-31&format=4DX&audio=dubbed');

  expect(within(group('Format')).getByRole('button', { name: '4DX' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));

  expect(query()).toBe('?date=2026-10-31');
  expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
});

test('on small screens the filters fold behind a toggle that shows how many are set', async () => {
  const user = userEvent.setup();
  renderBar('/en/movie/digger-2026?format=4DX&cinema=skalvija');

  const toggle = screen.getByRole('button', { name: 'Filters (2)' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
});
