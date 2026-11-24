import { computePartPatches, computeSurgicalPatches, requestBaseline, type SnapshotInput, signSnapshotFrame, stateBaseline } from '../patches/compute.js';
import type { PatchFrame } from '../types.js';
import type { ActionOutcome } from './action-runner.js';

export interface ActionFrameSource extends SnapshotInput {
  instance: any;
  actionWrites?: readonly string[];
  customElements?: { get(tagName: string): unknown };
}

/**
 * Yields the frames of an action response in the order the browser should apply them.
 *
 * With nothing to revalidate this is one phase: part patches, the action result, a signed snapshot.
 * When loaders must re-run, the action's own patches and result are yielded first, so the user sees
 * the effect of the action while slower loaders are still fetching. Each phase ends with the signed
 * snapshot of the state it leaves the page in, and the browser applies a phase together with its
 * snapshot. The loader-derived patches follow as a second phase, computed against what the first
 * already delivered.
 *
 * Because the first phase carries its own snapshot, a connection that drops while loaders are still
 * running leaves the browser with a page and a signed state that agree, and a failed revalidation
 * needs no extra frame: the error simply follows the first phase's snapshot.
 */
export async function* actionFrames(source: ActionFrameSource, outcome: ActionOutcome): AsyncGenerator<PatchFrame> {
  const first = computePartPatches({ ...source, baseline: requestBaseline(source.body, outcome.preActionSnapshot) });
  yield* first.frames;
  if (outcome.actionResult !== undefined) {
    yield { r: outcome.actionResult };
  }
  yield await signSnapshotFrame(source, first.state);

  if (!outcome.revalidate) return;

  await outcome.revalidate();
  const second = computePartPatches({ ...source, baseline: stateBaseline(first.state) });
  yield* second.frames;
  yield await signSnapshotFrame(source, second.state);
}

/** All frames of a response at once, for transports that cannot stream. Loaders finish before anything is computed. */
export async function collectActionFrames(source: ActionFrameSource, outcome: ActionOutcome): Promise<PatchFrame[]> {
  await outcome.revalidate?.();
  return computeSurgicalPatches({ ...source, actionResult: outcome.actionResult, preActionSnapshot: outcome.preActionSnapshot });
}
