#!/usr/bin/env node
import fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

function main() {
  const argv = process.argv.slice(2);
  const cwd = process.cwd();

  // Try bundled binary in bin/ first, then target/release
  const bundledBin = resolve(__dirname, 'css-fuse-bin');
  const targetBin = resolve(__dirname, '../target/release/css-fuse-bin');
  const binPath = fs.existsSync(bundledBin) ? bundledBin : targetBin;

  if (fs.existsSync(binPath)) {
    try {
      execFileSync(binPath, argv, { stdio: 'inherit', cwd });
      return;
    } catch (err) {
      if (err.status !== undefined) {
        process.exit(err.status);
      }
      throw err;
    }
  }

  console.error(
    `Error: css-fuse binary not found. Run 'pnpm build' in packages/css-fuse first.`
  );
  process.exit(1);
}

main();
