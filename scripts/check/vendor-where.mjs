import { createRequire } from 'node:module';
import path from 'node:path';
import { CANONICAL_COMPONENT_IDS, CANONICAL_COMPONENT_METADATA, CANONICAL_SUITE_DEFINITIONS } from '../../packages/benchmarks/src/suites/canonical-components.js';

const ROOT = process.cwd();
const req = createRequire(path.join(ROOT, 'package.json'));

const args = process.argv.slice(2);
const suiteArg = args[0] || 'all';
const compArg = args[1] || null;

const suites = suiteArg === 'all' ? Object.keys(CANONICAL_SUITE_DEFINITIONS) : [suiteArg];

console.log(`\n=== canonical component source lookup ===\n`);

for (const sName of suites) {
  const suiteDef = CANONICAL_SUITE_DEFINITIONS[sName];
  if (!suiteDef) {
    console.error(`Unknown suite: ${sName}. Valid suites: ${Object.keys(CANONICAL_SUITE_DEFINITIONS).join(', ')}`);
    continue;
  }

  let pkgVersion = 'unknown';
  try {
    const pkgJson = req(`${suiteDef.packageName}/package.json`);
    pkgVersion = pkgJson.version || 'unknown';
  } catch {}

  console.log(`Suite: ${sName}`);
  console.log(`Package: ${suiteDef.packageName} (v${pkgVersion})`);

  const compKeys = compArg ? [compArg] : Object.keys(suiteDef.components);

  for (const cKey of compKeys) {
    const comp = suiteDef.components[cKey];
    if (!comp) {
      console.log(`  • ${cKey}: not found in ${sName}`);
      continue;
    }

    const meta = CANONICAL_COMPONENT_METADATA[cKey] || { label: cKey };
    let resolvedPath = 'unresolved';
    try {
      resolvedPath = req.resolve(path.join(suiteDef.packageName, comp.path));
    } catch {
      resolvedPath = `${suiteDef.packageName}/${comp.path}`;
    }

    console.log(`  • ${cKey.padEnd(14)} <${comp.tag.padEnd(24)}> ${resolvedPath}`);
  }
  console.log();
}
