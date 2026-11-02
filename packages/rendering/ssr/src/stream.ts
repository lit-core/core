/**
 * Web Standard WHATWG ReadableStream streaming generator for @lit-core/ssr.
 * Implements deterministic backpressure, semantic async boundary flushing, and client cancellation handling.
 */

import { createSyncAndAsyncBoundaryIterators, type RenderOptions, renderAsync } from './renderer.js';

export interface StreamRenderOptions extends RenderOptions {
  /**
   * High water mark queue size in kilobytes before backpressure pauses iterator consumption.
   * @default 1
   */
  highWaterMark?: number;

  /**
   * Text encoder instance to reuse.
   * Defaults to global TextEncoder.
   */
  encoder?: TextEncoder;

  /**
   * Optional AbortSignal to terminate stream generation early when client disconnects.
   */
  signal?: AbortSignal;
}

export interface EdgeResponseOptions extends StreamRenderOptions {
  /**
   * HTTP response status code.
   * @default 200
   */
  status?: number;

  /**
   * HTTP response status text.
   */
  statusText?: string;

  /**
   * Additional HTTP response headers.
   */
  headers?: HeadersInit;
}

export function createStreamFromAsyncIterator(asyncIterator: AsyncIterableIterator<string>, options: StreamRenderOptions = {}): ReadableStream<Uint8Array> {
  const encoder = options.encoder ?? new TextEncoder();
  const highWaterMark = options.highWaterMark ?? 1;
  const signal = options.signal;
  let onAbortListener: (() => void) | null = null;

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        if (signal?.aborted) {
          Promise.resolve(asyncIterator.return?.()).catch(() => {});
          controller.error(signal.reason ?? new Error('Aborted'));
          return;
        }
        if (signal) {
          onAbortListener = () => {
            Promise.resolve(asyncIterator.return?.()).catch(() => {});
            try {
              controller.error(signal.reason ?? new Error('Aborted'));
            } catch {
              // Suppress if already closed
            }
          };
          signal.addEventListener('abort', onAbortListener, { once: true });
        }
      },
      async pull(controller) {
        if (signal?.aborted) {
          if (onAbortListener && signal) {
            signal.removeEventListener('abort', onAbortListener);
          }
          await asyncIterator.return?.().catch(() => {});
          try {
            controller.error(signal.reason ?? new Error('Aborted'));
          } catch {
            // Suppress
          }
          return;
        }

        try {
          while (true) {
            const next = await asyncIterator.next();
            if (next.done) {
              if (onAbortListener && signal) {
                signal.removeEventListener('abort', onAbortListener);
              }
              controller.close();
              return;
            }
            if (next.value != null) {
              const chunkStr = typeof next.value === 'string' ? next.value : String(next.value);
              if (chunkStr.length > 0) {
                controller.enqueue(encoder.encode(chunkStr));
                return;
              }
            }
          }
        } catch (err) {
          if (onAbortListener && signal) {
            signal.removeEventListener('abort', onAbortListener);
          }
          controller.error(err);
          await asyncIterator.return?.().catch(() => {});
        }
      },
      cancel(_reason) {
        if (onAbortListener && signal) {
          signal.removeEventListener('abort', onAbortListener);
        }
        Promise.resolve(asyncIterator.return?.()).catch(() => {});
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: highWaterMark * 1024 }),
  );
}

