import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ALL_CRATES, getAffected } from './affected.mjs';

const ROOT = process.cwd();
const ARGS = process.argv.slice(2);
const IS_ALL = ARGS.includes('--all');
const ONLY_RUST = ARGS.includes('--rust');
const ONLY_JS = ARGS.includes('--js');
const NO_BAIL = ARGS.includes('--no-bail');

const LOG_DIR = path.join(ROOT, 'artifacts', 'check');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}
const LOG_FILE = path.join(LOG_DIR, 'last.log');
fs.writeFileSync(LOG_FILE, `Check run started at ${new Date().toISOString()}\n\n`, 'utf-8');

function log(msg, toConsole = true) {
  fs.appendFileSync(LOG_FILE, `${msg}\n`, 'utf-8');
  if (toConsole) {
    console.log(msg);
  }
}

function runStep(name, cmd, cwd = ROOT) {
  const t0 = Date.now();
  log(`▶ ${name}...`);
  fs.appendFileSync(LOG_FILE, `--- RUNNING: ${cmd} (cwd: ${cwd}) ---\n`, 'utf-8');

  const res = spawnSync(cmd, {
    cwd,
    shell: true,
    encoding: 'utf-8',
    env: {
      ...process.env,
      TURBO_TELEMETRY_DISABLED: '1',
      CI: '1',
    },
  });

  const duration = ((Date.now() - t0) / 1000).toFixed(2);
  if (res.stdout) fs.appendFileSync(LOG_FILE, res.stdout, 'utf-8');
  if (res.stderr) fs.appendFileSync(LOG_FILE, res.stderr, 'utf-8');

  if (res.status !== 0) {
    log(`✖ ${name} failed (${duration}s)`);
    // Output last 15 lines of error for immediate readability
    const output = (res.stderr || res.stdout || '').trim().split('\n');
    const tail = output.slice(-15).join('\n');
    if (tail) {
      console.log(`\n${tail}\n`);
    }
    log(`See complete output in artifacts/check/last.log\n`);
    if (!NO_BAIL) {
      process.exit(res.status || 1);
    }
    return false;
  }

  log(`✔ ${name} passed (${duration}s)`);
  return true;
}

async function main() {
  const affected = getAffected({ all: IS_ALL });
  log(`\n=== lit-core fast validation loop ===`);
  log(`Changed files: ${affected.changedFiles.length}`);
  log(`Affected crates: ${affected.affectedCrates.join(', ') || 'none'}`);
  log(`Affected packages: ${affected.affectedPackages.join(', ') || 'none'}\n`);

  let allPassed = true;

  // Tier 0: Format & lint check (skipped if only rust or only js)
  if (!ONLY_RUST && !ONLY_JS && affected.changedFiles.length > 0) {
    const filesToCheck = affected.changedFiles
      .filter((f) => (f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.mjs')) && !f.includes('results/'))
      .slice(0, 30)
      .join(' ');
    const cmd = filesToCheck ? `pnpm exec biome check ${filesToCheck} --no-errors-on-unmatched` : 'pnpm exec biome check scripts packages/test-kit';
    const passed = runStep('tier 0: biome format & lint check', cmd);
    if (!passed) allPassed = false;
  }

  // Tier 1: Rust unit tests on affected crates
  if (!ONLY_JS && affected.affectedCrates.length > 0) {
    if (affected.affectedCrates.length === ALL_CRATES.length) {
      const passed = runStep('tier 1: cargo test workspace', 'cargo test --workspace');
      if (!passed) allPassed = false;
    } else {
      for (const crate of affected.affectedCrates) {
        const manifestPath = path.join(ROOT, 'packages', crate, 'Cargo.toml');
        if (fs.existsSync(manifestPath)) {
          const passed = runStep(`tier 1: cargo test for ${crate}`, `cargo test -p ${crate.replace(/-/g, '_')}`);
          if (!passed) allPassed = false;
        }
      }
    }
  }

  // Ensure native binaries are fresh before running JS tests
  if (!ONLY_RUST && affected.affectedCrates.length > 0) {
    runStep('tier 1.5: verify native binary freshness', 'node scripts/check/native-fresh.mjs');
  }

  // Tier 2: JS unit tests on affected packages
  if (!ONLY_RUST && affected.affectedPackages.length > 0) {
    for (const pkg of affected.affectedPackages) {
      if (pkg === 'benchmarks' && !IS_ALL) {
        // Benchmarks run during tier 4 or on demand, not in the fast unit loop
        continue;
      }
      const pkgJsonPath = path.join(ROOT, 'packages', pkg, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        try {
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
          if (pkgJson.scripts?.test) {
            const passed = runStep(`tier 2: js tests for ${pkg}`, `pnpm --filter @lit-core/${pkg} run test`);
            if (!passed) allPassed = false;
          }
        } catch {}
      }
    }
  }

  if (!allPassed) {
    log(`\n✖ Validation check failed.\n`);
    process.exit(1);
  }

  log(`\n✔ Validation check completed successfully.\n`);
}

main().catch((err) => {
  console.error('Fatal error during validation check:', err);
  process.exit(1);
});
