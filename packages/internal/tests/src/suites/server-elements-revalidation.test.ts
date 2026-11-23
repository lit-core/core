import path from 'node:path';
import { handleActionRequest } from '@lit-core/server-elements/action-endpoint';
import { renderServerElement } from '@lit-core/server-elements/edge';
import { installIsolateGlobals } from '@lit-core/ssr';
import { propsLower, serverElements } from '@lit-core/vite-plugin';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const TEST_SECRET = 'revalidation-e2e-test-secret-32-bytes';
const workerOutDir = path.resolve('./dist/fixtures/server-elements-revalidation');

const FIXTURE_SOURCE = `
import { LitElement, html } from 'lit';
import { state } from 'lit/decorators.js';
import { loader, action, ActionError } from '@lit-core/server-elements';

const runs = (globalThis.__revalidationRuns = { stats: 0, profile: 0, always: 0 });

export class RevalidationProbe extends LitElement {
  @state() count = 0;
  @state() name = 'a';
  @state() stats = '';
  @state() profile = '';
  @state() audit = '';

  @loader({ dependencies: ['count'] })
  async loadStats() {
    runs.stats++;
    this.stats = 'count:' + this.count;
  }

  @loader({ dependencies: ['name'] })
  async loadProfile() {
    runs.profile++;
    this.profile = 'name:' + this.name;
  }

  @loader()
  async loadAudit() {
    runs.always++;
    this.audit = 'seen';
  }

  @action()
  async bump() {
    this.count += 1;
  }

  @action()
  async rename(next: string) {
    this.name = next;
  }

  @action()
  async register(fields: { email: string; age: number }, note: string = 'none') {
    this.audit = fields.email + ':' + note;
  }

  @action()
  async guard() {
    if (this.count < 1) throw new ActionError('FORBIDDEN', 'Bump the counter first.');
  }

  @action({ revalidate: false })
  async quiet() {
    this.count += 10;
  }

  render() {
    return html\`<p>\${this.stats}</p><p>\${this.profile}</p><p>\${this.audit}</p>\`;
  }
}
customElements.define('revalidation-probe', RevalidationProbe);
`;

