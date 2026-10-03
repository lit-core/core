import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { closeSharedBrowser, createTestPage, getSharedBrowser, mapStackTrace, mountElement } from '@lit-core/test-kit';
import { CANONICAL_SUITE_DEFINITIONS } from '../../packages/benchmarks/src/suites/canonical-components.js';

const ROOT = process.cwd();
const benchmarksReq = createRequire(path.join(ROOT, 'packages', 'benchmarks', 'package.json'));
const { build } = await import(benchmarksReq.resolve('vite'));
const ARGS = process.argv.slice(2);

function getArg(prefix, fallback = null) {
  const match = ARGS.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const SUITE = getArg('--suite=', 'carbon');
const COMPONENT = getArg('--component=', null);

const ARTIFACTS_DIR = path.join(ROOT, 'artifacts', 'verify');

async function verifyComponent(suiteName, componentId, compDef, browser) {
  const { tag, importStatement } = compDef;
  const suiteDef = CANONICAL_SUITE_DEFINITIONS[suiteName];
  if (!suiteDef) {
    throw new Error(`Unknown suite: ${suiteName}`);
  }

  const t0 = Date.now();
  process.stdout.write(`  • [${suiteName}/${componentId}] (${tag})... `);

  // 1. In-memory Vite bundle with sourcemaps enabled
  let bundleCode = '';
  let bundleMap = null;

  try {
    const buildResult = await build({
      logLevel: 'silent',
      configFile: false,
      root: ROOT,
      build: {
        write: false,
        minify: false,
        sourcemap: true,
        rollupOptions: {
          input: `virtual:${suiteName}-${componentId}`,
          output: {
            codeSplitting: false,
          },
        },
      },
      plugins: [
        {
          name: 'verify-entry-plugin',
          enforce: 'pre',
          resolveId(id) {
            if (id === `virtual:${suiteName}-${componentId}`) {
              return `\0${id}`;
            }
          },
          load(id) {
            if (id === `\0virtual:${suiteName}-${componentId}`) {
              return `${importStatement}\nwindow.__componentDefined = Boolean(customElements.get('${tag}'));`;
            }
          },
        },
      ],
    });

    const outputChunks = Array.isArray(buildResult) ? buildResult[0].output : buildResult.output;
    const jsChunk = outputChunks.find((c) => c.fileName.endsWith('.js'));
    const mapChunk = outputChunks.find((c) => c.fileName.endsWith('.map'));

    bundleCode = jsChunk ? jsChunk.code : '';
    bundleMap = mapChunk?.source ? JSON.parse(mapChunk.source) : null;
  } catch (buildErr) {
    console.log(`✖ BUILD ERROR`);
    console.error(`    ${buildErr.message}`);
    return false;
  }

  // 2. Load bundle into sandboxed Chromium page
  const pageManager = await createTestPage(browser, {
    bundleCode,
    bundleName: `${suiteName}-${componentId}.bundle.js`,
  });

  try {
    const errors = pageManager.getErrors();
    if (errors.length > 0) {
      console.log(`✖ RUNTIME ERROR ON LOAD`);
      for (const err of errors) {
        if (bundleMap) {
          const mapped = mapStackTrace(err, bundleMap, `${suiteName}-${componentId}.bundle.js`);
          console.error(`    ${mapped.mappedStack}`);
        } else {
          console.error(`    ${err}`);
        }
      }
      saveFailingArtifact(suiteName, componentId, compDef, errors.join('\n'));
      return false;
    }

    // 3. Isolated custom element mount and lifecycle verification
    const mount = await mountElement(pageManager.page, tag);
    if (!mount.success) {
      console.log(`✖ MOUNT ERROR`);
      console.error(`    Tag <${tag}> failed during lifecycle: ${mount.error}`);
      saveFailingArtifact(suiteName, componentId, compDef, mount.error || 'Mount failed');
      return false;
    }

    const duration = Date.now() - t0;
    console.log(`✔ OK (${duration}ms)`);
    return true;
  } finally {
    await pageManager.close();
  }
}

function saveFailingArtifact(suite, component, compDef, errorDetails) {
  const targetDir = path.join(ARTIFACTS_DIR, suite, component);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'error.log'), `Error verifying ${suite}/${component} (<${compDef.tag}>):\n${errorDetails}\n`, 'utf-8');
  console.log(`    Saved debug report to artifacts/verify/${suite}/${component}/error.log`);
}

async function main() {
  console.log(`\n=== lit-core component verification ===`);
  const targetSuites = SUITE === 'all' ? Object.keys(CANONICAL_SUITE_DEFINITIONS) : [SUITE];

  const browser = await getSharedBrowser();
  let totalTested = 0;
  let totalPassed = 0;

  try {
    for (const sName of targetSuites) {
      const suiteDef = CANONICAL_SUITE_DEFINITIONS[sName];
      if (!suiteDef) {
        console.error(`Unknown suite: ${sName}`);
        continue;
      }

      console.log(`\nVerifying suite: ${sName} (${suiteDef.packageName})`);
      const compIds = COMPONENT ? [COMPONENT] : Object.keys(suiteDef.components);

      for (const cId of compIds) {
        const compDef = suiteDef.components[cId];
        if (!compDef) {
          console.error(`Unknown component: ${cId} in suite ${sName}`);
          continue;
        }

        totalTested++;
        const passed = await verifyComponent(sName, cId, compDef, browser);
        if (passed) {
          totalPassed++;
        }
      }
    }
  } finally {
    await closeSharedBrowser();
  }

  console.log(`\nResults: ${totalPassed}/${totalTested} components verified successfully.\n`);
  if (totalPassed < totalTested) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  await closeSharedBrowser();
  console.error('Fatal verification error:', err);
  process.exit(1);
});
