import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { SECURITY_HEADERS } from '../../src/server.ts';

type Route = {
  src?: string;
  headers?: Record<string, string>;
  continue?: boolean;
  handle?: string;
  status?: number;
  dest?: string;
};
type Service = {
  root: string;
  framework: string;
  entrypoint?: string;
  bindings?: unknown;
  rewrites?: Array<{ source: string; destination: string }>;
  headers?: unknown;
  routes?: Route[];
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

  test('has no catch-all to index.html, so an unknown address can answer 404', () => {
    expect(service('web').rewrites).toBeUndefined();
  });

  test('answers an unknown address with the app, as a 404, once no file matched', () => {
    expect(service('web').routes?.slice(-2)).toEqual([
      { handle: 'filesystem' },
      { src: '/.*', status: 404, dest: '/404.html' },
    ]);
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

  test("gives every response the API's security headers, before anything can answer", () => {
    const [first] = service('web').routes ?? [];

    expect(first).toMatchObject({ src: '/(.*)', continue: true });
    expect(first?.headers).toEqual({
      'Content-Security-Policy': SECURITY_HEADERS['content-security-policy'],
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
  });

  test('lets hashed assets be cached forever', () => {
    expect(service('web').routes?.[1]).toEqual({
      src: '/assets/(.*)',
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
      continue: true,
    });
  });

  // Measured on a preview: with `routes` present, a service's `headers` are silently dropped.
  test('sets no headers beside its routes, where they would have no effect', () => {
    expect(service('web').headers).toBeUndefined();
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
