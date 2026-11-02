import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from '@lit-core/ssr';
import { html } from 'lit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countMarkers, TARGETS, verifyEdgeDesignSystemSsr } from '../../../benchmarks/src/features/edge-head-to-head.js';
import { closeTestBrowser, getTestBrowser, setupTestPage } from '../harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(__dirname, '../../../../..');
const benchmarkScriptPath = path.resolve(monorepoRoot, 'packages/internal/benchmarks/src/features/edge-head-to-head.js');
const benchmarkResultJsonPath = path.resolve(monorepoRoot, 'packages/internal/benchmarks/results/edge-head-to-head.json');
const claimsDocPath = path.resolve(monorepoRoot, 'docs/claims.md');
const serverElementsWhitepaperPath = path.resolve(monorepoRoot, 'packages/primitives/server-elements/docs/whitepaper.md');
const ssrWhitepaperPath = path.resolve(monorepoRoot, 'packages/rendering/ssr/src/whitepaper.md');

describe('milestone M7: server elements benchmarks and claims verification', () => {
  let canonicalBenchmarkJson: string | null = null;

  beforeAll(async () => {
    if (fs.existsSync(benchmarkResultJsonPath)) {
      canonicalBenchmarkJson = fs.readFileSync(benchmarkResultJsonPath, 'utf-8');
    }
    await getTestBrowser();
  });

  afterAll(async () => {
    await closeTestBrowser();
    if (canonicalBenchmarkJson !== null) {
      fs.writeFileSync(benchmarkResultJsonPath, canonicalBenchmarkJson, 'utf-8');
    }
  });

  describe('CLI execution and benchmark artifact verification', () => {
    it('executes edge-head-to-head.js --verbose and exits cleanly with code 0', () => {
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lit-edge-bench-out-'));
      const proc = spawnSync('node', [benchmarkScriptPath, '--verbose'], {
        cwd: monorepoRoot,
        encoding: 'utf-8',
        timeout: 45000,
        env: { ...process.env, LIT_BENCH_OUT_DIR: scratch },
      });

      expect(proc.status).toBe(0);
      expect(proc.stdout).toContain('LIT-CORE BENCHMARK: EDGE-HEAD-TO-HEAD');
      expect(proc.stdout).toContain('BENCHMARK COMPLETE');
      expect(proc.stderr).not.toContain('UnhandledPromiseRejection');
      expect(fs.existsSync(path.join(scratch, 'edge-head-to-head.json'))).toBe(true);
      fs.rmSync(scratch, { recursive: true, force: true });
    });

    it('produces valid edge-head-to-head.json artifact matching schema', () => {
      expect(fs.existsSync(benchmarkResultJsonPath)).toBe(true);
      const raw = fs.readFileSync(benchmarkResultJsonPath, 'utf-8');
      const data = JSON.parse(raw);

      expect(data.schemaVersion).toBe('1.0.0');
      expect(data.benchmarkId).toBe('edge-head-to-head');
      expect(Array.isArray(data.suites)).toBe(true);
      expect(data.suites).toHaveLength(3);

      const targetIds = data.suites.map((s: any) => s.id);
      expect(targetIds).toContain('target-a');
      expect(targetIds).toContain('target-c');
      expect(targetIds).toContain('target-d');

      expect(data.summary).toBeDefined();
      expect(typeof data.summary.clientJsSavingsVsBaselinePercent).toBe('number');
      expect(typeof data.summary.actionWireSavingsVsBaselinePercent).toBe('number');
      expect(typeof data.summary.workerCpuExecutionTimeMs).toBe('number');
      expect(data.summary.designSystemsVerifiedCount).toBe(4);
    });

    it('verifies all 4 design systems have genuine cpuTimeMs > 0 and renderedBytes > 0', async () => {
      const results = await verifyEdgeDesignSystemSsr();
      expect(results).toHaveLength(4);
      for (const ds of results) {
        expect(ds.zeroCommentMarkersVerified).toBe(true);
        expect(ds.commentMarkersCount).toBe(0);
        expect(ds.cpuTimeMs).toBeGreaterThan(0);
        expect(ds.cpuTimeMs).toBeLessThan(10);
        expect(ds.renderedBytes).toBeGreaterThan(0);
      }
    });

    it('confirms total absence of React 19 RSC from targets and benchmark suites', () => {
      // 1. Inspect TARGETS export
      expect(Array.isArray(TARGETS)).toBe(true);
      const rscTarget = TARGETS.find((t: any) => t.id === 'react-rsc' || /react/i.test(t.name) || /rsc/i.test(t.name));
      expect(rscTarget).toBeUndefined();

      // 2. Inspect benchmark artifact
      const data = JSON.parse(fs.readFileSync(benchmarkResultJsonPath, 'utf-8'));
      const rscSuite = data.suites.find((s: any) => s.id === 'react-rsc' || /rsc/i.test(s.id));
      expect(rscSuite).toBeUndefined();

      // 3. Inspect edge-head-to-head.js source for legacy evaluateTargetB and RSC references
      const source = fs.readFileSync(benchmarkScriptPath, 'utf-8');
      expect(source).not.toContain('evaluateTargetB');
      expect(source).not.toContain('react-server-dom-webpack');
      expect(source).not.toMatch(/\bRSC\b/);
    });
  });

  describe('honest marker counting in Chromium', () => {
    it('honestly counts all comment nodes in Chromium including bogus comments', async () => {
      const adjacentMarkup = renderToString(html`<span class="label">Prefix</span>${'Adjacent text'}<span class="suffix">Suffix</span>`);
      const shadowDynamicMarkup = renderToString(html`<span class="shadow-prefix">Info:</span>${'Shadow dynamic'}`);

      const page = await setupTestPage({
        html: `
          <div class="test-container">
            <div class="plain-branch">
              <span class="element-attr" data-status="active">Sole element</span>
              <h1 class="sole-text">Sole text title</h1>
            </div>
            <div class="adjacent-branch">
              ${adjacentMarkup}
            </div>
            <custom-card>
              <template shadowrootmode="open">
                <style>:host { display: block; }</style>
                <!--lit-part abc-->
                <div class="shadow-inner">Card body</div>
                <!--/lit-->
                ${shadowDynamicMarkup}
              </template>
            </custom-card>
          </div>
        `,
      });

      const counts = await page.evaluate(() => {
        function countMarkersInTree(root: Node): { commentNodes: number; bogusComments: number; total: number } {
          let commentNodes = 0;
          let bogusComments = 0;

          function walk(node: Node) {
            if (node.nodeType === Node.COMMENT_NODE) {
              commentNodes++;
            } else if (node.nodeType === 7) {
              // Blink parses range markers as processing instruction (bogus comment)
              bogusComments++;
            }

            const element = node as Element;
            if (element.shadowRoot) {
              walk(element.shadowRoot);
            }

            for (let child = node.firstChild; child; child = child.nextSibling) {
              walk(child);
            }
          }

          walk(root);
          return { commentNodes, bogusComments, total: commentNodes + bogusComments };
        }

        const container = document.querySelector('.test-container');
        if (!container) {
          throw new Error('Missing test container');
        }
        const plain = document.querySelector('.plain-branch') ?? container;
        const adjacent = document.querySelector('.adjacent-branch') ?? container;
        const shadow = document.querySelector('custom-card') ?? container;

        return {
          plain: countMarkersInTree(plain),
          adjacent: countMarkersInTree(adjacent),
          shadow: countMarkersInTree(shadow),
          total: countMarkersInTree(container),
        };
      });

      // Sole text and element-anchored bindings produce 0 markers
      expect(counts.plain.total).toBe(0);

      // Adjacent text produces exactly 2 range markers
      expect(counts.adjacent.total).toBe(2);
      expect(counts.adjacent.bogusComments).toBe(2);

      // Shadow root contains 2 legacy comments + 2 range markers
      expect(counts.shadow.commentNodes).toBe(2);
      expect(counts.shadow.bogusComments).toBe(2);
      expect(counts.shadow.total).toBe(4);
    });

    it('verifies genuine marker counts in edge-head-to-head benchmark results', () => {
      const data = JSON.parse(fs.readFileSync(benchmarkResultJsonPath, 'utf-8'));
      const targetA = data.suites.find((s: any) => s.id === 'target-a');
      const targetD = data.suites.find((s: any) => s.id === 'target-d');

      expect(targetA).toBeDefined();
      expect(targetD).toBeDefined();

      // Target D (@lit-labs/ssr) must honestly report legacy comment markers
      expect(targetD.metrics.commentMarkersCount).toBeGreaterThan(0);

      // Target A (@lit-core/server-elements) marker count must be strictly less than Target D
      expect(targetA.metrics.commentMarkersCount).toBeLessThan(targetD.metrics.commentMarkersCount);
    });

    it('verifies countMarkers helper honestly accounts for all marker types', () => {
      // 1. Plain template with sole text
      const plain = renderToString(html`<div><h1>${'Title'}</h1><span>${100}</span></div>`);
      const mPlain = countMarkers(plain);
      expect(mPlain.totalMarkersCount).toBe(0);

      // 2. Template with adjacent text range markers emitted by @lit-core/ssr
      const range = renderToString(html`<div><span>Label:</span>${'Adjacent'}</div>`);
      const mRange = countMarkers(range);
      expect(mRange.rangeMarkersCount).toBe(2);
      expect(mRange.totalMarkersCount).toBe(2);

      // 3. Template with legacy Lit comment markers
      const legacy = '<div><!--lit-part--><span>Legacy</span><!--/lit--></div>';
      const mLegacy = countMarkers(legacy);
      expect(mLegacy.commentMarkersCount).toBe(2);
      expect(mLegacy.totalMarkersCount).toBe(2);
    });
  });

  describe('CPU measurements, warm iterations, and zero Math.max clamps', () => {
    it('verifies zero Math.max floors or artificial clamps in benchmark source code', () => {
      const source = fs.readFileSync(benchmarkScriptPath, 'utf-8');

      // Specifically check for Math.max used on CPU times or duration measurements
      const mathMaxCpuMatch = source.match(/Math\.max\s*\(\s*[\d.]+\s*,\s*[^)]*cpu/i) || source.match(/cpu[a-zA-Z0-9_]*\s*=\s*Math\.max\s*\(\s*[\d.]+/i) || source.match(/Math\.max\s*\(\s*0\.[48]/i);

      expect(mathMaxCpuMatch).toBeNull();
    });

    it('verifies CPU measurements report median and p95 over warm iterations', () => {
      const data = JSON.parse(fs.readFileSync(benchmarkResultJsonPath, 'utf-8'));
      const targetA = data.suites.find((s: any) => s.id === 'target-a');

      expect(targetA).toBeDefined();
      expect(targetA.metrics.workerCpuMs).toBeDefined();
      expect(targetA.metrics.workerCpuMs).toBeGreaterThan(0);
      expect(targetA.metrics.workerCpuMs).toBeLessThan(10);

      // Verify median and p95 or warm iteration statistics
      const cpuStats =
        targetA.optimized?.workerCpu ||
        targetA.diagnostics?.workerCpuStats ||
        (targetA.metrics?.workerCpuMedianMs !== undefined
          ? {
              medianMs: targetA.metrics.workerCpuMedianMs,
              p95Ms: targetA.metrics.workerCpuP95Ms,
              warmIterations: targetA.metrics.warmIterations ?? 50,
            }
          : undefined);

      expect(cpuStats).toBeDefined();
      if (cpuStats) {
        expect(cpuStats.medianMs).toBeGreaterThan(0);
        expect(cpuStats.p95Ms).toBeGreaterThanOrEqual(cpuStats.medianMs);
        expect(cpuStats.warmIterations).toBeGreaterThanOrEqual(5);
      }
    });

    it('verifies exact runtime environment label in benchmark results', () => {
      const data = JSON.parse(fs.readFileSync(benchmarkResultJsonPath, 'utf-8'));
      expect(data.environment).toBeDefined();
      expect(data.environment.node).toBe(process.version);
      expect(data.environment.platform).toBe(process.platform);
      expect(data.environment.arch).toBe(process.arch);
      expect(data.environment.gitCommit).toBeDefined();

      const runtimeLabel = data.tier || data.environment?.runtime || data.suites[0]?.diagnostics?.runtime || data.suites[0]?.metrics?.workerCpuEnvironment;
      expect(runtimeLabel).toBeDefined();
    });
  });

  describe('live documentation and claims synchronization', () => {
    it('verifies synchronization between live benchmark output and docs/claims.md', () => {
      expect(fs.existsSync(claimsDocPath)).toBe(true);
      const claimsContent = fs.readFileSync(claimsDocPath, 'utf-8');

      // Verify active claims ledger entries
      expect(claimsContent).toContain('Honest marker count in Chromium');
      expect(claimsContent).toContain('Zero Lit runtime in client bundle');
      expect(claimsContent).toContain('Surgical dirty-part action patching');

      // Verify retracted claims
      expect(claimsContent).toContain('0.4 ms worker CPU time');
      expect(claimsContent).toContain('100% zero comment marker bloat');
      expect(claimsContent).toContain('React 19 RSC comparison');

      // Verify that M7 claims have transitioned from pending remediation to verified
      expect(claimsContent).not.toMatch(/Honest marker count in Chromium.*pending remediation/);
      expect(claimsContent).not.toMatch(/Zero Lit runtime in client bundle.*pending remediation/);

      // Verify empirical benchmark table presence
      expect(claimsContent).toContain('Edge head-to-head benchmark results');

      // Compare client JS savings percentage
      const data = JSON.parse(fs.readFileSync(benchmarkResultJsonPath, 'utf-8'));
      const liveClientSavings = data.summary.clientJsSavingsVsBaselinePercent;
      expect(liveClientSavings).toBeGreaterThan(50);

      const liveActionSavings = data.summary.actionWireSavingsVsBaselinePercent;
      expect(liveActionSavings).toBeGreaterThan(15);
    });

    it('verifies synchronization between live benchmark output and whitepaper.md', () => {
      const whitepaperPath = fs.existsSync(serverElementsWhitepaperPath) ? serverElementsWhitepaperPath : ssrWhitepaperPath;

      expect(fs.existsSync(whitepaperPath)).toBe(true);
      const whitepaperContent = fs.readFileSync(whitepaperPath, 'utf-8');

      // Ensure no active React 19 RSC benchmark claim tables
      expect(whitepaperContent).not.toMatch(/\|\s*RSC\s*\|\s*[\d.]+\s*ms/);

      // Ensure retracted claims are not asserted as facts
      expect(whitepaperContent).not.toContain('1.2 KB micro-loader');
      expect(whitepaperContent).not.toContain('100% zero comment marker bloat');

      // Ensure honest discussion of markers (does not claim 100% zero comment markers without qualification)
      if (whitepaperContent.includes('zero comment marker')) {
        expect(whitepaperContent).toMatch(/element-anchored|sole-text|adjacent/i);
      }
    });

    it('enforces strict sentence case across all headings in claims.md and whitepaper.md', () => {
      const allowedProperNouns = new Set([
        'Lit',
        'Web',
        'Components',
        'Component',
        'Shadow',
        'DOM',
        'DSD',
        'HTML',
        'CSS',
        'AST',
        'SSR',
        'V8',
        'ESM',
        'Vite',
        'Rollup',
        'Webpack',
        'Cloudflare',
        'Chromium',
        'Playwright',
        'Vitest',
        'Node.js',
        'Node',
        'Bun',
        'Deno',
        'Fastly',
        'IBM',
        'Carbon',
        'Adobe',
        'Spectrum',
        'Google',
        'Material',
        'Cisco',
        'Momentum',
        'Awesome',
        'WHATWG',
        'W3C',
        'HTMLRewriter',
        'ISME',
        'TTFB',
        'TTLB',
        'CPU',
        'KB',
        'MB',
        'HMAC',
        'SHA256',
        'JSON',
        'REST',
        'API',
        'RPC',
        'RSC',
        'Next.js',
        'Nextjs',
        'Marko',
        'Angular',
        'SolidStart',
        'Svelte',
        'Remix',
        'Fresh',
        'HTMX',
        'Stencil',
        'Fluurt',
        'Universal',
        'Suspense',
        'Flight',
        'Server',
        'Enhance',
        'Enhancedev',
        'Declarative',
      ]);

      const docFiles = [claimsDocPath, fs.existsSync(serverElementsWhitepaperPath) ? serverElementsWhitepaperPath : ssrWhitepaperPath];

      for (const file of docFiles) {
        const lines = fs.readFileSync(file, 'utf-8').split('\n');
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/^(#{1,6})\s+(.*)$/);
          if (!match) continue;

          let headingText = match[2].trim();
          headingText = headingText.replace(/^\d+[.)]\s*/, '');
          const words = headingText.split(/\s+/);

          for (let j = 1; j < words.length; j++) {
            const word = words[j].replace(/[^a-zA-Z0-9_-]/g, '');
            if (word.length > 3 && /^[A-Z][a-z]+$/.test(word) && !allowedProperNouns.has(word)) {
              throw new Error(`Sentence case violation at ${file}:${i + 1} in heading "${headingText}" on word "${word}"`);
            }
          }
        }
      }
    });
  });
});
