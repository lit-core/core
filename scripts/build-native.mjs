#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const isRelease = args.includes('--release');
const runTsc = args.includes('--tsc');

// Determine crate name from CLI argument or package.json
let crateName = args.find((a) => !a.startsWith('-'));
if (!crateName && fs.existsSync('package.json')) {
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    crateName = pkg.napi?.binaryName || pkg.name?.replace('@lit-core/', '');
  } catch {}
}

if (!crateName) {
  console.error('Usage: node scripts/build-native.mjs <crate-name> [--release] [--tsc]');
  process.exit(1);
}

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
const cargoCmd = `cargo build ${isRelease ? '--release' : ''}`;

console.log(`[build-native] Compiling ${crateName} (${mode})...`);
execSync(cargoCmd, { stdio: 'inherit' });

const crateUnderscore = crateName.replace(/-/g, '_');
const libFileName = `${libPrefix}${crateUnderscore}${libExt}`;

const cwd = process.cwd();
const candidates = [path.resolve(cwd, '../..', 'target', mode, libFileName), path.resolve(cwd, 'target', mode, libFileName)];

const foundLib = candidates.filter((p) => fs.existsSync(p)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (!foundLib) {
  console.error(`[build-native] Could not locate compiled library ${libFileName} in:`);
  for (const c of candidates) console.error(`  - ${c}`);
  process.exit(1);
}

const destNode = path.resolve(cwd, `${crateName}.${platformId}.node`);
fs.copyFileSync(foundLib, destNode);
console.log(`[build-native] Copied ${libFileName} -> ${path.basename(destNode)}`);

if (currentPlatform === 'darwin') {
  try {
    execSync(`codesign -s - -f "${destNode}"`, { stdio: 'ignore' });
  } catch {}
}

// Copy optional binary to bin/ directory if present
const binDir = path.resolve(cwd, 'bin');
if (fs.existsSync(binDir)) {
  const binCandidates = [path.resolve(cwd, 'target', mode, `${crateName}-bin`), path.resolve(cwd, '../..', 'target', mode, `${crateName}-bin`)];
  const foundBin = binCandidates.find((p) => fs.existsSync(p));
  if (foundBin) {
    const destBin = path.join(binDir, `${crateName}-bin`);
    fs.copyFileSync(foundBin, destBin);
    fs.chmodSync(destBin, 0o755);
    console.log(`[build-native] Copied binary -> bin/${crateName}-bin`);
  }
}

if (runTsc) {
  console.log('[build-native] Running tsc...');
  execSync('tsc -p tsconfig.json', { stdio: 'inherit' });
}
