import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ScreeningTimeline } from '../../src/components/organisms/ScreeningTimeline/index.ts';
import { diggerScreenings } from '../helpers/mock-api.ts';
import { renderUi } from '../helpers/render-app.tsx';

const rows = () => screen.getAllByRole('listitem').filter((item) => item.dataset.screening);

test('shows one list in the given time order, not grouped by cinema', () => {
  renderUi(<ScreeningTimeline screenings={diggerScreenings} />);

  expect(screen.getAllByRole('list')[0]).toHaveAccessibleName('Screenings');
  expect(rows().map((row) => within(row).getByRole('time').textContent)).toEqual([
    '20:00',
    '20:00',
    '22:15',
  ]);
  expect(
    rows().map(
      (row) => within(row).getByText(/^(Apollo Akropolis|Skalvija|Vue Vilnius)$/).textContent,
    ),
  ).toEqual(['Apollo Akropolis', 'Skalvija', 'Vue Vilnius']);
});

test('each row shows cinema, city, time, and hall, format and language when known', () => {
  renderUi(<ScreeningTimeline screenings={diggerScreenings} />);
  const [apollo, skalvija, vue] = rows();
  if (!apollo || !skalvija || !vue) throw new Error('expected three rows');

  expect(within(apollo).getByRole('time')).toHaveAttribute('datetime', '2026-10-30T20:00:00+02:00');
  expect(apollo).toHaveTextContent('Vilnius');
  expect(apollo).toHaveTextContent('6 salė');
  expect(within(apollo).getByText('4DX')).toBeInTheDocument();
  expect(within(apollo).getByText('EN')).toHaveAttribute('title', 'English');
  expect(within(apollo).getByText('LT subtitles')).toBeInTheDocument();

  expect(within(vue).getByText('Dubbed')).toBeInTheDocument();
  expect(within(vue).queryByText('LT')).not.toBeInTheDocument();

  // Skalvija publishes neither hall, format nor language.
  expect(skalvija).toHaveTextContent('Vilnius');
  expect(within(skalvija).queryByText(/salė|subtitles|Dubbed|^[A-Z]{2}$/)).not.toBeInTheDocument();
});

test('"Buy ticket" opens the cinema’s page in a new tab, safely', () => {
  renderUi(<ScreeningTimeline screenings={diggerScreenings} />);
  const [apollo] = rows();
  if (!apollo) throw new Error('expected a row');

  const link = within(apollo).getByRole('link', { name: /Buy ticket/ });
  expect(link).toHaveAttribute('href', 'https://www.apollokinas.lt/websales/show/1');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(link).toHaveAccessibleName(/20:00, Apollo Akropolis.*new tab/);
});

test('speaks Lithuanian by default', () => {
  renderUi(<ScreeningTimeline screenings={diggerScreenings} />, 'lt');

  expect(screen.getAllByRole('link', { name: /Pirkti bilietą/ })).toHaveLength(3);
  expect(screen.getByText('Dubliuota')).toBeInTheDocument();
  expect(screen.getByText('LT sub.')).toBeInTheDocument();
});
