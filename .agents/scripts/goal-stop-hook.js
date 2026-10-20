#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentsDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(agentsDir, '..');
const goalFile = path.resolve(agentsDir, '.goal_active.json');
const biomeBin = path.join(repoRoot, 'node_modules', '.bin', 'biome');

// Read stdin payload from Antigravity lifecycle hook
let inputData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  try {
    let payload = {};
    if (inputData.trim()) {
      payload = JSON.parse(inputData);
    }

    // Do not block non-model terminations (e.g., max_steps_exceeded or error)
    if (payload.terminationReason && payload.terminationReason !== 'model_stop') {
      outputResult({ decision: 'allow' });
      return;
    }

    // Always auto-format and apply safe lint/import fixes first
    try {
      execSync('node .agents/scripts/auto-format.js', {
        cwd: repoRoot,
        stdio: 'pipe',
        timeout: 10000,
      });
    } catch {
      // Continue to verification
    }

    // If no active goal file, still enforce the fast (<1s) repo-wide lint & format gate
    if (!fs.existsSync(goalFile)) {
      const executionNum = payload.executionNum || 1;
      if (executionNum <= 3 && fs.existsSync(biomeBin)) {
        try {
          execSync(`${JSON.stringify(biomeBin)} check --write .`, {
            cwd: repoRoot,
            stdio: 'pipe',
            timeout: 10000,
          });
        } catch (lintErr) {
          const errorOutput = (lintErr.stdout?.toString() || lintErr.stderr?.toString() || lintErr.message).slice(-1500).trim();
          outputResult({
            decision: 'continue',
            reason: `Fast pre-stop lint check (\`biome check\`) failed:\n${errorOutput}\n\nPlease fix the remaining lint or syntax errors before finishing.`,
          });
          return;
        }
      }

      outputResult({ decision: 'allow' });
      return;
    }

    let goalState;
    try {
      goalState = JSON.parse(fs.readFileSync(goalFile, 'utf8'));
    } catch {
      // Corrupt file, remove and allow
      fs.unlinkSync(goalFile);
      outputResult({ decision: 'allow' });
      return;
    }

    // Increment cycle count
    goalState.cycleCount = (goalState.cycleCount || 0) + 1;
    const maxCycles = goalState.maxCycles || 10;

    if (goalState.cycleCount > maxCycles) {
      fs.unlinkSync(goalFile);
      outputResult({
        decision: 'allow',
        reason: `Maximum autonomous cycles (${maxCycles}) reached for goal "${goalState.goal}". Halting for user review.`,
      });
      return;
    }

    // Persist updated cycle count
    fs.writeFileSync(goalFile, JSON.stringify(goalState, null, 2), 'utf8');

    // Run CI verification command (defaulting to pnpm run check)
    const verifyCommand = goalState.verifyCommand || 'pnpm run check';
    try {
      execSync(verifyCommand, {
        cwd: repoRoot,
        stdio: 'pipe',
        timeout: 45000,
        env: { ...process.env, CI: 'true' },
      });

      // Verification passed! Clean up goal file and allow stop
      fs.unlinkSync(goalFile);
      outputResult({
        decision: 'allow',
        reason: `CI verification passed successfully for goal: "${goalState.goal}". Goal complete.`,
      });
    } catch (cmdError) {
      // Verification failed! Block the model from stopping and force continuation
      const errorOutput = (cmdError.stdout?.toString() || cmdError.stderr?.toString() || cmdError.message).slice(-1500).trim();

      outputResult({
        decision: 'continue',
        reason: `[Autonomous goal in progress: "${goalState.goal}" | Cycle ${goalState.cycleCount}/${maxCycles}]\nCI verification \`${verifyCommand}\` failed:\n${errorOutput}\n\nYou must fix the lint/test/compilation errors and re-verify before stopping.`,
      });
    }
  } catch (_err) {
    // Fail-safe: allow stop on unexpected script error
    outputResult({ decision: 'allow' });
  }
});

function outputResult(result) {
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

