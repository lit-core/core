#!/usr/bin/env node

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

try {
  // Query changed files in the working tree
  const status = execSync('git status --porcelain', {
    cwd: repoRoot,
    encoding: 'utf-8',
    timeout: 5000,
  });

  const lines = status.split('\n').filter(Boolean);
  const jsFiles = [];
  let rustChanged = false;

  for (const line of lines) {
    // line is in porcelain format: "XY path"
    const file = line.slice(3).trim();
    if ((file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.mjs') || file.endsWith('.json')) && !file.includes('results/') && !file.includes('node_modules/')) {
      jsFiles.push(file);
    } else if (file.endsWith('.rs')) {
      rustChanged = true;
    }
  }

  // Format JS/TS/JSON files with Biome
  if (jsFiles.length > 0) {
    execSync(`pnpm exec biome format --write ${jsFiles.slice(0, 30).join(' ')}`, {
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
  // Silent fail-safe: formatting errors should never crash the hook runner
}

// PostToolUse contract expects empty JSON object on stdout
process.stdout.write('{}');
process.exit(0);
