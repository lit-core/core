import { type CustomElementLookup, type RenderOptions, renderToString } from '@lit-core/ssr';
import { createSignedStateSnapshot, DEFAULT_STATE_TTL_MS } from '../crypto.js';
import { canonicalEqual, cloneStateValue, collectDeclaredProperties, type DeclaredProperties, resolveServerBuildId } from '../endpoint/element-state.js';
import type { OpenedActionRequest, StateSealer } from '../state-sealer.js';
import type { KeyedPartState, PatchFrame, StateSnapshotPatchFrame } from '../types.js';
import { diffKeyedItems, isKeyedList, isRepeatDirective, isTemplateValue } from './keyed-diff.js';
import { extractTemplateId } from './template-id.js';

const INTERNAL_INSTANCE_KEYS = new Set(['renderOptions', 'hasUpdated', 'isUpdatePending', 'updateComplete', 'tagName', 'shadowRoot', 'isConnected']);

type PartDeps = Record<number, string[]> | string[][];

/** What the browser currently holds, as far as the server can tell. Patches are computed as the difference from it. */
export interface PatchBaseline {
  /** Last value the client holds for a reactive property. */
  value(prop: string): unknown;
  /** Reactive properties the client has reported on. */
  props(): Iterable<string>;
  /** Keys and item fingerprints the client acknowledged for a keyed list part. */
  keyedState(part: number): KeyedPartState | undefined;
}

/** Baseline for the first patch of an action: the state the client echoed, then the pre-action snapshot for the rest. */
export function requestBaseline(body: OpenedActionRequest, preActionSnapshot?: ReadonlyMap<string, unknown>): PatchBaseline {
  return {
    value(prop) {
      if (body.state && Object.hasOwn(body.state, prop)) return body.state[prop];
      if (body.attrs && Object.hasOwn(body.attrs, prop)) return body.attrs[prop];
      return preActionSnapshot?.get(prop);
    },
    props: () => Object.keys(body.state || {}).filter((key) => !key.startsWith('__lit')),
    keyedState: (part) => readKeyedState(body.state, part),
  };
}

/** Baseline for a follow-up patch: the state a previous patch of the same response already delivered. Copies the state so later in-place mutation cannot alias it. */
export function stateBaseline(state: Record<string, unknown>): PatchBaseline {
  const frozen = cloneStateValue(state);
  return {
    value: (prop) => frozen[prop],
    props: () => Object.keys(frozen).filter((key) => !key.startsWith('__lit')),
    keyedState: (part) => readKeyedState(frozen, part),
  };
}

export interface PartPatchInput {
  /** Element instance at the point patches are computed. */
  instance: any;
  ElementClass: any;
  baseline: PatchBaseline;
  /** Properties the action statically declares it writes. */
  actionWrites?: readonly string[];
  customElements?: { get(tagName: string): unknown };
}

export interface PartPatchResult {
  /** One frame per binding part whose dependencies changed. */
  frames: PatchFrame[];
  /** Every reactive value and keyed-list record as of this patch; what the next snapshot signs. */
  state: Record<string, unknown>;
}

/** Fingerprint for fragments that have no template of their own, such as an array of templates. */
const UNKEYED_ITERABLE_ID = '0000000000000000';

/** Arrays and other iterables (but never strings) are rendered by Lit as a sequence of parts. */
function isRenderableIterable(value: unknown): boolean {
  return value !== null && typeof value === 'object' && typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}

function isSymbolNamed(value: unknown, description: string): boolean {
  return typeof value === 'symbol' && value.description === description;
}

/** Reads the acknowledged keys and fingerprints of a keyed list part out of client state. */
function readKeyedState(state: Record<string, unknown> | undefined, part: number): KeyedPartState | undefined {
  const keys = (state?.__lit_keys as Record<number, KeyedPartState['keys']> | undefined)?.[part];
  const fingerprints = (state?.__lit_item_hashes as Record<number, KeyedPartState['fingerprints']> | undefined)?.[part];
  return keys || fingerprints ? { keys: keys ?? [], fingerprints: fingerprints ?? {} } : undefined;
}

