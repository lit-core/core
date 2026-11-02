#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TARGET_DIR = path.join(ROOT, 'node_modules', '@lit-core');
const CATEGORIES = ['primitives', 'transforms', 'targets', 'rendering', 'bundlers', 'internal'];

export function ensureWorkspaceSymlinks() {
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  let linkedCount = 0;
  for (const cat of CATEGORIES) {
    const catDir = path.join(ROOT, 'packages', cat);
    if (!fs.existsSync(catDir)) continue;

    for (const pkg of fs.readdirSync(catDir)) {
      const pkgDir = path.join(catDir, pkg);
      const pkgJsonPath = path.join(pkgDir, 'package.json');
      if (!fs.existsSync(pkgJsonPath)) continue;

      let pkgName = pkg;
      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        if (pkgJson.name?.startsWith('@lit-core/')) {
          pkgName = pkgJson.name.replace('@lit-core/', '');
        }
      } catch {}

      const linkPath = path.join(TARGET_DIR, pkgName);
      const relativeTarget = path.join('..', '..', 'packages', cat, pkg);

      let needsLink = true;
      try {
        const stat = fs.lstatSync(linkPath);
        if (stat.isSymbolicLink()) {
          const currentTarget = fs.readlinkSync(linkPath);
          if (currentTarget === relativeTarget) {
            needsLink = false;
          } else {
            fs.unlinkSync(linkPath);
          }
        } else {
          fs.rmSync(linkPath, { recursive: true, force: true });
        }
      } catch {
        // Link does not exist
      }

      if (needsLink) {
        fs.symlinkSync(relativeTarget, linkPath, 'junction');
        linkedCount++;
      }
    }
  }

  return linkedCount;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = ensureWorkspaceSymlinks();
  console.log(`[link-packages] Verified workspace symlinks in node_modules/@lit-core (${count} created or updated).`);
}
