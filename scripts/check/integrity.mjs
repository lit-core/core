/**
 * scripts/check/integrity.mjs
 * Repository tamper guard for protected paths, SHA-256 authorization ledger,
 * and anti-suppression checks protecting Biome and GritQL architectural rules.
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ARGS = process.argv.slice(2);
const VERBOSE = ARGS.includes('--verbose');

// 1. Protected paths patterns
const PROTECTED_PATTERNS = [
  /^packages\/internal\/tests\/src\/suites\/server-elements-e2e\.test\.ts$/,
  /^packages\/internal\/tests\/src\/suites\/edge-benchmarks\.test\.ts$/,
  /^packages\/transforms\/dom-paths\/tests\/dsd_soundness_property\.test\.ts$/,
  /^scripts\/check\/.+$/,
  /^scripts\/biome-plugins\/.+$/,
  /^biome\.json$/,
  /^clippy\.toml$/,
  /^AGENTS\.md$/,
  /^\.agents\/skills\/.+$/,
  /^\.agents\/hooks\.json$/,
  /^\.agents\/teamwork\/protected-changes\.md$/,
];

// Canonical authorized hashes for protected golden test suites, lint rules, and configs
const CANONICAL_PROTECTED_HASHES = {
  'packages/internal/tests/src/suites/server-elements-e2e.test.ts': '29f864817bf6aa7844b505670660fe0c733c963152abb2ee97c3150357f794be',
  'packages/internal/tests/src/suites/edge-benchmarks.test.ts': 'ea4e0f6e71afe3ac6919af9cf40b41b6dfa46ba2e3abdc036f7032704a915e64',
  'packages/transforms/dom-paths/tests/dsd_soundness_property.test.ts': '5d8534bc4b529195224e3099fbfcf041aa955281ad251bb06ba6e5f66a1806aa',
  'scripts/check/index.mjs': 'e334835eb6e30e900925f44c2de5ca9bebba02365eb64e5aff78d57994bd6577',
  'scripts/check/affected.mjs': '3260d1cdd41c8c73ee9a1f93c7a3e0acabf3c5bab5405b1324a12a26d41a2e65',
  'scripts/check/native-fresh.mjs': 'ac5fbf6c45f451525a482759d10b92e401b88a9741dd149bc29dbce67264cc5c',
  'AGENTS.md': 'd4fe8930430639b72e481b78dca3b460ee00d7c9c867edcfc648b1951a13fd0d',
  '.agents/skills/transform-principles/SKILL.md': '0d7309c909e244228a485341ee42dd4c23ac180152bb120221fec04bf738cc80',
  'biome.json': '3cdd37278c4a9fbc9babff59799f462d17bf3c4157977fb365fd5be63d8196d8',
  'clippy.toml': 'e25f5cd8175beffdd4c3e80850635ae33fd1eb82f0c8586d12118a421206bc16',
  'scripts/biome-plugins/no-benchmark-literal-html.grit': 'b0186c1eab978a1e5244cc011e86f1955db5580db7660bc886727437a2f27ac3',
  'scripts/biome-plugins/no-benchmark-math-max.grit': 'b069488824c931038f3bf80f0d662346a62aa21ed544cbf7033412febfa17e29',
  'scripts/biome-plugins/no-global-or-proto-mutation.grit': '6cf0dd4139ff161b84b62864711882a08973e0c3116ffe52ac95a2069d514cbd',
  'scripts/biome-plugins/no-handwritten-compiler-parts.grit': '1c080590f30e8602396a2f207ec9fd99caeae5a523eb8d3985d39ebcd71f4907',
  'scripts/biome-plugins/no-html-char-scanner.grit': 'b23fa22e999be4586ed17c5fd2a0239eb456406fb7083442d4c561bdd6c4013b',
  'scripts/biome-plugins/no-library-shims.grit': '2eee1810f8a2cf01abdb3615b0b06c899b2a89c8a9d8ebdb0fb8126d06c6403a',
  'scripts/biome-plugins/no-stack-inspection.grit': '01b12136d834a5d87977391e1e2cdaa0ca30fa79ed1583146ad110a374c87cb1',
  'scripts/biome-plugins/no-unbranded-duck-typing.grit': 'e8f5021dd23767865d05c421cbc667900a0be6b55bfe9ac94b5f8a900c1c8b97',
};

const EXPECTED_LEDGER_NORMALIZED_HASH = '7496368b2364e0decf172287a7f072572823267eda3931a035330683af620083';

const BANNED_SUPPRESSION_COMMENT_PATTERN =
  /biome-ignore(?:-all)?\s+(?:lint\s*:|(?:lint\/)?plugin\b|lint\/(?:style\/(?:noProcessEnv|noRestrictedImports)|correctness\/noProcessGlobal|suspicious\/(?:noGlobalAssign|noProto)|nursery\/noJsRestrictedProperties)\b)/;

export function getNormalizedLedgerHash(content) {
  const normalized = content.replace(/(###\s+Entry\s+5:[^#]*?-\s+\*\*Sha256\*\*:\s*)([a-f0-9]{40,64})/i, '$1<INTEGRITY_SHA>');
  return createHash('sha256').update(normalized).digest('hex');
}

export function isLedgerModified(root = ROOT) {
  const ledgerRel = '.agents/teamwork/protected-changes.md';
  const ledgerFull = path.join(root, ledgerRel);
  if (!fs.existsSync(ledgerFull)) return true;

  const currentContent = fs.readFileSync(ledgerFull, 'utf-8');
  if (getNormalizedLedgerHash(currentContent) !== EXPECTED_LEDGER_NORMALIZED_HASH) {
    return true;
  }

  const authMap = getAuthorizedProtectedChanges(root);
  for (const [canonFile, canonHash] of Object.entries(CANONICAL_PROTECTED_HASHES)) {
    const entry = authMap.get(canonFile);
    if (!entry || entry.expectedSha !== canonHash) {
      return true;
    }
  }

  return false;
}

export function getChangedFiles(root = ROOT) {
  try {
    const diff = execSync('git diff --name-only HEAD', { cwd: root, encoding: 'utf-8' });
    const untracked = execSync('git ls-files --others --exclude-standard', { cwd: root, encoding: 'utf-8' });
    const set = new Set([...diff.split('\n'), ...untracked.split('\n')].map((f) => f.trim()).filter(Boolean));

    const ledgerRel = '.agents/teamwork/protected-changes.md';
    if (isLedgerModified(root)) {
      set.add(ledgerRel);
    } else {
      set.delete(ledgerRel);
    }

    return Array.from(set);
  } catch {
    return [];
  }
}

export function getAuthorizedProtectedChanges(root = ROOT) {
  const ledgerPath = path.join(root, '.agents', 'teamwork', 'protected-changes.md');
  if (!fs.existsSync(ledgerPath)) return new Map();

  const content = fs.readFileSync(ledgerPath, 'utf-8');
  const authorizedFiles = new Map();

  const entries = content.split(/###\s+Entry/i).slice(1);
  for (const entry of entries) {
    const fileMatch = entry.match(/-\s+\*\*File\*\*:\s*`([^`]+)`/);
    const authorMatch = entry.match(/-\s+\*\*(?:Authorized by|Signed-by)\*\*:\s*`?([^\n`]+)`?/i);
    const statusMatch = entry.match(/-\s+\*\*Status\*\*:\s*`?(approved|authorized|valid)`?/i);
    const shaMatch = entry.match(/-\s+\*\*(?:Sha256|SHA-256|Hash|Git-blob)\*\*:\s*`?([a-f0-9]{40,64})`?/i);

    if (fileMatch && authorMatch && statusMatch) {
      const filePath = fileMatch[1].trim();
      const expectedSha = shaMatch ? shaMatch[1].trim().toLowerCase() : null;
      const fullPath = path.join(root, filePath);
      let currentSha = null;
      if (fs.existsSync(fullPath)) {
        currentSha = createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
      }

      authorizedFiles.set(filePath, {
        author: authorMatch[1].trim(),
        status: statusMatch[1].trim(),
        expectedSha,
        currentSha,
        valid: Boolean(expectedSha && currentSha && expectedSha === currentSha),
      });
    }
  }

  return authorizedFiles;
}

// Check 1: Enforce protected paths and SHA-256 ledger bindings
export function checkProtectedPaths(changedFiles, authorizedFiles) {
  const violations = [];
  for (const file of changedFiles) {
    const isProtected = PROTECTED_PATTERNS.some((pattern) => pattern.test(file));
    if (isProtected) {
      const auth = authorizedFiles.get ? authorizedFiles.get(file) : null;
      if (!auth) {
        violations.push({
          type: 'protected-path-unauthorized',
          file,
          message: 'Protected file modified without auditor signature in .agents/teamwork/protected-changes.md',
        });
      } else if (!auth.expectedSha) {
        violations.push({
          type: 'protected-path-unbound',
          file,
          message: 'Protected file authorization in .agents/teamwork/protected-changes.md lacks mandatory Sha256 hash binding',
        });
      } else if (!auth.valid) {
        violations.push({
          type: 'protected-path-hash-mismatch',
          file,
          message: `Protected file content does not match authorized sha256 in .agents/teamwork/protected-changes.md (expected ${auth.expectedSha.slice(0, 8)}..., got ${auth.currentSha ? `${auth.currentSha.slice(0, 8)}...` : 'missing'})`,
        });
      }
    }
  }
  return violations;
}

// Check 2: Prevent inline biome-ignore comments from silencing architectural or GritQL plugin rules
export function checkBannedBiomeSuppressions(root = ROOT) {
  const violations = [];
  const ignoredDirs = new Set(['node_modules', 'dist', 'lib', 'target', 'wasm', 'vendor', 'test_files', '.git', '.agents']);

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.tmp') || ignoredDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        const rel = path.relative(root, full).replace(/\\/g, '/');
        if (rel === 'scripts/check/integrity.mjs') continue;

        const content = fs.readFileSync(full, 'utf-8');
        if (!content.includes('biome-ignore')) continue;

        const comments = content.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) || [];
        for (const comment of comments) {
          if (BANNED_SUPPRESSION_COMMENT_PATTERN.test(comment)) {
            violations.push({
              type: 'banned-biome-suppression',
              file: rel,
              code: comment.trim().split('\n')[0],
              message: 'Inline biome-ignore suppression of architectural or GritQL plugin rules is prohibited.',
            });
            break;
          }
        }
      }
    }
  }

  walk(path.join(root, 'packages'));
  return violations;
}

export async function runIntegrityCheck() {
  const changedFiles = getChangedFiles(ROOT);
  const authorizedFiles = getAuthorizedProtectedChanges(ROOT);

  if (VERBOSE) {
    console.log(`[integrity] Changed files: ${changedFiles.length}`);
    console.log(`[integrity] Authorized protected changes: ${authorizedFiles.size}`);
  }

  const allViolations = [...checkProtectedPaths(changedFiles, authorizedFiles), ...checkBannedBiomeSuppressions(ROOT)];

  if (allViolations.length > 0) {
    console.error(`\n✖ Integrity guard failed with ${allViolations.length} violation(s):\n`);
    for (const v of allViolations) {
      const loc = v.line ? `${v.file}:${v.line}` : v.file;
      console.error(`  • [${v.type}] ${loc}`);
      console.error(`    ${v.message}`);
      if (v.code) console.error(`    Code: ${v.code}`);
    }
    console.error('\nRefer to AGENTS.md and biome.json for architectural integrity invariants.\n');
    process.exit(1);
  }

  console.log('✔ Repository integrity guard passed cleanly.');
}

if (process.argv[1]?.endsWith('integrity.mjs')) {
  runIntegrityCheck().catch((err) => {
    console.error('Fatal integrity guard error:', err);
    process.exit(1);
  });
}
