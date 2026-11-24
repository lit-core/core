/**
 * What the default `resumable: true` costs a plain render.
 *
 * `@lit-core/ssr` emits a `data-lit-state` snapshot of each component's reactive properties so the
 * component can resume in the browser without re-rendering. `@lit-labs/ssr` emits nothing like it, so a
 * comparison of the two in their default configurations is not a comparison of identical work. This
 * measures one Spectrum button with the snapshot on and off, alternating so drift cancels out.
 *
 * Usage: node packages/internal/benchmarks/src/features/plain-ssr-resumable-cost.js
 */
import { collectResult, installIsolateGlobals, render } from '@lit-core/ssr';
import { html } from 'lit';

installIsolateGlobals();
await import('@spectrum-web-components/button/sp-button.js');

const WARMUP = 3000;
const SAMPLES = 20000;
const ROUNDS = 3;

/** @param {boolean} resumable */
const renderOnce = (resumable) => collectResult(render(html`<sp-button variant="accent">Save</sp-button>`, { customElements: globalThis.customElements, resumable }));

/**
 * @param {boolean} resumable
 * @returns {Promise<{ bytes: number; medianMs: number }>}
 */
async function measure(resumable) {
  const first = await renderOnce(resumable);
  for (let index = 0; index < WARMUP; index++) await renderOnce(resumable);
  /** @type {number[]} */
  const samples = [];
  for (let index = 0; index < SAMPLES; index++) {
    const start = performance.now();
    await renderOnce(resumable);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { bytes: first.length, medianMs: samples[samples.length >> 1] ?? Number.NaN };
}

/** @type {Record<'on' | 'off', { bytes: number; medianMs: number }[]>} */
const results = { on: [], off: [] };
for (let round = 0; round < ROUNDS; round++) {
  results.on.push(await measure(true));
  results.off.push(await measure(false));
}

/** @param {{ medianMs: number }[]} runs */
const medianOf = (runs) => runs.map((run) => run.medianMs).sort((a, b) => a - b)[runs.length >> 1] ?? Number.NaN;
const on = medianOf(results.on);
const off = medianOf(results.off);
console.log(`One Spectrum button, ${ROUNDS} alternating rounds of ${SAMPLES} samples (Node.js ${process.version})`);
console.log(`resumable: true   ${results.on[0]?.bytes} bytes  median ${on.toFixed(4)} ms`);
console.log(`resumable: false  ${results.off[0]?.bytes} bytes  median ${off.toFixed(4)} ms`);
console.log(
  `the snapshot costs ${((on - off) * 1000).toFixed(1)} microseconds (${(((on - off) / on) * 100).toFixed(0)}% of the default render) and ${(results.on[0]?.bytes ?? 0) - (results.off[0]?.bytes ?? 0)} bytes`,
);
process.exit(0);
