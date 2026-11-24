/**
 * Repeats the plain SSR head-to-head against `@lit-labs/ssr` and reports how stable the result is.
 *
 * One run of `edge-head-to-head.js` is 50 warm iterations per workload, which is not enough to call a
 * 10% difference. This runs the same measurement several times and, for each workload and runtime,
 * reports the median of the per-run medians, the range, and in how many runs `@lit-core/ssr` was at
 * least as fast. It writes nothing to the results folder.
 *
 * Each run is a fresh process. Usage: node packages/internal/benchmarks/src/features/plain-ssr-repeated.js [runs]
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { measurePlainSsrHeadToHead } from './edge-head-to-head.js';

const SELF = fileURLToPath(import.meta.url);
const ONCE = '--once';

/** @param {number[]} values */
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// The measurement memoizes its work inside a process, so every run has to be a fresh one.
if (process.argv.includes(ONCE)) {
  process.stdout.write(`\n@@RESULT@@${JSON.stringify(await measurePlainSsrHeadToHead())}\n`);
  process.exit(0);
}

const RUNS = Number.parseInt(process.argv[2] ?? '6', 10);
const runs = [];
for (let index = 0; index < RUNS; index++) {
  const child = spawnSync(process.execPath, [SELF, ONCE], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  const payload = child.stdout.split('@@RESULT@@')[1];
  if (!payload) throw new Error(`Run ${index + 1} produced no result:\n${child.stderr}`);
  runs.push(JSON.parse(payload));
}

console.log(`Plain SSR against @lit-labs/ssr, ${RUNS} runs of 50 warm iterations (median of per-run medians, ms; range in brackets)\n`);
console.log('workload       runtime  @lit-core/ssr                 @lit-labs/ssr                 core/labs  core at least as fast');

for (const { id } of runs[0].workloads) {
  for (const runtime of ['workerd', 'node']) {
    const key = /** @type {'workerdCpuMedianMs' | 'nodeCpuMedianMs'} */ (`${runtime}CpuMedianMs`);
    /**
     * @param {Awaited<ReturnType<typeof measurePlainSsrHeadToHead>>} run
     * @param {'litCore' | 'litLabs'} side
     */
    const pick = (run, side) => run.workloads.find((workload) => workload.id === id)?.[side]?.[key] ?? Number.NaN;
    const core = runs.map((run) => pick(run, 'litCore'));
    const labs = runs.map((run) => pick(run, 'litLabs'));
    const wins = core.filter((value, run) => value <= labs[run]).length;
    /** @param {number[]} values */
    const cell = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return `${median(values).toFixed(4)} [${sorted[0].toFixed(4)}-${(sorted.at(-1) ?? Number.NaN).toFixed(4)}]`.padEnd(29);
    };
    console.log(`${id.padEnd(14)} ${runtime.padEnd(8)} ${cell(core)} ${cell(labs)} ${(median(core) / median(labs)).toFixed(2).padStart(9)}  ${wins}/${RUNS}`);
  }
}

process.exit(0);
