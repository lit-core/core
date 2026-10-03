import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ALL_CRATES } from './affected.mjs';

function getLatestMtime(dir, exts = ['.rs', '.toml']) {
  let maxMtime = 0;

  function traverse(current) {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'target' && entry.name !== 'node_modules' && entry.name !== '.git') {
          traverse(fullPath);
        }
      } else if (entry.isFile()) {
        if (exts.some((ext) => entry.name.endsWith(ext))) {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs > maxMtime) {
            maxMtime = stat.mtimeMs;
          }
        }
      }
    }
  }

  traverse(dir);
  return maxMtime;
}

/**
 * Ensures all native binaries for specified (or all) crates are fresh.
 * Builds in fast debug mode if source files are newer than the .node binary.
 */
export function ensureNativeFresh(crates = ALL_CRATES, root = process.cwd()) {
  const rebuilt = [];

  for (const crate of crates) {
    const pkgDir = path.join(root, 'packages', crate);
    const cargoToml = path.join(pkgDir, 'Cargo.toml');
    if (!fs.existsSync(cargoToml)) continue;

    // Find .node binary in package root
    const entries = fs.readdirSync(pkgDir);
    const nodeBinary = entries.find((e) => e.endsWith('.node'));
    let binaryMtime = 0;
    if (nodeBinary) {
      binaryMtime = fs.statSync(path.join(pkgDir, nodeBinary)).mtimeMs;
    }

    const latestSourceMtime = getLatestMtime(pkgDir);

    if (!nodeBinary || latestSourceMtime > binaryMtime) {
      console.log(`[native-fresh] Stale binary detected in ${crate}, rebuilding in debug mode...`);
      const t0 = Date.now();
      try {
        execSync('pnpm run build:debug || pnpm run build', {
          cwd: pkgDir,
          stdio: 'inherit',
          env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1' },
        });
        const duration = ((Date.now() - t0) / 1000).toFixed(2);
        console.log(`[native-fresh] Successfully rebuilt ${crate} in ${duration}s`);
        rebuilt.push(crate);
      } catch (err) {
        console.error(`[native-fresh] Failed to rebuild ${crate}:`, err.message);
        throw err;
      }
    }
  }

  return rebuilt;
}

// Direct CLI execution
if (process.argv[1] && process.argv[1].endsWith('native-fresh.mjs')) {
  const targetCrates = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const crates = targetCrates.length > 0 ? targetCrates : ALL_CRATES;
  ensureNativeFresh(crates);
}
