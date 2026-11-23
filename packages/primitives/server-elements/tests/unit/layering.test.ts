import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('../../src/', import.meta.url));

/** Runtime (non-type) module specifiers a source file loads. `import type` and `export type` are erased and ignored. */
function runtimeImports(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  for (const match of text.matchAll(pattern)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

interface Closure {
  files: Set<string>;
  external: Set<string>;
}

/** Every source file an entry point loads at runtime, and every package it pulls in. */
function closureOf(entry: string): Closure {
  const files = new Set<string>();
  const external = new Set<string>();
  const queue = [path.join(src, entry)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of runtimeImports(file)) {
      if (specifier.startsWith('.')) {
        queue.push(path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts')));
      } else {
        external.add(specifier);
      }
    }
  }
  return { files, external };
}

const relative = (files: Set<string>) => [...files].map((f) => path.relative(src, f)).sort();

describe('module layering', () => {
  describe('the browser entry points never reach server code', () => {
    for (const entry of ['client.ts', 'executor.ts']) {
      it(`${entry} loads no package and no server module`, () => {
        const { files, external } = closureOf(entry);
        expect([...external]).toEqual([]);

        const reached = relative(files);
        const serverOnly = ['crypto.ts', 'action-error.ts', 'state-sealer.ts', 'replay-guard.ts', 'secret.ts', 'cookies.ts', 'execution.ts', 'element.ts'];
        const serverDirs = ['endpoint/', 'render/', 'patches/', 'decorators/'];
        expect(reached.filter((f) => serverOnly.includes(f) || serverDirs.some((d) => f.startsWith(d)))).toEqual([]);
      });
    }

    it('the whole browser runtime stays small', () => {
      const bytes = [...closureOf('client.ts').files].reduce((total, file) => total + fs.statSync(file).size, 0);
      // Source bytes, before minification: a guard against accidentally pulling in a large module.
      expect(bytes).toBeLessThan(50_000);
    });
  });

  it('the authoring entry point (index.ts) loads neither runtime', () => {
    const { files } = closureOf('index.ts');
    const reached = relative(files);
    expect(reached.filter((f) => f.startsWith('endpoint/') || f.startsWith('render/') || f.startsWith('client-runtime/') || f.startsWith('patches/'))).toEqual([]);
  });

  it('the wire protocol modules depend on nothing', () => {
    for (const file of ['protocol.ts', 'form-fields.ts']) {
      const specifiers = runtimeImports(path.join(src, file));
      expect(specifiers.filter((s) => !['./protocol.js'].includes(s))).toEqual([]);
    }
  });

  it('types.ts is erased entirely: it has no runtime imports', () => {
    expect(runtimeImports(path.join(src, 'types.ts'))).toEqual([]);
  });
});
