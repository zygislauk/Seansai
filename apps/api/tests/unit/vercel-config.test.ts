import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { SECURITY_HEADERS } from '../../src/server.ts';

type Header = { key: string; value: string };
type Service = {
  root: string;
  framework: string;
  entrypoint?: string;
  bindings?: unknown;
  rewrites?: Array<{ source: string; destination: string }>;
  headers?: Array<{ source: string; headers: Header[] }>;
};
type VercelConfig = {
  regions?: string[];
  crons?: unknown;
  services: Record<string, Service>;
  rewrites: Array<{ source: string; destination: unknown }>;
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

  test('serves index.html for deep links', () => {
    expect(service('web').rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' });
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
