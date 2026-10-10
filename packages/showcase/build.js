#!/usr/bin/env node

/**
 * Multi-configuration build pipeline for the lit-core component test showcase.
 * Builds isolated single-feature showcase applications plus baseline and combined builds,
 * then generates a clean Scandinavian portal hub in dist/index.html for GitHub Pages.
 */

import { exec } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const req = createRequire(import.meta.url);
const vitePkgPath = req.resolve('vite/package.json');
const vitePkg = JSON.parse(fs.readFileSync(vitePkgPath, 'utf-8'));
const viteBin = path.resolve(path.dirname(vitePkgPath), typeof vitePkg.bin === 'string' ? vitePkg.bin : vitePkg.bin.vite);

const pExec = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const distBaseDir = path.resolve(__dirname, 'dist');

import { FEATURES } from './src/features.js';

export { FEATURES };

function getDirSizes(dir) {
  let rawBytes = 0;
  let gzipBytes = 0;

  function walk(current) {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath);
          rawBytes += content.length;
          gzipBytes += zlib.gzipSync(content).length;
        } catch {}
      }
    }
  }

  walk(dir);
  return { rawBytes, gzipBytes };
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function generateHubHtml(results) {
  const baseline = results.find((r) => r.id === 'baseline');
  const all = results.find((r) => r.id === 'all');
  const others = results.filter((r) => r.id !== 'baseline' && r.id !== 'all');

  function renderDelta(bytes, baselineBytes) {
    if (!baselineBytes) return '';
    if (bytes === baselineBytes) return '<span class="delta-neutral">baseline</span>';
    const pct = ((bytes - baselineBytes) / baselineBytes) * 100;
    const isGood = pct <= -0.1;
    const isNeutral = Math.abs(pct) <= 0.1;
    const cls = isGood ? 'delta-pos' : isNeutral ? 'delta-neutral' : 'delta-neg';
    const sign = pct > 0 ? '+' : '';
    return `<span class="${cls}">${sign}${pct.toFixed(1)}%</span>`;
  }

  function renderRow(r, isFeatured = false, isBaseline = false) {
    const rowClass = isFeatured ? 'row-featured' : isBaseline ? 'row-baseline' : '';
    const badge = isFeatured ? '<span class="badge-recommended">Recommended full suite</span>' : isBaseline ? '<span class="badge-baseline">Reference</span>' : '';

    return `
      <tr class="${rowClass}">
        <td>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-weight: 500;">${r.name}</span>
            ${badge}
          </div>
        </td>
        <td style="color: var(--text-secondary); max-width: 400px;">${r.description}</td>
        <td class="numeric">
          <div>${formatBytes(r.rawBytes)}</div>
          ${baseline ? renderDelta(r.rawBytes, baseline.rawBytes) : ''}
        </td>
        <td class="numeric">
          <div>${formatBytes(r.gzipBytes)}</div>
          ${baseline ? renderDelta(r.gzipBytes, baseline.gzipBytes) : ''}
        </td>
        <td class="numeric">${r.buildTimeMs ? `${r.buildTimeMs} ms` : '-'}</td>
        <td>
          <a href="./${r.id}/" class="btn-primary">
            <span>Launch showcase</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 0.35rem;"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
          </a>
        </td>
      </tr>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Lit-core test showcase portal</title>
    <meta name="description" content="Multi-framework canonical component test showcases with isolated compiler passes" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
    <style>
      :root {
        --bg-canvas: #fafafb;
        --bg-surface: #ffffff;
        --bg-subtle: #f4f4f6;
        --bg-subtle-hover: #ececee;
        --text-primary: #09090b;
        --text-secondary: #71717a;
        --text-muted: #a1a1aa;
        --accent-dark: #18181b;
        --accent-dark-hover: #27272a;
        --accent-green: #15803d;
        --accent-green-bg: #ecfdf5;
        --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        --radius-sm: 8px;
        --radius-md: 12px;
        --radius-lg: 16px;
        --shadow-soft: 0 8px 30px rgba(0, 0, 0, 0.04);
        --shadow-card-hover: 0 12px 36px rgba(0, 0, 0, 0.06);
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      html {
        font-size: 16px;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      body {
        font-family: var(--font-sans);
        background-color: var(--bg-canvas);
        color: var(--text-primary);
        font-size: 1rem;
        line-height: 1.6;
        min-height: 100vh;
      }
      .app-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        max-width: 1600px;
        margin: 0 auto;
        padding: 1.5rem 2.5rem;
        background-color: var(--bg-canvas);
        border: none;
      }
      .brand-title { font-size: 1.25rem; font-weight: 500; letter-spacing: -0.02em; color: var(--text-primary); }
      .brand-divider { color: #d4d4d8; margin: 0 0.5rem; font-weight: 300; }
      .brand-subtitle { font-size: 1rem; font-weight: 400; color: var(--text-secondary); }
      .app-content {
        width: 100%;
        max-width: 1600px;
        margin: 0 auto;
        padding: 1.5rem 2.5rem 3.5rem;
      }
      .intro-banner {
        padding: 2rem 2.25rem;
        background-color: var(--bg-surface);
        box-shadow: var(--shadow-soft);
        border: none;
        border-radius: var(--radius-lg);
        margin-bottom: 2rem;
      }
      .intro-title { font-size: 1.25rem; font-weight: 500; margin-bottom: 0.5rem; letter-spacing: -0.02em; }
      .intro-text { font-size: 1rem; font-weight: 300; color: var(--text-secondary); line-height: 1.6; }
      .table-card {
        background-color: var(--bg-surface);
        box-shadow: var(--shadow-soft);
        border: none;
        border-radius: var(--radius-lg);
        overflow: hidden;
        padding: 0.5rem;
      }
      .table-header-bar {
        padding: 1.25rem 1.5rem 0.75rem;
        border: none;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .table-title { font-size: 1.125rem; font-weight: 500; letter-spacing: -0.01em; }
      table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0 0.25rem;
        font-size: 1rem;
      }
      th {
        background-color: transparent;
        color: var(--text-secondary);
        font-weight: 400;
        font-size: 1rem;
        padding: 0.85rem 1.25rem;
        border: none;
        text-align: left;
      }
      th.numeric, td.numeric { text-align: right; font-variant-numeric: tabular-nums; }
      td {
        padding: 1rem 1.25rem;
        border: none;
        background-color: var(--bg-surface);
        font-weight: 300;
        font-size: 1rem;
      }
      tr td:first-child {
        border-top-left-radius: var(--radius-md);
        border-bottom-left-radius: var(--radius-md);
      }
      tr td:last-child {
        border-top-right-radius: var(--radius-md);
        border-bottom-right-radius: var(--radius-md);
      }
      tr:hover td { background-color: var(--bg-canvas); }
      .row-featured td {
        background-color: #ecfdf5 !important;
      }
      .row-featured:hover td {
        background-color: #d1fae5 !important;
      }
      .row-baseline td {
        background-color: #fcfcfc !important;
      }
      .section-divider td {
        background-color: transparent !important;
        color: var(--text-secondary);
        font-size: 1rem;
        font-weight: 500;
        padding: 1rem 1.25rem 0.5rem;
      }
      .btn-primary {
        background-color: var(--accent-dark);
        color: #ffffff;
        text-decoration: none;
        padding: 0.5rem 1rem;
        border-radius: var(--radius-md);
        border: none;
        font-size: 1rem;
        font-weight: 400;
        display: inline-flex;
        align-items: center;
        transition: background-color 0.15s ease;
      }
      .btn-primary:hover { background-color: var(--accent-dark-hover); text-decoration: none; }
      .badge-code {
        font-size: 1rem;
        font-weight: 300;
        color: var(--text-secondary);
        background-color: var(--bg-surface);
        box-shadow: var(--shadow-soft);
        padding: 0.35rem 0.85rem;
        border-radius: 9999px;
        border: none;
      }
      .badge-recommended {
        font-size: 1rem;
        font-weight: 400;
        color: var(--accent-green);
        background-color: #d1fae5;
        padding: 0.25rem 0.75rem;
        border-radius: 9999px;
        border: none;
      }
      .badge-baseline {
        font-size: 1rem;
        font-weight: 400;
        color: var(--text-secondary);
        background-color: #f4f4f5;
        padding: 0.25rem 0.75rem;
        border-radius: 9999px;
        border: none;
      }
      .delta-pos {
        color: var(--accent-green);
        font-weight: 400;
        font-size: 1rem;
      }
      .delta-neg {
        color: #b91c1c;
        font-weight: 400;
        font-size: 1rem;
      }
      .delta-neutral {
        color: var(--text-muted);
        font-size: 1rem;
        font-weight: 300;
      }
    </style>
  </head>
  <body>
    <header class="app-header">
      <div>
        <span class="brand-title">lit-core</span>
        <span class="brand-divider">/</span>
        <span class="brand-subtitle">component test showcases</span>
      </div>
      <div>
        <span class="badge-code">${results.length} builds compiled</span>
      </div>
    </header>

    <main class="app-content">
      <div class="intro-banner">
        <h1 class="intro-title">Multi-framework canonical component test showcases</h1>
        <p class="intro-text">
          Canonical component test suite featuring 20 canonical components across 5 enterprise design systems
          (IBM Carbon, Adobe Spectrum, Web Awesome, Google Material Web, Cisco Momentum), built with isolated @lit-core optimization passes.
        </p>
      </div>

      <div class="table-card">
        <div class="table-header-bar">
          <span class="table-title">Available feature showcase builds</span>
        </div>

        <table>
          <thead>
            <tr>
              <th>Feature configuration</th>
              <th>Description</th>
              <th class="numeric">Raw bundle</th>
              <th class="numeric">Gzip bundle</th>
              <th class="numeric">Build time</th>
              <th>Launch</th>
            </tr>
          </thead>
          <tbody>
            ${baseline ? renderRow(baseline, false, true) : ''}
            ${all ? renderRow(all, true, false) : ''}
            ${others.length > 0 ? `<tr class="section-divider"><td colspan="6">Individual compiler passes (${others.length} standalone passes)</td></tr>` : ''}
            ${others.map((r) => renderRow(r, false, false)).join('')}
          </tbody>
        </table>
      </div>
    </main>
  </body>
</html>
`;
}

export async function buildAllShowcases(filterFeature = null) {
  const targetFeatures = filterFeature ? FEATURES.filter((f) => f.id === filterFeature) : FEATURES;

  if (targetFeatures.length === 0) {
    console.error(`Unknown feature: "${filterFeature}". Available: ${FEATURES.map((f) => f.id).join(', ')}`);
    process.exit(1);
  }

  console.log(`\nBuilding component test showcase for ${targetFeatures.length} configuration(s)...`);
  fs.mkdirSync(distBaseDir, { recursive: true });

  const results = [];
  const concurrency = Math.max(1, Math.min(os.availableParallelism?.() || os.cpus()?.length || 2, 4));
  console.log(`Building with concurrency: ${concurrency}`);

  let index = 0;
  async function worker() {
    while (index < targetFeatures.length) {
      const feat = targetFeatures[index++];
      const outDir = path.join(distBaseDir, feat.id);
      fs.mkdirSync(outDir, { recursive: true });

      console.log(`[${feat.id}] Compiling showcase build...`);
      const startTime = Date.now();

      try {
        await pExec(`"${process.execPath}" "${viteBin}" build packages/showcase --config packages/showcase/vite.config.ts`, {
          cwd: rootDir,
          env: {
            ...process.env,
            FEATURE: feat.id,
            OUT_DIR: outDir,
            NODE_PATH: [path.resolve(__dirname, 'node_modules'), path.resolve(rootDir, 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter),
          },
          maxBuffer: 10 * 1024 * 1024,
        });

        const buildTimeMs = Date.now() - startTime;
        const { rawBytes, gzipBytes } = getDirSizes(outDir);

        results.push({
          id: feat.id,
          name: feat.name,
          description: feat.description,
          rawBytes,
          gzipBytes,
          buildTimeMs,
        });

        console.log(`[done] [${feat.id}] Complete in ${buildTimeMs}ms (${formatBytes(rawBytes)} raw, ${formatBytes(gzipBytes)} gzip)`);
      } catch (err) {
        console.error(`[error] [${feat.id}] Build failed:`, err?.stderr || err?.message || err);
        throw err;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, targetFeatures.length) }, () => worker());
  await Promise.all(workers);

  // Always inspect all features that exist in distBaseDir for the portal hub
  const allBuiltResults = [];
  for (const feat of FEATURES) {
    const featDir = path.join(distBaseDir, feat.id);
    if (fs.existsSync(featDir)) {
      const { rawBytes, gzipBytes } = getDirSizes(featDir);
      const recent = results.find((r) => r.id === feat.id);
      allBuiltResults.push({
        id: feat.id,
        name: feat.name,
        description: feat.description,
        rawBytes,
        gzipBytes,
        buildTimeMs: recent?.buildTimeMs,
      });
    }
  }

  if (allBuiltResults.length > 0) {
    const hubPath = path.join(distBaseDir, 'index.html');
    fs.writeFileSync(hubPath, generateHubHtml(allBuiltResults), 'utf-8');
    console.log(`\nGenerated GitHub Pages portal hub at ${hubPath} (${allBuiltResults.length} features listed)`);
  }

  return results;
}

// CLI entry point
const args = process.argv.slice(2);
let featureArg = null;
for (const arg of args) {
  if (arg.startsWith('--feature=')) {
    featureArg = arg.split('=')[1];
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildAllShowcases(featureArg).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
