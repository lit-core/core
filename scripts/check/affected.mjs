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
  'resumable',
];

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
  const rootConfigFiles = ['pnpm-lock.yaml', 'package.json', 'turbo.json', 'tsconfig.base.json', 'Cargo.lock'];
  const touchesRootConfig = changedFiles.some((f) => rootConfigFiles.includes(f));

  if (changedFiles.length === 0 || touchesRootConfig || options.all) {
    const allPackages = fs.readdirSync(path.join(root, 'packages')).filter((p) => {
      return fs.existsSync(path.join(root, 'packages', p, 'package.json'));
    });
    return {
      changedFiles,
      affectedCrates: ALL_CRATES,
      affectedPackages: allPackages,
      affectsAll: true,
    };
  }

  const affectedCrates = new Set();
  const affectedPackages = new Set();

  for (const file of changedFiles) {
    const parts = file.split('/');
    if (parts[0] === 'packages' && parts[1]) {
      const pkgName = parts[1];
      affectedPackages.add(pkgName);

      if (ALL_CRATES.includes(pkgName)) {
        if (file.endsWith('.rs') || file.endsWith('Cargo.toml') || file.endsWith('build.rs')) {
          affectedCrates.add(pkgName);
        }
      }
    }
  }

  // Include direct dependents for JS packages
  const packagesDir = path.join(root, 'packages');
  const packageManifests = new Map();
  for (const p of fs.readdirSync(packagesDir)) {
    const pkgJsonPath = path.join(packagesDir, p, 'package.json');
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
