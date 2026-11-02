import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Lets `vite preview` answer `/lt/movie/x` from `lt/movie/x/index.html`, as the host does. Without
 * it, `mpa` mode answers 404 unless the address ends in a slash (research.md §10).
 */
function previewDirectoryPages(): Plugin {
  return {
    name: 'preview-directory-pages',
    configurePreviewServer(server) {
      const outDir = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use((request, _response, next) => {
        const [path = '', ...query] = (request.url ?? '').split('?');
        if (!path.endsWith('/') && isDirectory(join(outDir, path))) {
          request.url = [`${path}/`, ...query].join('?');
        }
        next();
      });
    },
  };
}

function isDirectory(encodedPath: string): boolean {
  try {
    return statSync(decodeURI(encodedPath), { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    // A malformed address is no directory; the server answers it with its usual 404.
    return false;
  }
}

export default defineConfig(({ isPreview, isSsrBuild }) => ({
  plugins: [react(), previewDirectoryPages()],
  // The development server needs its fallback to index.html; the preview serves a built snapshot,
  // where an unknown address must stay a 404.
  appType: isPreview ? 'mpa' : 'spa',
  build: {
    // One stylesheet, linked from every page, so a snapshot is styled before any script runs.
    cssCodeSplit: false,
    outDir: `${process.env.BUILD_OUT_DIR ?? 'dist'}${isSsrBuild ? '-prerender' : ''}`,
  },
  css: {
    preprocessorOptions: {
      // Lets SCSS modules write `@use 'breakpoints'` instead of long relative paths.
      scss: { loadPaths: [fileURLToPath(new URL('./src/styles', import.meta.url))] },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // API_PORT lets end-to-end tests pair a second web server with a differently set-up API.
      '/api': `http://localhost:${process.env.API_PORT ?? '3000'}`,
    },
  },
}));
