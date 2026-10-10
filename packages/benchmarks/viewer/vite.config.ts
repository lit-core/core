import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const showcaseDistDir = path.resolve(__dirname, '../../showcase/dist');

/**
 * Creates Connect middleware to serve benchmark results JSON files from any candidate directory.
 * Intercepts any request path containing "results/..." and prevents SPA HTML fallback.
 */
function createResultsMiddleware() {
  const candidateDirs = [
    path.resolve(__dirname, '../results'),
    path.resolve(__dirname, 'dist/results'),
    path.resolve(process.cwd(), 'results'),
    path.resolve(process.cwd(), 'packages/benchmarks/results'),
  ];

  return (req: any, res: any, next: () => void) => {
    if (!req.url) return next();

    // Match any request URL containing "results/..."
    // e.g. /results/manifest.json, ./results/manifest.json, /viewer/results/manifest.json, etc.
    const match = req.url.match(/(?:^|\/)results\/(.+?)(?:\?.*)?$/);
    if (!match) {
      return next();
    }

    const relativePath = decodeURIComponent(match[1]);

    // Search candidate directories
    let foundPath: string | null = null;
    for (const dir of candidateDirs) {
      const candidate = path.resolve(dir, relativePath);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        foundPath = candidate;
        break;
      }
    }

    if (foundPath) {
      if (foundPath.endsWith('.json')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      } else if (foundPath.endsWith('.html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      return fs.createReadStream(foundPath).pipe(res);
    }

    // Crucial: If under results/ but file is not found, return 404 JSON instead of falling through to SPA HTML fallback!
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Benchmark result not found', path: relativePath }));
  };
}

/**
 * Custom Vite plugin to serve the results directory during dev and preview,
 * and automatically copy results and showcase into dist upon build.
 */
function serveResultsPlugin(): Plugin {
  const middleware = createResultsMiddleware();
  return {
    name: 'serve-results',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    closeBundle() {
      // Automatically copy results into dist/results so the static build is self-contained
      const srcResults = path.resolve(__dirname, '../results');
      const distResults = path.resolve(__dirname, 'dist/results');
      if (fs.existsSync(srcResults)) {
        try {
          fs.cpSync(srcResults, distResults, { recursive: true, force: true });
        } catch {
          // Ignore copy errors in environments without write access
        }
      }

      // Automatically copy showcase into dist/showcase if available
      if (fs.existsSync(showcaseDistDir)) {
        const distShowcase = path.resolve(__dirname, 'dist/showcase');
        try {
          fs.cpSync(showcaseDistDir, distShowcase, { recursive: true, force: true });
        } catch {
          // Ignore copy errors in environments without write access
        }
      }
    },
  };
}

/**
 * Creates Connect middleware to serve showcase builds.
 */
function createShowcaseMiddleware() {
  const candidateDirs = [showcaseDistDir, path.resolve(__dirname, 'dist/showcase'), path.resolve(process.cwd(), 'packages/showcase/dist')];

  return (req: any, res: any, next: () => void) => {
    if (!req.url) return next();

    const match = req.url.match(/(?:^|\/)showcase\/(.+?)(?:\?.*)?$/);
    if (!match) {
      return next();
    }

    const relativePath = decodeURIComponent(match[1]);

    let foundPath: string | null = null;
    for (const dir of candidateDirs) {
      let candidate = path.resolve(dir, relativePath);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        candidate = path.join(candidate, 'index.html');
      }
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        foundPath = candidate;
        break;
      }
    }

    if (foundPath) {
      const ext = path.extname(foundPath);
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      };
      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return fs.createReadStream(foundPath).pipe(res);
    }

    // Clean 404 response instead of falling through to SPA index.html
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Showcase build pending</title></head><body style="font-family:system-ui;padding:2rem;background:#fafafa;"><div style="max-width:540px;margin:2rem auto;padding:1.5rem;background:#fff;border-radius:12px;border:1px solid #e4e4e7;"><h3 style="margin-top:0;">Showcase build not found</h3><p style="color:#71717a;">The configuration <code>${relativePath}</code> has not been compiled yet.</p></div></body></html>`,
    );
  };
}

/**
 * Custom Vite plugin to serve showcase builds at /showcase during development and preview.
 * Prevents SPA fallback from hijacking missing showcase assets and creating recursive iframes.
 */
function serveShowcasePlugin(): Plugin {
  const middleware = createShowcaseMiddleware();
  return {
    name: 'serve-showcase',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
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
