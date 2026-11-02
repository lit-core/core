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

  // Ensure @lit-labs/* and @types/* symlinks in root node_modules point to valid .pnpm targets
  const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm');
  const pnpmNodeModules = path.join(pnpmDir, 'node_modules');
  for (const scope of ['@lit-labs', '@types']) {
    const pnpmScopeDir = path.join(pnpmNodeModules, scope);
    if (!fs.existsSync(pnpmScopeDir)) continue;
    const targetScopeDir = path.join(ROOT, 'node_modules', scope);
    if (!fs.existsSync(targetScopeDir)) {
      fs.mkdirSync(targetScopeDir, { recursive: true });
    }
    for (const entry of fs.readdirSync(pnpmScopeDir)) {
      const linkPath = path.join(targetScopeDir, entry);
      const relativeTarget = path.join('..', '.pnpm', 'node_modules', scope, entry);
      let valid = false;
      try {
        fs.statSync(linkPath);
        valid = true;
      } catch {
        try {
          fs.unlinkSync(linkPath);
        } catch {}
      }
      if (!valid) {
        fs.symlinkSync(relativeTarget, linkPath, 'junction');
        linkedCount++;
      }
    }
  }

  // Ensure root node_modules/@types/node is valid and no package has a symlinked node_modules/@types directory
  if (fs.existsSync(pnpmDir)) {
    const typesNodeEntry = fs.readdirSync(pnpmDir).find((e) => e.startsWith('@types+node@'));
    if (typesNodeEntry) {
      const rootTypesDir = path.join(ROOT, 'node_modules', '@types');
      if (!fs.existsSync(rootTypesDir)) {
        fs.mkdirSync(rootTypesDir, { recursive: true });
      }
      const rootTypesNodeLink = path.join(rootTypesDir, 'node');
      const rootTypesNodeTarget = path.join('..', '.pnpm', typesNodeEntry, 'node_modules', '@types', 'node');
      let rootValid = false;
      try {
        fs.statSync(rootTypesNodeLink);
        rootValid = true;
      } catch {
        try {
          fs.unlinkSync(rootTypesNodeLink);
        } catch {}
      }
      if (!rootValid) {
        fs.symlinkSync(rootTypesNodeTarget, rootTypesNodeLink, 'junction');
        linkedCount++;
      }

      for (const cat of CATEGORIES) {
        const catDir = path.join(ROOT, 'packages', cat);
        if (!fs.existsSync(catDir)) continue;
        for (const pkg of fs.readdirSync(catDir)) {
          const pkgTypesDir = path.join(catDir, pkg, 'node_modules', '@types');
          try {
            const st = fs.lstatSync(pkgTypesDir);
            if (st.isSymbolicLink()) {
              fs.unlinkSync(pkgTypesDir);
              fs.mkdirSync(pkgTypesDir, { recursive: true });
              fs.symlinkSync(path.join('..', '..', '..', '..', '..', 'node_modules', '.pnpm', typesNodeEntry, 'node_modules', '@types', 'node'), path.join(pkgTypesDir, 'node'), 'junction');
              linkedCount++;
            }
          } catch {}
        }
      }
    }
  }

  return linkedCount;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = ensureWorkspaceSymlinks();
  console.log(`[link-packages] Verified workspace symlinks in node_modules/@lit-core (${count} created or updated).`);
}
