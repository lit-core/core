import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

export default defineConfig({
  plugins: [react(), serveResultsPlugin()],
  base: './',
  server: {
    port: 5173,
    open: false,
    fs: {
      allow: ['..', '../results'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