export function createStreamFromIterator(
  iterator: IterableIterator<string>,
  options: StreamRenderOptions = {},
  asyncFollowUp?: {
    hasPendingBoundaries: () => boolean;
    createAsyncDrainIterator: () => AsyncIterableIterator<string>;
  },
): ReadableStream<Uint8Array> {
  const encoder = options.encoder ?? new TextEncoder();
  const highWaterMark = options.highWaterMark ?? 1;
  const signal = options.signal;
  let firstChunkEmitted = false;
  let syncDone = false;
  let activeAsyncIterator: AsyncIterableIterator<string> | null = null;
  let onAbortListener: (() => void) | null = null;

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        if (signal?.aborted) {
          try {
            iterator.return?.();
          } catch {
            // Suppress cleanup error
          }
          controller.error(signal.reason ?? new Error('Aborted'));
          return;
        }

        if (signal) {
          onAbortListener = () => {
            try {
              iterator.return?.();
            } catch {
              // Suppress cleanup error
            }
            if (activeAsyncIterator) {
              Promise.resolve(activeAsyncIterator.return?.()).catch(() => {});
            }
            try {
              controller.error(signal.reason ?? new Error('Aborted'));
            } catch {
              // Suppress if stream already closed or errored
            }
          };
          signal.addEventListener('abort', onAbortListener, { once: true });
        }
      },
      pull(controller) {
        if (signal?.aborted) {
          if (onAbortListener && signal) {
            signal.removeEventListener('abort', onAbortListener);
          }
          try {
            iterator.return?.();
          } catch {
            // Suppress
          }
          if (activeAsyncIterator) {
            Promise.resolve(activeAsyncIterator.return?.()).catch(() => {});
          }
          try {
            controller.error(signal.reason ?? new Error('Aborted'));
          } catch {
            // Suppress
          }
          return;
        }

        if (syncDone && activeAsyncIterator) {
          return (async () => {
            try {
              while (true) {
                const next = await activeAsyncIterator?.next();
                if (next.done) {
                  if (onAbortListener && signal) {
                    signal.removeEventListener('abort', onAbortListener);
                  }
                  controller.close();
                  return;
                }
                if (next.value != null) {
                  const chunkStr = typeof next.value === 'string' ? next.value : String(next.value);
                  if (chunkStr.length > 0) {
                    // Semantic flush: emit each resolved out-of-order boundary chunk immediately
                    controller.enqueue(encoder.encode(chunkStr));
                    return;
                  }
                }
              }
            } catch (err) {
              if (onAbortListener && signal) {
                signal.removeEventListener('abort', onAbortListener);
              }
              controller.error(err);
              await activeAsyncIterator?.return?.().catch(() => {});
            }
          })();
        }

        try {
          if (!firstChunkEmitted) {
            while (true) {
              const next = iterator.next();
              if (next.done) {
                syncDone = true;
                if (asyncFollowUp?.hasPendingBoundaries()) {
                  activeAsyncIterator = asyncFollowUp.createAsyncDrainIterator();
                  return this.pull?.(controller);
                }
                if (onAbortListener && signal) {
                  signal.removeEventListener('abort', onAbortListener);
                }
                controller.close();
                return;
              }
              if (next.value != null) {
                const chunkStr = typeof next.value === 'string' ? next.value : String(next.value);
                if (chunkStr.length > 0) {
                  controller.enqueue(encoder.encode(chunkStr));
                  firstChunkEmitted = true;
                  return;
                }
              }
            }
          }

          let buffer = '';
          while (true) {
            const next = iterator.next();
            if (next.done) {
              syncDone = true;
              if (buffer.length > 0) {
                // Semantic flush of synchronous shell before awaiting any pending async boundaries
                controller.enqueue(encoder.encode(buffer));
              }
              if (asyncFollowUp?.hasPendingBoundaries()) {
                activeAsyncIterator = asyncFollowUp.createAsyncDrainIterator();
                if (buffer.length > 0) {
                  return;
                }
                return this.pull?.(controller);
              }
              if (onAbortListener && signal) {
                signal.removeEventListener('abort', onAbortListener);
              }
              controller.close();
              return;
            }
            if (next.value != null) {
              const chunkStr = typeof next.value === 'string' ? next.value : String(next.value);
              if (chunkStr.length > 0) {
                buffer += chunkStr;
                if (buffer.length >= 1024) {
                  controller.enqueue(encoder.encode(buffer));
                  return;
                }
              }
            }
          }
        } catch (err) {
          if (onAbortListener && signal) {
            signal.removeEventListener('abort', onAbortListener);
          }
          controller.error(err);
          try {
            iterator.return?.();
          } catch {
            // Suppress cleanup error to preserve primary exception
          }
        }
      },
      cancel(_reason) {
        if (onAbortListener && signal) {
          signal.removeEventListener('abort', onAbortListener);
        }
        try {
          iterator.return?.();
        } catch {
          // Suppress cleanup error
        }
        if (activeAsyncIterator) {
          Promise.resolve(activeAsyncIterator.return?.()).catch(() => {});
        }
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: highWaterMark * 1024 }),
  );
}

export function renderToStream(value: unknown, options: StreamRenderOptions = {}): ReadableStream<Uint8Array> {
  if (options.streamingMode === 'in-order') {
    return createStreamFromAsyncIterator(renderAsync(value, options), options);
  }
  const { syncIterator, hasPendingBoundaries, createAsyncDrainIterator } = createSyncAndAsyncBoundaryIterators(value, options);
  return createStreamFromIterator(syncIterator, options, {
    hasPendingBoundaries,
    createAsyncDrainIterator,
  });
}

export function renderToResponse(value: unknown, options: EdgeResponseOptions = {}): Response {
  const headers = new Headers(options.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'text/html; charset=utf-8');
  }
  if (!headers.has('x-content-type-options')) {
    headers.set('x-content-type-options', 'nosniff');
  }
  const stream = renderToStream(value, options);
  return new Response(stream, {
    status: options.status ?? 200,
    statusText: options.statusText,
    headers,
  });
}
