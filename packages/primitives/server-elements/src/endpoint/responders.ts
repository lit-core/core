import { isActionError } from '../action-error.js';
import { runLoaders } from '../execution.js';
import { signSnapshotFrame } from '../patches/compute.js';
import type { ErrorPatchFrame, PatchFrame } from '../types.js';
import { actionFrames, collectActionFrames } from './action-frames.js';
import { runAction } from './action-runner.js';
import { type ActionScope, applyOutgoing } from './action-scope.js';
import { jsonErrorResponse } from './endpoint-error.js';
import { errorPageResponse, redirectResponse, resolveRedirectTarget } from './form-response.js';

/** The three ways an action can be answered, chosen by how the request arrived. */
export type ActionTransport = 'form' | 'ndjson' | 'json';

export function chooseTransport(request: Request, isForm: boolean): ActionTransport {
  if (isForm) return 'form';
  return (request.headers.get('Accept') || '').includes('application/x-ndjson') ? 'ndjson' : 'json';
}

/** The frame a failure is reported as. Deliberate `ActionError`s are shown; anything else is redacted outside dev mode. */
function toErrorFrame(err: any, devMode: boolean): ErrorPatchFrame {
  if (isActionError(err)) {
    return { e: err.message, code: err.code, ...(err.fields ? { fields: { ...err.fields } } : {}) };
  }
  return {
    e: devMode ? String(err?.message || 'Internal server error') : 'Internal server error',
    code: devMode && err?.code ? err.code : 'INTERNAL_ERROR',
  };
}

/** Deliberate `ActionError`s are expected outcomes, not failures worth reporting. */
function reportUnexpected(scope: ActionScope, err: unknown): void {
  if (!isActionError(err)) scope.reportError(err);
}

const runScopedAction = (scope: ActionScope) => runAction(scope.instance, scope.ElementClass, scope.declared, scope.context, scope.actionMeta, scope.validatedArgs);

/**
 * Answers a plain form post.
 *
 * A form post has no script to apply patches, so the action runs and the browser is sent back to
 * reload the page, whose loaders reflect the change. Loader revalidation is skipped for that reason.
 * The post carries no state either, so the loaders run once before the action to give the element
 * the state its page was rendered with.
 */
export async function respondToForm(scope: ActionScope): Promise<Response> {
  try {
    // A form carries no state, so the element gets what a page load would give it: its loaders run first.
    await runLoaders(scope.instance, scope.ElementClass, scope.context);
    await runScopedAction(scope);
    return redirectResponse(resolveRedirectTarget(scope.form?.redirect ?? null, scope.request.headers.get('Referer'), scope.url), applyOutgoing(new Headers(), scope.outgoing));
  } catch (err) {
    reportUnexpected(scope, err);
    if (isActionError(err)) {
      return errorPageResponse(err.status, err.message, applyOutgoing(new Headers(), scope.outgoing), err.fields);
    }
    return errorPageResponse(500, 'Internal server error', applyOutgoing(new Headers(), scope.outgoing));
  }
}

/**
 * The frames of an action that failed before producing any: a fresh snapshot of the state the browser
 * already holds, then the failure.
 *
 * The failed request used up its snapshot (a replay guard makes each one single-use), and the browser
 * applied no patches, so re-signing its own state keeps the element usable instead of leaving it holding
 * a spent signature until the page is reloaded.
 */
async function* failedActionFrames(scope: ActionScope, error: unknown): AsyncGenerator<PatchFrame> {
  const { body } = scope.frameSource;
  yield await signSnapshotFrame(scope.frameSource, body.state);
  throw error;
}

function streamNdjson(frames: AsyncIterable<PatchFrame>, headers: Headers, toFrame: (err: unknown) => ErrorPatchFrame): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const write = (frame: PatchFrame) => writer.write(encoder.encode(`${JSON.stringify(frame)}\n`));

  (async () => {
    try {
      for await (const frame of frames) {
        await write(frame);
      }
    } catch (err) {
      await write(toFrame(err)).catch(() => {});
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  headers.set('Content-Type', 'application/x-ndjson; charset=utf-8');
  headers.set('Cache-Control', 'no-cache, no-transform');
  return new Response(readable, { status: 200, headers });
}

/**
 * Answers with a stream of patch frames.
 *
 * The action finishes before the response is created, so the cookies and headers it set are included.
 * Failures surface as an error frame inside a 200 stream, matching the streaming client contract.
 */
export async function respondStreaming(scope: ActionScope, devMode: boolean): Promise<Response> {
  const toFrame = (err: unknown) => {
    reportUnexpected(scope, err);
    return toErrorFrame(err, devMode);
  };

  const settled = await runScopedAction(scope).then(
    (outcome) => ({ outcome }) as const,
    (error: unknown) => ({ error }) as const,
  );
  if ('error' in settled) {
    return streamNdjson(failedActionFrames(scope, settled.error), applyOutgoing(new Headers(), scope.outgoing), toFrame);
  }

  // Loaders that revalidate after this point run once headers are on the wire.
  scope.outgoing.sealed = settled.outcome.revalidate !== null;
  return streamNdjson(actionFrames(scope.frameSource, settled.outcome), applyOutgoing(new Headers(), scope.outgoing), toFrame);
}

/** Answers with one JSON array of frames, after every loader has finished. */
export async function respondBuffered(scope: ActionScope): Promise<Response> {
  try {
    const frames = await collectActionFrames(scope.frameSource, await runScopedAction(scope));
    return new Response(JSON.stringify(frames), { status: 200, headers: applyOutgoing(new Headers({ 'Content-Type': 'application/json' }), scope.outgoing) });
  } catch (err) {
    reportUnexpected(scope, err);
    const headers = applyOutgoing(new Headers(), scope.outgoing);
    if (isActionError(err)) {
      return jsonErrorResponse(err.status, { error: err.message, code: err.code, ...(err.fields ? { fields: { ...err.fields } } : {}) }, headers);
    }
    return jsonErrorResponse(500, { error: 'Internal server error', code: 'INTERNAL_ERROR' }, headers);
  }
}
