import { describe, expect, it } from 'vitest';
import { handleActionRequest } from '../../src/action-endpoint.js';
import { createSignedStateSnapshot } from '../../src/crypto.js';
import { ServerElement } from '../../src/element.js';
import { loadersAffectedBy } from '../../src/execution.js';

const secret = 'revalidation-test-secret-32-chars!!';
const token = 'token-revalidate';
const hashes = { bump: '0000000000000001', rename: '0000000000000002', quiet: '0000000000000003' };

const runs = { stats: 0, profile: 0, always: 0 };

class Dashboard extends ServerElement {
  static properties = {
    count: { state: true },
    name: { state: true },
    stats: { state: true },
    profile: { state: true },
  };

  count = 0;
  name = 'a';
  stats = '';
  profile = '';

  static __lit_loaders = {
    loadStats: { writes: ['stats'], dependencies: ['count'] },
    loadProfile: { writes: ['profile'], dependencies: ['name'] },
    loadAlways: { writes: [] },
  };

  static __lit_actions = {
    [hashes.bump]: { name: 'bump', writes: ['count'], validate: (a: unknown[]) => a },
    [hashes.rename]: { name: 'rename', writes: ['name'], validate: (a: unknown[]) => a },
    [hashes.quiet]: { name: 'quiet', writes: ['count'], revalidate: false, validate: (a: unknown[]) => a },
  };

  async loadStats() {
    runs.stats++;
    this.stats = `count:${this.count}`;
  }
  async loadProfile() {
    runs.profile++;
    this.profile = `name:${this.name}`;
  }
  async loadAlways() {
    runs.always++;
  }

  async bump() {
    this.count += 1;
  }
  async rename(next: string) {
    this.name = next;
  }
  async quiet() {
    this.count += 10;
  }

  render() {
    return { strings: ['<p>', '</p>'], values: [this.stats] };
  }
}

const customElements = { get: (tag: string) => (tag === 'dash-board' ? Dashboard : undefined) };

async function call(hash: string, args: unknown[] = []) {
  const state = { count: 0, name: 'a', stats: '', profile: '' };
  const { sig } = await createSignedStateSnapshot('dash-board', state, secret, { token });
  const request = new Request(`http://localhost/_lit/a/${hash}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': token },
    body: JSON.stringify({ tag: 'dash-board', attrs: { 'data-lit-token': token }, state, sig, args, seq: 1 }),
  });
  runs.stats = runs.profile = runs.always = 0;
  const response = await handleActionRequest(request, { env: {}, secret, customElements });
  expect(response.status).toBe(200);
  return (await response.json()) as Array<Record<string, unknown>>;
}

describe('loader revalidation after actions', () => {
  it('re-runs only loaders that depend on a written property, plus loaders with no declared dependencies', async () => {
    const frames = await call(hashes.bump);

    expect(runs).toEqual({ stats: 1, profile: 0, always: 1 });
    const snapshot = frames.find((f) => 's' in f) as { s: Record<string, unknown> };
    expect(snapshot.s.stats).toBe('count:1');
    expect(snapshot.s.profile).toBe('');
  });

  it('selects a different loader for a different action', async () => {
    await call(hashes.rename, ['b']);
    expect(runs).toEqual({ stats: 0, profile: 1, always: 1 });
  });

  it('skips every loader when the action sets revalidate: false', async () => {
    const frames = await call(hashes.quiet);

    expect(runs).toEqual({ stats: 0, profile: 0, always: 0 });
    const snapshot = frames.find((f) => 's' in f) as { s: Record<string, unknown> };
    expect(snapshot.s.count).toBe(10);
  });
});

describe('loadersAffectedBy', () => {
  it('treats a loader without dependencies as always affected', () => {
    expect(loadersAffectedBy(Dashboard, new Dashboard(), new Set())).toEqual(['loadAlways']);
  });

  it('selects loaders whose dependencies intersect the written set', () => {
    expect(loadersAffectedBy(Dashboard, new Dashboard(), new Set(['name'])).sort()).toEqual(['loadAlways', 'loadProfile']);
    expect(loadersAffectedBy(Dashboard, new Dashboard(), new Set(['name', 'count'])).sort()).toEqual(['loadAlways', 'loadProfile', 'loadStats']);
  });
});
