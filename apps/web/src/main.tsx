import './styles/global.scss';
import { hydrate } from '@tanstack/react-query';
import { StrictMode, useLayoutEffect, type ReactNode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { createBrowserRouter, matchRoutes, RouterProvider, type RouteObject } from 'react-router';
import { AppProviders, createQueryClient } from './app/providers.tsx';
import { createRoutes } from './app/router.tsx';
import type { InitialData } from './entry-prerender.tsx';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element in index.html');
}

/** Shows #root again after the first commit, if public/boot-gate.js hid it. */
function RevealRoot({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    document.documentElement.removeAttribute('data-boot');
  }, []);
  return children;
}

function readInitialData(): InitialData | null {
  const text = document.getElementById('initial-data')?.textContent;
  if (!text) return null;
  try {
    return JSON.parse(text) as InitialData;
  } catch (error) {
    console.error('Ignoring malformed page data:', error);
    return null;
  }
}

/** The router shows its fallback, not the snapshot's content, until the page's routes have loaded. */
async function resolveLazyRoutes(routes: RouteObject[]): Promise<void> {
  await Promise.all(
    (matchRoutes(routes, window.location) ?? []).map(async ({ route }) => {
      if (typeof route.lazy === 'function') {
        Object.assign(route, await route.lazy(), { lazy: undefined });
      }
    }),
  );
}

const queryClient = createQueryClient();
const routes = createRoutes(queryClient);

function app(router: ReturnType<typeof createBrowserRouter>) {
  return (
    <StrictMode>
      <AppProviders queryClient={queryClient}>
        <RevealRoot>
          <RouterProvider router={router} />
        </RevealRoot>
      </AppProviders>
    </StrictMode>
  );
}

const hasSnapshot =
  document.documentElement.dataset.boot !== 'client' && rootElement.hasChildNodes();
const initialData = hasSnapshot ? readInitialData() : null;

if (initialData) {
  hydrate(queryClient, initialData.queryCache);
  await resolveLazyRoutes(routes);
  const router = createBrowserRouter(routes, {
    hydrationData: { loaderData: initialData.loaderData },
  });
  hydrateRoot(rootElement, app(router), {
    onRecoverableError: (error) => {
      console.error('The page differed from its snapshot:', error);
    },
  });
} else {
  createRoot(rootElement).render(app(createBrowserRouter(routes)));
}
