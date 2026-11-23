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
 * the effect of the action while slower loaders are still fetching. The loader-derived patches follow
 * as a second phase, computed against what the first already delivered.
 *
 * If revalidation fails, the snapshot for the first phase is still yielded before the error
 * propagates. The browser has already applied the first phase, so its signed state must match it.
 */
export async function* actionFrames(source: ActionFrameSource, outcome: ActionOutcome): AsyncGenerator<PatchFrame> {
  const first = computePartPatches({ ...source, baseline: requestBaseline(source.body, outcome.preActionSnapshot) });
  yield* first.frames;
  if (outcome.actionResult !== undefined) {
    yield { r: outcome.actionResult };
  }

  if (!outcome.revalidate) {
    yield await signSnapshotFrame(source, first.state);
    return;
  }

  try {
    await outcome.revalidate();
    const second = computePartPatches({ ...source, baseline: stateBaseline(first.state) });
    yield* second.frames;
    yield await signSnapshotFrame(source, second.state);
  } catch (err) {
    yield await signSnapshotFrame(source, first.state);
    throw err;
  }
}

/** All frames of a response at once, for transports that cannot stream. Loaders finish before anything is computed. */
export async function collectActionFrames(source: ActionFrameSource, outcome: ActionOutcome): Promise<PatchFrame[]> {
  await outcome.revalidate?.();
  return computeSurgicalPatches({ ...source, actionResult: outcome.actionResult, preActionSnapshot: outcome.preActionSnapshot });
}
