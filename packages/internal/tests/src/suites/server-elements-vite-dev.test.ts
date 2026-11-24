import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { transformLitProps } from '@lit-core/props-lower';
import { createSignedStateSnapshot } from '@lit-core/server-elements/crypto';
import { splitServerElement } from '@lit-core/server-split';
import { propsLower, serverElements } from '@lit-core/vite-plugin';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve('./dist/fixtures/vite-dev');
const SECRET = 'dev-server-test-secret-32-characters!';

const COUNTER = `
import { html } from 'lit';
import { state } from 'lit/decorators.js';
import { action, loader, ServerElement } from '@lit-core/server-elements';

export class DevCounter extends ServerElement {
  @state() count = 0;

  @loader()
  async load() {
    this.count = this.count || 0;
  }

  @action()
  async bump(by: number) {
    this.count += by;
  }

  render() {
    return html\`<p class="count">\${this.count}</p>\`;
  }
}
customElements.define('dev-counter', DevCounter);
`;

describe('the Vite dev server answers actions, over real HTTP', () => {
  let server: ViteDevServer;
  let origin: string;
  /** What the compiler assigns the element, worked out without loading it into the server. */
  let expected: { bumpHash: string; buildId: string };

  beforeAll(async () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/counter.ts'), COUNTER);
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><body></body></html>');

    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      server: { host: '127.0.0.1', port: 0, hmr: false, fs: { strict: false } },
      plugins: [propsLower(), serverElements({ secret: SECRET })],
    });
    await server.listen();
    const address = server.httpServer?.address() as AddressInfo | null | undefined;
    if (!address) throw new Error('The dev server did not start listening');
    origin = `http://127.0.0.1:${address.port}`;

    const compiled = splitServerElement(transformLitProps(COUNTER, { filename: 'counter.ts' }).code, { filename: 'counter.ts' });
    expected = { bumpHash: compiled.actions.find((action) => action.name === 'bump')?.hash ?? '', buildId: compiled.buildId ?? '' };
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  const post = async (hash: string, body: object) => {
    const response = await fetch(`${origin}/_lit/a/${hash}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', 'X-Lit-Action-Token': 'dev-token' },
      body: JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  };

  it('compiles the element with a source-derived build id and a hash for each action', () => {
    expect(expected.bumpHash).toMatch(/^[0-9a-f]{16}$/);
    expect(expected.buildId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('runs an action on a server that has not loaded the element yet, by finding it in the project: the patch and a new snapshot stream back', async () => {
    const state = { count: 1 };
    const { sig } = await createSignedStateSnapshot('dev-counter', state, SECRET, { token: 'dev-token', buildId: expected.buildId, seq: 0 });
    const { status, text } = await post(expected.bumpHash, {
      tag: 'dev-counter',
      attrs: { 'data-lit-token': 'dev-token', 'data-lit-build-id': expected.buildId },
      state,
      sig,
      args: [4],
      seq: 1,
      snapshotSeq: 0,
    });

    expect(status).toBe(200);
    const frames = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(frames.some((frame) => frame.v === 5)).toBe(true);
    expect((frames.find((frame) => 's' in frame) as { s: { count: number } }).s.count).toBe(5);
  });

  it('refuses a snapshot signed with another secret', async () => {
    const state = { count: 1 };
    const { sig } = await createSignedStateSnapshot('dev-counter', state, 'some-other-secret-with-32-characters!', { token: 'dev-token', buildId: expected.buildId, seq: 0 });
    const { status } = await post(expected.bumpHash, {
      tag: 'dev-counter',
      attrs: { 'data-lit-token': 'dev-token', 'data-lit-build-id': expected.buildId },
      state,
      sig,
      args: [4],
      seq: 1,
      snapshotSeq: 0,
    });
    expect(status).toBe(403);
  });

  it('leaves other requests to the rest of the dev server', async () => {
    const response = await fetch(`${origin}/not-an-action`, { method: 'POST' });
    expect(response.status).not.toBe(200);
    expect(response.headers.get('content-type') ?? '').not.toContain('application/x-ndjson');
  });
});
