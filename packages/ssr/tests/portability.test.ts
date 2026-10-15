import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const ssrSrc = resolve(here, '../src');
const resumableServerSrc = resolve(here, '../../resumable/src/server');

const NODE_ONLY_SPECIFIER = /^(node:|fs$|path$|os$|module$|child_process$|worker_threads$|vm$|url$|crypto$|stream$|http$|net$)/;
const NATIVE_ADDON_PACKAGES = ['@lit-core/dom-paths', '@lit-core/html-aot', '@lit-core/css-fuse', '@napi-rs/cli'];

function readImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[1] ?? match[2] ?? match[3]);
  }
  return specifiers;
}

function resolveRuntimeFile(fromFile: string, specifier: string): string | null {
  if (specifier === '@lit-core/resumable/server') {
    return resolve(resumableServerSrc, 'index.ts');
  }
  if (!specifier.startsWith('.')) {
    return null;
  }
  const base = resolve(dirname(fromFile), specifier).replace(/\.js$/, '');
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function collectRuntimeGraph(entry: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (graph.has(file)) {
      continue;
    }
    const specifiers = readImportSpecifiers(readFileSync(file, 'utf8'));
    graph.set(file, specifiers);
    for (const specifier of specifiers) {
      const next = resolveRuntimeFile(file, specifier);
      if (next) {
        queue.push(next);
      }
    }
  }
  return graph;
}

describe('@lit-core/ssr runtime entry portability', () => {
  it('reaches no Node builtins or native addon packages from the runtime entry graph', () => {
    const graph = collectRuntimeGraph(resolve(ssrSrc, 'index.ts'));
    expect(graph.size).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const [file, specifiers] of graph) {
      for (const specifier of specifiers) {
        if (NODE_ONLY_SPECIFIER.test(specifier) || NATIVE_ADDON_PACKAGES.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`))) {
          offenders.push(`${file.replace(`${here}/../..`, '')} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('renders without touching node:fs, node:module, node:os or node:path', async () => {
    for (const id of ['node:fs', 'node:module', 'node:os', 'node:path']) {
      vi.doMock(id, () => {
        throw new Error(`runtime entry must not import ${id}`);
      });
    }
    vi.resetModules();

    const { renderToString } = await import('../src/index.js');
    const html = await renderToString({ strings: ['<p>', '</p>'], values: ['ok'] } as any);
    expect(html).toBe('<p>ok</p>');

    vi.doUnmock('node:fs');
    vi.doUnmock('node:module');
    vi.doUnmock('node:os');
    vi.doUnmock('node:path');
  });
});
