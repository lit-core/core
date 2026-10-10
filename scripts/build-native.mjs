#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const ALL_CRATES = [
  'css-fuse',
  'props-lower',
  'css-minifier',
  'html-minifier',
  'html-fuse',
  'native',
  'event-hoist',
  'memoize',
  'elem-proxy',
  'dom-paths',
  'dirty-mask',
  'directives',
  'html-aot',
  'tag-shake',
  'resumable',
];

const args = process.argv.slice(2);
const isRelease = args.includes('--release');
const runTsc = args.includes('--tsc');
const isAll = args.includes('--all') || args.includes('--workspace');
const forceRebuild = args.includes('--force');

const currentPlatform = process.platform;
const currentArch = process.arch;

let platformId;
let libExt;
let libPrefix = 'lib';

if (currentPlatform === 'darwin') {
  platformId = currentArch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  libExt = '.dylib';
} else if (currentPlatform === 'linux') {
  platformId = currentArch === 'arm64' ? 'linux-arm64-gnu' : 'linux-x64-gnu';
  libExt = '.so';
} else if (currentPlatform === 'win32') {
  platformId = `win32-${currentArch}-msvc`;
  libExt = '.dll';
  libPrefix = '';
} else {
  console.error(`Unsupported platform: ${currentPlatform} ${currentArch}`);
  process.exit(1);
}

const mode = isRelease ? 'release' : 'debug';

function checkCrateFresh(pkgDir, destNode) {
  if (!fs.existsSync(destNode)) return false;
  const destMtime = fs.statSync(destNode).mtimeMs;

  function hasNewer(dir) {
    if (!fs.existsSync(dir)) return false;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'target' || entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (hasNewer(full)) return true;
      } else if (entry.isFile() && (full.endsWith('.rs') || full.endsWith('Cargo.toml') || full.endsWith('build.rs'))) {
        if (fs.statSync(full).mtimeMs > destMtime) return true;
      }
    }
    return false;
  }

  return !hasNewer(pkgDir);
}

function copyCrateArtifacts(crate, pkgDir) {
  const crateUnderscore = crate.replace(/-/g, '_');
  const libFileName = `${libPrefix}${crateUnderscore}${libExt}`;

  const candidates = [path.resolve(rootDir, 'target', mode, libFileName), path.resolve(pkgDir, 'target', mode, libFileName)];

  const foundLib = candidates.filter((p) => fs.existsSync(p)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

  if (!foundLib) {
    console.error(`[build-native] Could not locate compiled library ${libFileName} in:`);
    for (const c of candidates) console.error(`  - ${c}`);
    process.exit(1);
  }

  const destNode = path.resolve(pkgDir, `${crate}.${platformId}.node`);
  fs.copyFileSync(foundLib, destNode);
  console.log(`[build-native] Copied ${libFileName} -> ${path.basename(destNode)}`);

  if (currentPlatform === 'darwin') {
    try {
      execSync(`codesign -s - -f "${destNode}"`, { stdio: 'ignore' });
    } catch {}
  }

  // Copy optional binary to bin/ directory if present
  const binDir = path.resolve(pkgDir, 'bin');
  if (fs.existsSync(binDir)) {
    const binCandidates = [path.resolve(rootDir, 'target', mode, `${crate}-bin`), path.resolve(pkgDir, 'target', mode, `${crate}-bin`)];
    const foundBin = binCandidates.find((p) => fs.existsSync(p));
    if (foundBin) {
      const destBin = path.join(binDir, `${crate}-bin`);
      fs.copyFileSync(foundBin, destBin);
      fs.chmodSync(destBin, 0o755);
      console.log(`[build-native] Copied binary -> bin/${crate}-bin`);
    }
  }

  // Compile TypeScript if tsconfig is present
  const tsconfigPath = path.resolve(pkgDir, 'tsconfig.json');
  const tscBin = path.resolve(rootDir, 'node_modules/.bin/tsc');
  if ((runTsc || ['dom-paths', 'native', 'resumable'].includes(crate)) && fs.existsSync(tsconfigPath)) {
    try {
      execSync(`"${tscBin}" -p tsconfig.json`, { cwd: pkgDir, stdio: 'inherit' });
    } catch (e) {
      console.error(`[build-native] tsc failed for ${crate}:`, e.message);
      process.exit(1);
    }
  }
}

if (isAll) {
  console.log(`[build-native] Compiling full workspace (${mode})...`);
  const cargoCmd = `cargo build --workspace ${isRelease ? '--release' : ''}`;
  execSync(cargoCmd, { cwd: rootDir, stdio: 'inherit' });

  for (const crate of ALL_CRATES) {
    const pkgDir = path.resolve(rootDir, 'packages', crate);
    if (fs.existsSync(pkgDir)) {
      copyCrateArtifacts(crate, pkgDir);
    }
  }
  console.log(`[build-native] Successfully updated all native workspace crates.`);
  process.exit(0);
}

// Single crate build mode
let crateName = args.find((a) => !a.startsWith('-'));
const cwd = process.cwd();
if (!crateName && fs.existsSync('package.json')) {
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    crateName = pkg.napi?.binaryName || pkg.name?.replace('@lit-core/', '');
  } catch {}
}

if (!crateName) {
  console.error('Usage: node scripts/build-native.mjs <crate-name|--all> [--release] [--tsc] [--force]');
  process.exit(1);
}

const pkgDir = cwd.endsWith(crateName) ? cwd : path.resolve(rootDir, 'packages', crateName);
const destNode = path.resolve(pkgDir, `${crateName}.${platformId}.node`);

if (!forceRebuild && checkCrateFresh(pkgDir, destNode)) {
  console.log(`[build-native] ${crateName} is already up to date, skipping compilation.`);
  process.exit(0);
}

const cargoPkgName = crateName === 'tag-shake' ? 'tag-shake' : crateName.replace(/-/g, '_');
const cargoCmd = `cargo build -p ${cargoPkgName} ${isRelease ? '--release' : ''}`;
console.log(`[build-native] Compiling ${cargoPkgName} (${mode})...`);
execSync(cargoCmd, { cwd: rootDir, stdio: 'inherit' });

copyCrateArtifacts(crateName, pkgDir);
