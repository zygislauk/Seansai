/**
 * Bundle budget (plan.md, SC-002): the JavaScript a first visit downloads before anything renders
 * (the entry script plus the chunks it preloads) must stay under 150 kB gzipped. Runs after
 * `vite build`; exits non-zero when over budget.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { distDir } from './build-paths.ts';

const BUDGET_BYTES = 150_000;
const html = readFileSync(join(distDir, 'index.html'), 'utf8');

/** Script and module-preload URLs referenced by index.html. */
const initialScripts = [
  ...html.matchAll(/<script[^>]*\stype="module"[^>]*\ssrc="([^"]+)"/g),
  ...html.matchAll(/<link[^>]*\srel="modulepreload"[^>]*\shref="([^"]+)"/g),
].map((match) => match[1] ?? '');

if (initialScripts.length === 0) {
  console.error('check-bundle-size: no entry script found in index.html');
  process.exit(1);
}

let total = 0;
for (const url of initialScripts) {
  const size = gzipSync(readFileSync(join(distDir, url))).length;
  total += size;
  console.log(`  ${url}  ${(size / 1000).toFixed(1)} kB gzipped`);
}
const verdict = total <= BUDGET_BYTES ? 'within' : 'OVER';
console.log(
  `Initial JS: ${(total / 1000).toFixed(1)} kB gzipped, ${verdict} the ${String(BUDGET_BYTES / 1000)} kB budget`,
);
if (total > BUDGET_BYTES) process.exit(1);
