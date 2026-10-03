import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const showcaseDistDir = path.resolve(__dirname, '../../showcase/dist');

/**
 * Custom Vite plugin to serve the results directory at /results during development.
 */
function serveResultsPlugin(): Plugin {
  return {
    name: 'serve-results',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && (req.url.startsWith('/results/') || req.url.startsWith('results/'))) {
          const relativePath = req.url.replace(/^\/?results\//, '').split('?')[0];
          const filePath = path.resolve(__dirname, '../results', relativePath);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            if (filePath.endsWith('.json')) {
              res.setHeader('Content-Type', 'application/json');
            }
            return fs.createReadStream(filePath).pipe(res);
          }
        }
        next();
      });
    },
  };
}

/**
 * Custom Vite plugin to serve showcase builds at /showcase during development.
 * Prevents SPA fallback from hijacking missing showcase assets and creating recursive iframes.
 */
function serveShowcasePlugin(): Plugin {
  return {
    name: 'serve-showcase',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && (req.url.startsWith('/showcase/') || req.url.startsWith('showcase/'))) {
          const relativePath = req.url.replace(/^\/?showcase\//, '').split('?')[0];
          let filePath = path.join(showcaseDistDir, relativePath);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, 'index.html');
          }

          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath);
            const mimeTypes: Record<string, string> = {
              '.html': 'text/html; charset=utf-8',
              '.js': 'application/javascript; charset=utf-8',
              '.css': 'text/css; charset=utf-8',
              '.json': 'application/json',
              '.svg': 'image/svg+xml',
              '.png': 'image/png',
            };
            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
            return fs.createReadStream(filePath).pipe(res);
          }

          // If under /showcase/ and file is missing, return a clean 404 response instead of falling through to SPA index.html
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><meta charset="utf-8"><title>Showcase build pending</title></head>
              <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2rem; background: #fafafa; color: #18181b;">
                <div style="max-width: 540px; margin: 3rem auto; padding: 2rem; background: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px;">
                  <h3 style="margin-top: 0;">Showcase build not found</h3>
                  <p style="color: #71717a; font-size: 0.9rem;">
                    The build configuration <code>${relativePath}</code> has not been compiled yet.
                  </p>
                  <p style="color: #71717a; font-size: 0.9rem;">
                    Run <code>pnpm run showcase:build</code> in the monorepo root to compile all feature showcase configurations.
                  </p>
                </div>
              </body>
            </html>
          `);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), react(), serveResultsPlugin(), serveShowcasePlugin()],
  base: './',
  server: {
    port: 5173,
    open: false,
    fs: {
      allow: ['..', '../results', '../../showcase'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
