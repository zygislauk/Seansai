import { join } from 'node:path';

/** The build's output folder. BUILD_OUT_DIR lets concurrent test builds stay apart. */
export const distDir = join(import.meta.dirname, '..', process.env.BUILD_OUT_DIR ?? 'dist');
