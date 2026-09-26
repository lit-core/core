#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = join(__dirname, 'html-fuse-bin');

if (existsSync(binPath)) {
  const result = spawnSync(binPath, process.argv.slice(2), { stdio: 'inherit' });
  process.exit(result.status ?? 0);
} else {
  console.error('Native html-fuse-bin binary not found. Run cargo build --release first.');
  process.exit(1);
}
