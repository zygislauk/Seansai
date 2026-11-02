import type { Lang } from '@seansai/shared';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { AppProviders, createQueryClient } from '../../src/app/providers.tsx';
import { createRoutes } from '../../src/app/router.tsx';
import { I18nProvider } from '../../src/i18n/index.tsx';

/**
 * Renders the real app routes at `path`; returns the router to inspect the final location and the
 * query client to refetch from.
 */
export function renderApp(path: string) {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(createRoutes(queryClient), { initialEntries: [path] });
  const result = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  const location = () => `${router.state.location.pathname}${router.state.location.search}`;
  return { ...result, router, queryClient, location };
}

/** Renders one component with the interface language and a router around it. */
export function renderUi(ui: ReactNode, lang: Lang = 'en') {
  return render(
    <MemoryRouter>
      <I18nProvider lang={lang}>{ui}</I18nProvider>
    </MemoryRouter>,
  );
}
