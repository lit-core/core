/**
 * Web Standard WHATWG ReadableStream streaming generator for @lit-core/ssr.
 * Implements deterministic backpressure and client cancellation handling.
 */

import { type RenderOptions, render } from './renderer.js';

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

export function createStreamFromIterator(iterator: IterableIterator<string>, options: StreamRenderOptions = {}): ReadableStream<Uint8Array> {
  const encoder = options.encoder ?? new TextEncoder();
  const highWaterMark = options.highWaterMark ?? 1;
  const signal = options.signal;
  let firstChunkEmitted = false;
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
          try {
            controller.error(signal.reason ?? new Error('Aborted'));
          } catch {
            // Suppress
          }
          return;
        }

        try {
          if (!firstChunkEmitted) {
            while (true) {
              const next = iterator.next();
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
              if (buffer.length > 0) {
                controller.enqueue(encoder.encode(buffer));
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
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: highWaterMark * 1024 }),
  );
}

export function renderToStream(value: unknown, options: StreamRenderOptions = {}): ReadableStream<Uint8Array> {
  const iterator = render(value, options);
  return createStreamFromIterator(iterator, options);
}
