import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { SECURITY_HEADERS } from '../../src/server.ts';

type Header = { key: string; value: string };
type Service = {
  root: string;
  framework: string;
  entrypoint?: string;
  bindings?: unknown;
  rewrites?: Array<{ source: string; destination: string; statusCode?: number }>;
  headers?: Array<{ source: string; headers: Header[] }>;
  routes?: unknown;
};
type VercelConfig = {
  regions?: string[];
  crons?: unknown;
  services: Record<string, Service>;
  rewrites: Array<{ source: string; destination: unknown }>;
  redirects?: unknown;
};

/** The deployment's routing and headers (FR-001, FR-002, FR-012), checked in CI. */
const vercelJson = new URL('../../../../vercel.json', import.meta.url);
const config = JSON.parse(readFileSync(vercelJson, 'utf8')) as VercelConfig;
const service = (name: string): Service => {
  const found = config.services[name];
  if (!found) throw new Error(`vercel.json has no "${name}" service`);
  return found;
};

describe('vercel.json', () => {
  test('sends /api/* to the API and everything else to the web app, catch-all last', () => {
    expect(config.rewrites).toEqual([
      { source: '/api/(.*)', destination: { service: 'api' } },
      { source: '/(.*)', destination: { service: 'web' } },
    ]);
  });

  test('builds the API from its entrypoint shim', () => {
    expect(service('api')).toMatchObject({
      root: 'apps/api',
      framework: 'fastify',
      entrypoint: 'index.ts',
    });
    expect(existsSync(new URL('../../index.ts', import.meta.url))).toBe(true);
  });

  test('answers an unknown address with the app, as a 404, once no file matched', () => {
    expect(service('web').rewrites).toEqual([
      { source: '/(.*)', destination: '/404.html', statusCode: 404 },
    ]);
  });

  // Measured on a preview: with `routes`, a service's `headers` are silently dropped.
  test('uses no low-level routes, which would drop the headers below', () => {
    expect(service('web').routes).toBeUndefined();
  });

  test('lets hashed assets be cached forever', () => {
    expect(service('web').headers).toContainEqual({
      source: '/assets/(.*)',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    });
  });

  test('sends / to the remembered language, temporarily as it depends on the visitor', () => {
    expect(config.redirects).toEqual(
      expect.arrayContaining([
        {
          source: '/',
          has: [{ type: 'cookie', key: 'seansai_lang', value: 'en' }],
          destination: '/en/',
          permanent: false,
        },
        { source: '/', destination: '/lt/', permanent: false },
      ]),
    );
  });

  test('checks the cookie before the rule that sends everyone else to Lithuanian', () => {
    const rules = config.redirects as Array<{ source: string; has?: unknown }>;
    const forRoot = rules.filter((rule) => rule.source === '/');

    expect(forRoot[0]?.has).toBeDefined();
    expect(forRoot[1]?.has).toBeUndefined();
  });

  test('sends an unknown two-letter language to the same page in Lithuanian, permanently', () => {
    expect(config.redirects).toContainEqual({
      source: '/:lang((?!lt|en)[a-z]{2})/:path*',
      destination: '/lt/:path*',
      permanent: true,
    });
  });

  test('the language redirect matches unknown languages and nothing else', () => {
    const rules = config.redirects as Array<{ source: string; destination: string }>;
    const source = rules.find(({ destination }) => destination === '/lt/:path*')?.source;
    const language = /^\/:lang\((.+)\)\/:path\*$/.exec(source ?? '')?.[1];
    const redirected = new RegExp(`^/${language ?? ''}(/|$)`);

    for (const path of ['/de', '/de/', '/de/movie/x', '/ru/city/vilnius']) {
      expect(path).toMatch(redirected);
    }
    for (const path of ['/lt/', '/lt/movie/x', '/en/', '/en/city/vilnius', '/api/v1/cities']) {
      expect(path).not.toMatch(redirected);
    }
  });

  test("gives every page the API's security headers", () => {
    const pageHeaders = service('web').headers?.find((rule) => rule.source === '/(.*)')?.headers;

    expect(pageHeaders).toEqual(
      expect.arrayContaining([
        {
          key: 'Content-Security-Policy',
          value: SECURITY_HEADERS['content-security-policy'],
        },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ]),
    );
  });

  test('runs functions in Frankfurt, near Lithuania and the database', () => {
    expect(config.regions).toEqual(['fra1']);
  });

  test('has no service bindings: no service calls another', () => {
    for (const each of Object.values(config.services)) {
      expect(each.bindings).toBeUndefined();
    }
  });

  test('schedules nothing: a machine other than Vercel refreshes, because cinemas refuse Vercel', () => {
    expect(config.crons).toBeUndefined();
  });
});
