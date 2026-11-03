import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Lets `vite preview` answer as the host does. `/lt/movie/x` comes from `lt/movie/x/index.html`:
 * without this, `mpa` mode answers 404 unless the address ends in a slash (research.md §10). An
 * unknown address gets `404.html` with its status: Vite's own 404 has no content.
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
      // Returned, so it runs after Vite has looked for a file and resolved a directory's page.
      return () => {
        server.middlewares.use((request, response, next) => {
          const notFoundPage = join(outDir, '404.html');
          const [path = ''] = (request.url ?? '').split('?');
          if (!existsSync(notFoundPage) || isFile(join(outDir, path))) {
            next();
            return;
          }
          response.statusCode = 404;
          response.setHeader('content-type', 'text/html');
          response.end(readFileSync(notFoundPage));
        });
      };
    },
  };
}

function isDirectory(encodedPath: string): boolean {
  return entryAt(encodedPath)?.isDirectory() ?? false;
}

function isFile(encodedPath: string): boolean {
  return entryAt(encodedPath)?.isFile() ?? false;
}

function entryAt(encodedPath: string) {
  try {
    return statSync(decodeURI(encodedPath), { throwIfNoEntry: false });
  } catch {
    // A malformed address is nothing on disk; the server answers it with its usual 404.
    return undefined;
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
    // The page renderer only ever runs during the build, so it has no use for these.
    copyPublicDir: !isSsrBuild,
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
