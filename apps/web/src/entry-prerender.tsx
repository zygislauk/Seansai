import { dehydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router';
import { AppProviders } from './app/providers.tsx';
import { createRoutes } from './app/router.tsx';
import { SITE_URL } from './lib/site.ts';

/** What a page embeds as `#initial-data`, so the browser takes over without asking again. */
export type InitialData = {
  queryCache: DehydratedState;
  /** The routes' loader results: the router runs its loaders, and shows its fallback, without them. */
  loaderData: Record<string, unknown>;
};

/**
 * Renders one page to HTML, for the daily snapshot (scripts/prerender.ts). `queryClient` must
 * already hold the page's data, so the route loaders find it and make no requests.
 */
export async function renderPage(
  path: string,
  queryClient: QueryClient,
): Promise<{ markup: string; initialData: InitialData }> {
  const handler = createStaticHandler(createRoutes(queryClient));
  const context = await handler.query(new Request(new URL(path, SITE_URL)));
  if (context instanceof Response) throw new Error(`${path} redirects, so it isn't a page`);

  const markup = renderToString(
    <AppProviders queryClient={queryClient}>
      {/* hydrate={false}: its default is an inline script, which the CSP doesn't allow. */}
      <StaticRouterProvider
        router={createStaticRouter(handler.dataRoutes, context)}
        context={context}
        hydrate={false}
      />
    </AppProviders>,
  );
  return {
    markup,
    initialData: { queryCache: dehydrate(queryClient), loaderData: context.loaderData },
  };
}
