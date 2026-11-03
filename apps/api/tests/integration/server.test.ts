import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { brotliCompressSync, gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { ErrorResponseSchema } from '@seansai/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { parseQuery, setListCaching } from '../../src/routes/http.ts';
import { buildServer } from '../../src/server.ts';
import { createTempDb } from '../helpers/temp-db.ts';
import { createTestLogger } from '../helpers/test-logger.ts';

const NOW = new Date('2026-10-30T10:00:00Z');

let app: FastifyInstance;
let cleanup: () => void;
let log: ReturnType<typeof createTestLogger>;

async function startServer(webDistDir: string | null = null): Promise<FastifyInstance> {
  const temp = await createTempDb();
  cleanup = temp.cleanup;
  log = createTestLogger();
  const server = buildServer({ db: temp.db, now: () => NOW, logger: log.logger, webDistDir });
  server.get('/api/v1/test/list', (_request, reply) => {
    setListCaching(reply);
    return { items: [1, 2, 3] };
  });
  server.get('/api/v1/test/query', (request) =>
    parseQuery(z.object({ city: z.enum(['vilnius']) }), request.query, { city: 'invalid_city' }),
  );
  server.get('/api/v1/test/boom', () => {
    throw new Error('SQLITE_CORRUPT: secret internals at /srv/db.sqlite');
  });
  return server;
}

afterEach(async () => {
  await app.close();
  cleanup();
});

describe('buildServer', () => {
  beforeEach(async () => {
    app = await startServer();
  });

  test('rejects invalid query parameters with 400 and an ErrorResponse', async () => {
    const response = await app.inject('/api/v1/test/query?city=riga');

    expect(response.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('invalid_city');
  });

  test('accepts valid query parameters', async () => {
    const response = await app.inject('/api/v1/test/query?city=vilnius');

    expect(response.json()).toEqual({ city: 'vilnius' });
  });

  test('maps unexpected errors to 500 internal_error without leaking details', async () => {
    const response = await app.inject('/api/v1/test/boom');

    expect(response.statusCode).toBe(500);
    expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('internal_error');
    expect(response.body).not.toContain('SQLITE');
    expect(log.raw()).toContain('SQLITE_CORRUPT');
  });

  test('answers unknown API routes with 404 not_found', async () => {
    const response = await app.inject('/api/v1/nothing-here');

    expect(response.statusCode).toBe(404);
    expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('not_found');
  });

  test('compresses API answers for clients that accept it', async () => {
    // Registered as a plugin, like the real routes, so it loads after the compression plugin.
    void app.register((scope, _options, done) => {
      scope.get('/api/v1/test/big', () => ({
        items: Array.from({ length: 500 }, (_, i) => `item ${String(i)}`),
      }));
      done();
    });

    const plain = await app.inject('/api/v1/test/big');
    const gzipped = await app.inject({
      url: '/api/v1/test/big',
      headers: { 'accept-encoding': 'gzip' },
    });

    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(gzipped.headers['content-encoding']).toBe('gzip');
    expect(gzipped.headers.vary).toContain('accept-encoding');
    expect(gunzipSync(gzipped.rawPayload).toString()).toBe(plain.body);
  });

  // Sends the header rather than blocking /api/ in robots.txt (research.md §7). The exceptions are
  // Fastify's 414 for a too-long path parameter and 400 for a malformed address, written before any
  // hook runs; search engines don't index 4xx answers anyway.
  test.each([
    ['an answer', '/api/v1/health', 200],
    ['an invalid request', '/api/v1/test/query?city=riga', 400],
    ['an unknown route', '/api/v1/nothing-here', 404],
    ['a server error', '/api/v1/test/boom', 500],
  ])('%s from the API asks search engines not to index it', async (_, url, status) => {
    const response = await app.inject(url);

    expect(response.statusCode).toBe(status);
    expect(response.headers['x-robots-tag']).toBe('noindex');
  });

  test('list responses are cacheable for 5 minutes and carry an ETag', async () => {
    const first = await app.inject('/api/v1/test/list');

    expect(first.headers['cache-control']).toBe('public, max-age=300, s-maxage=300');
    const etag = first.headers.etag;
    expect(etag).toEqual(expect.any(String));

    const revalidated = await app.inject({
      url: '/api/v1/test/list',
      headers: { 'if-none-match': String(etag) },
    });
    expect(revalidated.statusCode).toBe(304);
  });
});

describe('serving the web app', () => {
  let webDistDir: string;

  beforeEach(async () => {
    webDistDir = mkdtempSync(join(tmpdir(), 'seansai-web-'));
    mkdirSync(join(webDistDir, 'assets'));
    writeFileSync(join(webDistDir, 'index.html'), '<!doctype html><title>Seansai</title>');
    writeFileSync(join(webDistDir, 'assets', 'index-abc123.js'), 'console.log(1)');
    app = await startServer(webDistDir);
  });

  afterEach(() => {
    rmSync(webDistDir, { recursive: true, force: true });
  });

  test.each(['/', '/lt/vilnius', '/assets/index-abc123.js', '/api/v1/cities'])(
    'keeps a self-hosted copy out of search results: %s',
    async (url) => {
      const response = await app.inject(url);

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-robots-tag']).toBe('noindex');
    },
  );

  test('serves hashed assets with a long cache lifetime', async () => {
    const response = await app.inject('/assets/index-abc123.js');

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  test('serves the precompressed copy of an asset when the browser accepts it', async () => {
    writeFileSync(
      join(webDistDir, 'assets', 'index-abc123.js.br'),
      brotliCompressSync('console.log(1)'),
    );

    const response = await app.inject({
      url: '/assets/index-abc123.js',
      headers: { 'accept-encoding': 'br, gzip' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBe('br');
    expect(response.headers['content-type']).toContain('javascript');
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  test('falls back to index.html for app routes', async () => {
    const response = await app.inject('/lt/movie/digger-2026?date=2026-10-31');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.body).toContain('<title>Seansai</title>');
  });

  test('still answers unknown API routes with JSON', async () => {
    const response = await app.inject('/api/v1/nothing-here');

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not_found' } });
  });
  test.each([
    ['the app page', '/lt/'],
    ['a script', '/assets/index-abc123.js'],
    ['an API answer', '/api/v1/health'],
    ['an error', '/api/v1/test/boom'],
  ])('%s carries the security headers', async (_, url) => {
    const response = await app.inject(url);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    const policy = String(response.headers['content-security-policy']);
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' https: data:",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ]) {
      expect(policy).toContain(directive);
    }
    expect(policy).not.toContain('unsafe-inline');
  });
});
