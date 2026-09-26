import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { fuse } from '@lit-core/css-fuse';
import lit from '@lit-core/vite-plugin';
import { build } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

// Find Web Awesome components
const possiblePaths = [path.join(rootDir, 'node_modules/@awesome.me/webawesome/dist/components'), path.resolve('node_modules/@awesome.me/webawesome/dist/components')];

const compDir = possiblePaths.find((p) => fs.existsSync(p));
if (!compDir) {
  console.error('Could not locate @awesome.me/webawesome installation.');
  process.exit(1);
}

const components = fs.readdirSync(compDir).filter((name) => {
  const fullPath = path.join(compDir, name, `${name}.js`);
  return fs.existsSync(fullPath);
});

console.log(`\n===============================================================`);
console.log(`⚡ WEB AWESOME FULL BUNDLE DEDUPLICATION BENCHMARK`);
console.log(`===============================================================`);
console.log(`Detected components: ${components.length} Web Awesome elements`);

const benchmarkDir = __dirname;
const entryContent = components.map((name) => `import '@awesome.me/webawesome/dist/components/${name}/${name}.js';`).join('\n');

const entryPath = path.join(benchmarkDir, '.webawesome-entry.js');
fs.writeFileSync(entryPath, entryContent);

function getSizes(filePath) {
  const code = fs.readFileSync(filePath);
  const rawBytes = code.length;
  const gzipBytes = zlib.gzipSync(code, { level: 9 }).length;
  const brotliBytes = zlib.brotliCompressSync(code).length;
  return { rawBytes, gzipBytes, brotliBytes };
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

const baselineDir = path.join(benchmarkDir, '.dist-baseline');
const optimizedDir = path.join(benchmarkDir, '.dist-optimized');

try {
  // -------------------------------------------------------------
  // 1. BASELINE BUILD (Without Deduplication)
  // -------------------------------------------------------------
  console.log('\n[1/2] Building Baseline Bundle (standard Vite build)...');

  await build({
    root: rootDir,
    logLevel: 'silent',
    build: {
      outDir: baselineDir,
      emptyOutDir: true,
      minify: true,
      rollupOptions: {
        input: entryPath,
        output: {
          entryFileNames: 'bundle.js',
        },
      },
    },
  });

  const baselineSizes = getSizes(path.join(baselineDir, 'bundle.js'));
  console.log(`✓ Baseline Complete: Minified ${formatKb(baselineSizes.rawBytes)} | Gzip ${formatKb(baselineSizes.gzipBytes)}`);

  // -------------------------------------------------------------
  // 2. RUN AST DEDUPLICATION ANALYSIS
  // -------------------------------------------------------------
  console.log('\n[2/2] Running AST Sub-Rule Extraction & Constructable Stylesheet Deduplication...');

  const chunksPattern = path.join(compDir, '../chunks/*.js');
  const analysis = fuse({
    include: [chunksPattern],
    exclude: [],
    threshold: 2,
    outputDir: '.fused',
    write: false,
    virtualImports: true,
  });

  const stats = analysis.stats;
  console.log(`• Total CSS rules scanned: ${stats.totalRules}`);
  console.log(`• Deduplicated rules: ${stats.rulesDeduped}`);
  console.log(`• Shared constructable stylesheets created: ${stats.fusedSheetsCreated}`);
  console.log(`• Web Awesome component chunks rewritten: ${stats.componentsRewritten}`);

  // -------------------------------------------------------------
  // 3. OPTIMIZED BUILD (With Vite Plugin)
  // -------------------------------------------------------------
  console.log('\nBuilding Optimized Bundle (with @lit-core/vite-plugin)...');

  await build({
    root: rootDir,
    logLevel: 'silent',
    build: {
      outDir: optimizedDir,
      emptyOutDir: true,
      minify: true,
      rollupOptions: {
        input: entryPath,
        output: {
          entryFileNames: 'bundle.js',
        },
      },
    },
    plugins: [
      lit({
        cssFuse: {
          include: [chunksPattern],
          exclude: [],
          threshold: 2,
          applyInDev: true,
        },
        htmlMinifier: {
          exclude: [],
        },
      }),
    ],
  });

  const optimizedSizes = getSizes(path.join(optimizedDir, 'bundle.js'));
  console.log(`✓ Optimized Complete: Minified ${formatKb(optimizedSizes.rawBytes)} | Gzip ${formatKb(optimizedSizes.gzipBytes)}`);

  // -------------------------------------------------------------
  // 4. COMPARISON SUMMARY REPORT
  // -------------------------------------------------------------
  const rawSaved = baselineSizes.rawBytes - optimizedSizes.rawBytes;
  const rawPct = ((rawSaved / baselineSizes.rawBytes) * 100).toFixed(2);

  const gzipSaved = baselineSizes.gzipBytes - optimizedSizes.gzipBytes;
  const gzipPct = ((gzipSaved / baselineSizes.gzipBytes) * 100).toFixed(2);

  const brotliSaved = baselineSizes.brotliBytes - optimizedSizes.brotliBytes;
  const brotliPct = ((brotliSaved / baselineSizes.brotliBytes) * 100).toFixed(2);

  console.log(`\n===============================================================`);
  console.log(`📊 WEB AWESOME BUNDLE SIZE COMPARISON (BEFORE vs AFTER)`);
  console.log(`===============================================================`);
  console.log(`Components:      ${components.length} custom elements (Full Web Awesome Suite)`);
  console.log(`Rules Deduped:   ${stats.rulesDeduped} duplicate declarations / sub-rules`);
  console.log(`Constructable:   ${stats.fusedSheetsCreated} shared CSSStyleSheet modules`);
  console.log(`---------------------------------------------------------------`);
  console.log(`Metric         Baseline       Optimized      Savings      Reduction`);
  console.log(`---------------------------------------------------------------`);
  console.log(`Minified JS    ${formatKb(baselineSizes.rawBytes).padEnd(14)} ${formatKb(optimizedSizes.rawBytes).padEnd(14)} -${formatKb(rawSaved).padEnd(12)} -${rawPct}%`);
  console.log(`Gzip           ${formatKb(baselineSizes.gzipBytes).padEnd(14)} ${formatKb(optimizedSizes.gzipBytes).padEnd(14)} -${formatKb(gzipSaved).padEnd(12)} -${gzipPct}%`);
  console.log(`Brotli         ${formatKb(baselineSizes.brotliBytes).padEnd(14)} ${formatKb(optimizedSizes.brotliBytes).padEnd(14)} -${formatKb(brotliSaved).padEnd(12)} -${brotliPct}%`);
  console.log(`===============================================================\n`);
} finally {
  // Clean up temporary benchmark output files
  if (fs.existsSync(entryPath)) fs.rmSync(entryPath, { force: true });
  if (fs.existsSync(baselineDir)) fs.rmSync(baselineDir, { recursive: true, force: true });
  if (fs.existsSync(optimizedDir)) fs.rmSync(optimizedDir, { recursive: true, force: true });
}