describe('selective loader revalidation with compiled decorators', () => {
  let actionHashes: Record<string, string>;
  const runs = () => (globalThis as any).__revalidationRuns as { stats: number; profile: number; always: number };

  beforeAll(async () => {
    installIsolateGlobals();
    await build({
      logLevel: 'silent',
      configFile: false,
      build: { write: true, outDir: workerOutDir, minify: false, ssr: true, rollupOptions: { input: 'entry.ts', output: { format: 'es', entryFileNames: 'worker.js' } } },
      plugins: [
        {
          name: 'virtual-entry',
          resolveId: (id) => (id === 'entry.ts' ? '\0entry.ts' : undefined),
          load: (id) => (id === '\0entry.ts' ? FIXTURE_SOURCE : undefined),
        },
        propsLower(),
        serverElements({ target: 'worker' }),
      ],
    });
    await import(path.join(workerOutDir, 'worker.js'));

    const actions = (globalThis as any).customElements.get('revalidation-probe').__lit_actions as Record<string, { name: string }>;
    actionHashes = Object.fromEntries(Object.entries(actions).map(([hash, meta]) => [meta.name, hash]));
  }, 90_000);

  async function runAction(name: string, args: unknown[] = []) {
    const ssr = await renderServerElement('revalidation-probe', {}, { secret: TEST_SECRET });
    Object.assign(runs(), { stats: 0, profile: 0, always: 0 });

    const response = await handleActionRequest(
      new Request(`http://app.local/_lit/a/${actionHashes[name]}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': ssr.token },
        body: JSON.stringify({ tag: 'revalidation-probe', attrs: { 'data-lit-token': ssr.token }, state: ssr.state, sig: ssr.sig, args, seq: 1 }),
      }),
      { env: {}, secret: TEST_SECRET, customElements: (globalThis as any).customElements },
    );
    expect(response.status).toBe(200);
    return { frames: (await response.json()) as Array<Record<string, any>>, runs: { ...runs() } };
  }

  it('emits per-loader dependencies and writes in the compiled descriptors', () => {
    const loaders = (globalThis as any).customElements.get('revalidation-probe').__lit_loaders;
    expect(loaders.loadStats).toEqual({ writes: ['stats'], dependencies: ['count'] });
    expect(loaders.loadProfile).toEqual({ writes: ['profile'], dependencies: ['name'] });
    expect(loaders.loadAudit).toEqual({ writes: ['audit'] });
  });

  it('re-runs only the loader that depends on what the action wrote', async () => {
    const { runs: counts, frames } = await runAction('bump');
    expect(counts).toEqual({ stats: 1, profile: 0, always: 1 });
    expect(frames.find((f) => 's' in f)?.s.stats).toBe('count:1');
  });

  it('selects the other loader for a different write', async () => {
    const { runs: counts } = await runAction('rename', ['b']);
    expect(counts).toEqual({ stats: 0, profile: 1, always: 1 });
  });

  async function callRegister(args: unknown[], accept = 'application/json') {
    const ssr = await renderServerElement('revalidation-probe', {}, { secret: TEST_SECRET });
    return handleActionRequest(
      new Request(`http://app.local/_lit/a/${actionHashes.register}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': ssr.token, Accept: accept },
        body: JSON.stringify({ tag: 'revalidation-probe', attrs: { 'data-lit-token': ssr.token }, state: ssr.state, sig: ssr.sig, args, seq: 1 }),
      }),
      { env: {}, secret: TEST_SECRET, customElements: (globalThis as any).customElements },
    );
  }

  it('accepts an action call that omits a parameter with a default value', async () => {
    const response = await callRegister([{ email: 'a@example.com', age: 30 }]);
    expect(response.status).toBe(200);
  });

  it('still type-checks a defaulted parameter when it is given', async () => {
    const response = await callRegister([{ email: 'a@example.com', age: 30 }, 42]);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR', fields: { note: expect.stringContaining('expected string') } });
  });

  it('names the failing input field when a compiled validator rejects form-shaped input', async () => {
    const response = await callRegister([{ email: 'a@example.com', age: 'old' }]);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(body.fields)).toEqual(['age']);
    expect(body.fields.age).toContain('expected number');
  });

  it('reports a missing property by its field name', async () => {
    const response = await callRegister([{ email: 'a@example.com' }]);
    expect(Object.keys((await response.json()).fields)).toEqual(['age']);
  });

  it('delivers a deliberate ActionError with its code and message', async () => {
    const ssr = await renderServerElement('revalidation-probe', {}, { secret: TEST_SECRET });
    const response = await handleActionRequest(
      new Request(`http://app.local/_lit/a/${actionHashes.guard}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': ssr.token, Accept: 'application/x-ndjson' },
        body: JSON.stringify({ tag: 'revalidation-probe', attrs: { 'data-lit-token': ssr.token }, state: ssr.state, sig: ssr.sig, args: [], seq: 1 }),
      }),
      { env: {}, secret: TEST_SECRET, customElements: (globalThis as any).customElements },
    );
    // A failed action first re-signs the state the browser already holds, then reports the error.
    const frames = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(frames[0]).toHaveProperty('sig');
    expect(frames.filter((frame) => 'e' in frame)).toEqual([{ e: 'Bump the counter first.', code: 'FORBIDDEN' }]);
  });

  it('keeps ActionError and every action body out of the client build', async () => {
    const result = await build({
      logLevel: 'silent',
      configFile: false,
      build: { write: false, minify: false, rollupOptions: { input: 'entry.ts', output: { format: 'es' } } },
      plugins: [
        { name: 'virtual-entry', resolveId: (id) => (id === 'entry.ts' ? '\0entry.ts' : undefined), load: (id) => (id === '\0entry.ts' ? FIXTURE_SOURCE : undefined) },
        propsLower(),
        serverElements({ target: 'client' }),
      ],
    });
    const output = Array.isArray(result) ? result[0].output : (result as any).output;
    const code = output.find((chunk: any) => chunk.type === 'chunk').code as string;
    expect(code).not.toMatch(/\bActionError\b/);
    expect(code).not.toContain('ACTION_ERROR_STATUS');
    expect(code).not.toContain('Bump the counter first');
  });

  it('skips loaders entirely for @action({ revalidate: false })', async () => {
    const { runs: counts, frames } = await runAction('quiet');
    expect(counts).toEqual({ stats: 0, profile: 0, always: 0 });
    expect(frames.find((f) => 's' in f)?.s.count).toBe(10);
  });
});
