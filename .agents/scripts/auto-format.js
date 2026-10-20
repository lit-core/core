#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const biomeBin = path.join(repoRoot, 'node_modules', '.bin', 'biome');

const BIOME_EXT_RE = /\.(?:[cm]?[jt]sx?|json|css)$/;

try {
  // Query changed and untracked files (including inside new directories via -uall)
  const status = execSync('git status --porcelain -uall', {
    cwd: repoRoot,
    encoding: 'utf-8',
    timeout: 5000,
  });

  const lines = status.split('\n').filter(Boolean);
  const biomeFiles = [];
  let rustChanged = false;

  for (const line of lines) {
    // Porcelain format: "XY path" or "XY orig -> renamed"
    let file = line.slice(3).trim();
    if (file.includes(' -> ')) {
      file = file.split(' -> ').pop().trim();
    }
    if (file.startsWith('"') && file.endsWith('"')) {
      file = file.slice(1, -1);
    }

    if (!fs.existsSync(path.join(repoRoot, file))) {
      continue;
    }

    if (BIOME_EXT_RE.test(file) && !file.includes('results/') && !file.includes('node_modules/') && !file.startsWith('.agents/')) {
      biomeFiles.push(file);
    } else if (file.endsWith('.rs')) {
      rustChanged = true;
    }
  }

  // Format, sort imports, and apply safe lint fixes with Biome
  if (biomeFiles.length > 0 && fs.existsSync(biomeBin)) {
    const targetArgs = biomeFiles.length <= 25 ? biomeFiles.map((f) => JSON.stringify(f)).join(' ') : '.';
    execSync(`${JSON.stringify(biomeBin)} check --write --no-errors-on-unmatched ${targetArgs}`, {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 10000,
    });
  }

  // Format Rust files with cargo fmt if any .rs changed
  if (rustChanged) {
    execSync('cargo fmt', {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 10000,
    });
  }
} catch {
  // Silent fail-safe: PostToolUse cannot report errors, Stop hook handles verification
}

// PostToolUse contract expects empty JSON object on stdout
process.stdout.write('{}');
process.exit(0);

