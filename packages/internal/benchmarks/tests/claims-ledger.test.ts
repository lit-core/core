import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildTable, renderClaims } from '../src/render-claims-table.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const claims = fs.readFileSync(path.join(root, 'docs/claims.md'), 'utf-8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'packages/internal/benchmarks/results/edge-head-to-head.json'), 'utf-8'));

describe('claims ledger is generated from the benchmark artifact', () => {
  it('matches the committed benchmark data exactly, with no tolerances', () => {
    expect(renderClaims(claims, data)).toBe(claims);
  });

  it('turns any single-digit edit of the ledger into a failure', () => {
    const table = buildTable(data);
    const insideCode = (index: number) => (table.slice(0, index).match(/`/g) ?? []).length % 2 === 1;
    const digitPositions = [...table.matchAll(/\d/g)].map((m) => m.index as number).filter((i) => !insideCode(i));
    expect(digitPositions.length).toBeGreaterThan(40);
    for (const index of digitPositions) {
      const digit = Number(table[index]);
      const mutatedTable = `${table.slice(0, index)}${(digit + 1) % 10}${table.slice(index + 1)}`;
      const mutatedClaims = claims.replace(table, mutatedTable);
      expect(mutatedClaims).not.toBe(claims);
      expect(renderClaims(mutatedClaims, data)).not.toBe(mutatedClaims);
    }
  });

  it('reports Cloudflare workerd and Node.js CPU measurements separately with explicit environment labels', () => {
    expect(data.suites.every((s: any) => s.metrics.workerdCpuEnvironment.startsWith('Cloudflare workerd'))).toBe(true);
    expect(data.suites.every((s: any) => s.metrics.nodeCpuEnvironment.startsWith('Node.js'))).toBe(true);
    const table = buildTable(data);
    expect(table).toContain('Cloudflare workerd');
    expect(table).toContain('Node.js');
  });
});