function writeKeyedState(postState: Record<string, unknown>, part: number, next: KeyedPartState): void {
  postState.__lit_keys = { ...(postState.__lit_keys as object), [part]: next.keys };
  postState.__lit_item_hashes = { ...(postState.__lit_item_hashes as object), [part]: next.fingerprints };
}

/** Instance fields that are neither reactive properties nor Lit internals, i.e. fields `willUpdate` may derive. */
function isTrackableDerivedKey(key: string, declared: DeclaredProperties): boolean {
  return !key.startsWith('_') && !key.startsWith('$') && !INTERNAL_INSTANCE_KEYS.has(key) && !Object.hasOwn(declared, key);
}

/**
 * Determines which properties changed relative to what the client holds, runs Lit's pre-render
 * lifecycle, and records every post-action value into `postState`.
 */
function detectChangedProperties(input: PartPatchInput, declared: DeclaredProperties, postState: Record<string, unknown>): Set<string> {
  const { instance, baseline, actionWrites = [] } = input;
  const changed = new Set<string>();
  const changedForWillUpdate = new Map<PropertyKey, unknown>();

  const resolvePrevious = (prop: string): unknown => baseline.value(prop);

  const recordCurrent = (prop: string): unknown => {
    const current = instance[prop];
    if (declared[prop]?.state === true || current !== undefined) {
      postState[prop] = current;
    }
    return current;
  };

  const candidates = new Set<string>([...Object.keys(declared), ...baseline.props(), ...actionWrites]);
  for (const prop of candidates) {
    const current = recordCurrent(prop);
    const previous = resolvePrevious(prop);
    const mutatedInPlace = current !== null && typeof current === 'object' && current === previous && actionWrites.includes(prop);
    if (mutatedInPlace || !canonicalEqual(current, previous)) {
      changed.add(prop);
      changedForWillUpdate.set(prop, previous);
    }
  }

  // Snapshot plain instance fields so values derived inside `willUpdate` participate in patching.
  const fieldsBeforeWillUpdate = new Map<string, unknown>();
  for (const key of Object.keys(instance)) {
    if (isTrackableDerivedKey(key, declared)) {
      fieldsBeforeWillUpdate.set(key, cloneStateValue(instance[key]));
    }
  }

  instance.willUpdate?.(changedForWillUpdate);
  instance._invokeControllersHostUpdate?.();

  for (const prop of Object.keys(declared)) {
    const current = recordCurrent(prop);
    if (!canonicalEqual(current, resolvePrevious(prop))) {
      changed.add(prop);
    }
  }

  if (changed.size > 0) {
    for (const key of Object.keys(instance)) {
      if (isTrackableDerivedKey(key, declared) && (!fieldsBeforeWillUpdate.has(key) || !canonicalEqual(instance[key], fieldsBeforeWillUpdate.get(key)))) {
        changed.add(key);
      }
    }
  }

  return changed;
}

function isPartClean(partDeps: PartDeps | undefined, part: number, changed: ReadonlySet<string>): boolean {
  if (!partDeps) return false;
  const deps = Array.isArray(partDeps) ? partDeps[part] : partDeps[part];
  if (!Array.isArray(deps)) return false;
  return deps.length === 0 || !deps.some((dep) => changed.has(dep));
}

