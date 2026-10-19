import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const ALL_CRATES = [
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
  'ssr',
  'morph-to-react',
];

const PACKAGE_CATEGORIES = ['transforms', 'targets', 'rendering', 'bundlers', 'primitives', 'internal'];

/**
 * Locate the directory of a workspace package by short name.
 */
export function findPackageDir(root, pkgName) {
  for (const cat of PACKAGE_CATEGORIES) {
    const candidate = path.join(root, 'packages', cat, pkgName);
    if (fs.existsSync(path.join(candidate, 'package.json')) || fs.existsSync(path.join(candidate, 'Cargo.toml'))) {
      return candidate;
    }
  }
  const legacyCandidate = path.join(root, 'packages', pkgName);
  if (fs.existsSync(legacyCandidate)) {
    return legacyCandidate;
  }
  return null;
}

/**
 * List all workspace package short names and their directories.
 */
export function getAllWorkspacePackages(root = process.cwd()) {
  const result = new Map();
  for (const cat of PACKAGE_CATEGORIES) {
    const catDir = path.join(root, 'packages', cat);
    if (!fs.existsSync(catDir)) continue;
    for (const p of fs.readdirSync(catDir)) {
      const pkgDir = path.join(catDir, p);
      if (fs.existsSync(path.join(pkgDir, 'package.json'))) {
        result.set(p, pkgDir);
      }
    }
  }
  return result;
}

/**
 * Get list of modified/untracked files relative to HEAD.
 */
export function getChangedFiles(root = process.cwd()) {
  try {
    const diff = execSync('git diff --name-only HEAD', { cwd: root, encoding: 'utf-8' });
    const untracked = execSync('git ls-files --others --exclude-standard', { cwd: root, encoding: 'utf-8' });
    const set = new Set([...diff.split('\n'), ...untracked.split('\n')].map((f) => f.trim()).filter(Boolean));
    return Array.from(set);
  } catch {
    return [];
  }
}

/**
 * Map list of files to affected packages and crates.
 */
export function getAffected(options = {}) {
  const root = options.root || process.cwd();
  const changedFiles = options.files || getChangedFiles(root);

  // If no files changed, or if root configuration changed, determine scope
  const rootConfigFiles = ['pnpm-lock.yaml', 'package.json', 'turbo.json', 'tsconfig.base.json', 'Cargo.lock', 'Cargo.toml'];
  const touchesRootConfig = changedFiles.some((f) => rootConfigFiles.includes(f));

  const workspaceMap = getAllWorkspacePackages(root);

  if (changedFiles.length === 0 || touchesRootConfig || options.all) {
    return {
      changedFiles,
      affectedCrates: ALL_CRATES,
      affectedPackages: Array.from(workspaceMap.keys()),
      affectsAll: true,
    };
  }

  const affectedCrates = new Set();
  const affectedPackages = new Set();

  for (const file of changedFiles) {
    const parts = file.split('/');
    let pkgName = null;
    if (parts[0] === 'packages' && parts[1]) {
      pkgName = PACKAGE_CATEGORIES.includes(parts[1]) ? parts[2] : parts[1];
    }

    if (pkgName) {
      affectedPackages.add(pkgName);
      if (ALL_CRATES.includes(pkgName)) {
        if (file.endsWith('.rs') || file.endsWith('Cargo.toml') || file.endsWith('build.rs')) {
          affectedCrates.add(pkgName);
        }
      }
    } else if (parts[0] === 'crates' && parts[1]) {
      const crateName = parts[1];
      if (file.endsWith('.rs') || file.endsWith('Cargo.toml') || file.endsWith('build.rs')) {
        affectedCrates.add(crateName);
        if (crateName === 'lit-analysis') {
          affectedCrates.add('morph-to-react');
          affectedPackages.add('morph-to-react');
        }
      }
    }
  }

  // Include direct dependents for JS packages
  const packageManifests = new Map();
  for (const [p, pkgDir] of workspaceMap.entries()) {
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        packageManifests.set(p, JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')));
      } catch {}
    }
  }

  const initialAffected = Array.from(affectedPackages);
  for (const affected of initialAffected) {
    const fullPkgName = `@lit-core/${affected}`;
    for (const [pkgDir, manifest] of packageManifests.entries()) {
      const deps = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
      };
      if (deps[fullPkgName]) {
        affectedPackages.add(pkgDir);
      }
    }
  }

  return {
    changedFiles,
    affectedCrates: Array.from(affectedCrates),
    affectedPackages: Array.from(affectedPackages),
    affectsAll: false,
  };
}
