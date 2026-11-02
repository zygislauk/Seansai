/**
 * Writes Brotli (.br) and gzip (.gz) copies of the built text files, at maximum compression, so
 * the API serves them precompressed (@fastify/static `preCompressed`) instead of compressing on
 * every request. Runs after `vite build`.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { distDir } from './build-paths.ts';

const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.svg', '.json']);
/** Below this, compression saves less than the extra headers cost. */
const MIN_BYTES = 1024;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

let count = 0;
for (const path of files(distDir)) {
  if (!COMPRESSIBLE.has(extname(path))) continue;
  const content = readFileSync(path);
  if (content.length < MIN_BYTES) continue;
  writeFileSync(
    `${path}.br`,
    brotliCompressSync(content, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: content.length,
      },
    }),
  );
  writeFileSync(`${path}.gz`, gzipSync(content, { level: constants.Z_BEST_COMPRESSION }));
  count++;
}
console.log(`Precompressed ${String(count)} files (.br and .gz)`);