/** Renders the element and emits one frame per dirty binding part. */
function renderPartFrames(input: PartPatchInput, changed: ReadonlySet<string>, postState: Record<string, unknown>, renderOptions: RenderOptions): PatchFrame[] {
  const { instance, ElementClass, baseline } = input;
  if (typeof instance.render !== 'function') {
    return [];
  }

  const templateResult = instance.render();
  if (!templateResult || !Array.isArray(templateResult.values)) {
    return templateResult === undefined ? [] : [{ p: 0, v: templateResult }];
  }

  const partDeps: PartDeps | undefined = ElementClass.__litPartDeps || instance.constructor?.__litPartDeps;
  const frames: PatchFrame[] = [];

  (templateResult.values as unknown[]).forEach((value, part) => {
    if (isSymbolNamed(value, 'lit-noChange') || isPartClean(partDeps, part, changed)) {
      return;
    }

    if (isRepeatDirective(value) || (Array.isArray(value) && isKeyedList(value))) {
      const { ops, state } = diffKeyedItems(value, baseline.keyedState(part), renderOptions);
      if (ops.length > 0) {
        frames.push({ p: part, k: { p: part, ops } });
        writeKeyedState(postState, part, state);
      }
      return;
    }

    if (isTemplateValue(value)) {
      const nested = (value as { values?: unknown }).values;
      frames.push({ p: part, f: { p: part, h: extractTemplateId(value), html: renderToString(value, renderOptions), v: Array.isArray(nested) ? nested : [] } });
      return;
    }

    if (isRenderableIterable(value)) {
      // Lists built with `.map()` render to markup on the server; the browser swaps the whole fragment.
      frames.push({ p: part, f: { p: part, h: UNKEYED_ITERABLE_ID, html: renderToString(value, renderOptions), v: [] } });
      return;
    }

    frames.push({ p: part, v: isSymbolNamed(value, 'lit-nothing') ? null : value });
  });

  return frames;
}

/**
 * Computes the frames that bring the browser from `baseline` to the element's current state,
 * one per binding part whose dependencies changed. Does not sign or end the response, so it can
 * run more than once per response as the element's state settles.
 */
export function computePartPatches(input: PartPatchInput): PartPatchResult {
  const { instance, ElementClass, customElements } = input;
  const renderOptions: RenderOptions = {
    mode: 'dsd',
    resumable: false,
    customElements: (customElements ?? (globalThis as any).customElements) as CustomElementLookup | undefined,
  };

  const state: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(instance.__litState && typeof instance.__litState === 'object' ? instance.__litState : {})) {
    if (key.startsWith('__lit_')) {
      state[key] = value;
    }
  }

  const changed = detectChangedProperties(input, collectDeclaredProperties(ElementClass), state);
  instance.__litState = { ...state };

  return { frames: renderPartFrames(input, changed, state, renderOptions), state };
}

export interface SnapshotInput {
  body: OpenedActionRequest;
  ElementClass: any;
  secret: string | CryptoKey;
  stateTtlMs?: number;
  actionToken: string;
  buildIdFallback?: string;
  /** Seals the state for the wire: readable JSON, or ciphertext when encryption is on. */
  sealer: StateSealer;
}

/** Signs `state` as the client's next snapshot, one sequence number after the one it sent. */
export async function signSnapshotFrame(input: SnapshotInput, state: Record<string, unknown>): Promise<StateSnapshotPatchFrame> {
  const { body, ElementClass } = input;
  const sq = (body.snapshotSeq ?? 0) + 1;
  const signed = await createSignedStateSnapshot(body.tag, state, input.secret, {
    ttlMs: input.stateTtlMs ?? DEFAULT_STATE_TTL_MS,
    buildId: resolveServerBuildId(ElementClass, input.buildIdFallback),
    seq: sq,
    token: input.actionToken,
    publicAttrs: body.attrs,
  });
  return { s: await input.sealer.seal(body.tag, signed.state), sig: signed.sig, sq };
}

export interface SurgicalPatchInput extends SnapshotInput {
  instance: any;
  actionWrites?: readonly string[];
  actionResult: unknown;
  customElements?: { get(tagName: string): unknown };
  /** Property values captured before the action ran, used as the baseline for properties the client did not echo. */
  preActionSnapshot?: Map<string, unknown>;
}

/**
 * Computes every frame of a single-phase action response: dirty-part frames, the action result,
 * and a freshly signed snapshot.
 */
export async function computeSurgicalPatches(input: SurgicalPatchInput): Promise<PatchFrame[]> {
  const { frames, state } = computePartPatches({ ...input, baseline: requestBaseline(input.body, input.preActionSnapshot) });
  if (input.actionResult !== undefined) {
    frames.push({ r: input.actionResult });
  }
  frames.push(await signSnapshotFrame(input, state));
  return frames;
}
