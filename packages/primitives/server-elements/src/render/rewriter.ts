import { createBoundaryPayload, type HtmlRewriterLike, type HtmlRewriterServerElementAdapter, type HtmlRewriterSsrOptions, transformWithHtmlRewriter } from '@lit-core/ssr';
import { isServerElementClass } from '../metadata.js';
import { resolveMandatorySecret } from '../secret.js';
import { prepareServerElement } from './pipeline.js';

export interface ServerElementsHtmlRewriterOptions extends HtmlRewriterSsrOptions {
  request?: Request;
  env?: Record<string, unknown>;
  params?: Record<string, string>;
  secret?: string | CryptoKey;
  ttlMs?: number;
  devMode?: boolean;
  /** Encrypt state in the rendered page. The action endpoint must enable `encryptState` too. */
  encryptState?: boolean;
}

/**
 * Creates the adapter that lets `HTMLRewriter` render server elements through the same
 * `prepareServerElement` pipeline as `renderServerElement`. Loaders run as pending async
 * boundaries, so the rewriter's tokenizer is never blocked on data.
 */
export function createServerElementRewriterAdapter(options: ServerElementsHtmlRewriterOptions = {}): HtmlRewriterServerElementAdapter {
  return {
    canHandle: (Ctor) => isServerElementClass(Ctor),
    prepareBoundary({ instance, Ctor, tagName, hostId, incomingAttrs }) {
      const secret = resolveMandatorySecret(options);
      const pendingContent = typeof instance.renderPending === 'function' ? instance.renderPending() : undefined;

      const boundaryPromise = prepareServerElement(
        instance,
        Ctor,
        tagName,
        incomingAttrs,
        hostId,
        {
          request: options.request,
          env: options.env,
          params: options.params,
          secret,
          ttlMs: options.ttlMs,
          customElements: options.customElements,
          mode: options.mode,
          devMode: options.devMode,
          encryptState: options.encryptState,
          strict: options.strictLifecycle,
          onError: options.onError,
          hostId,
        },
        secret,
      ).then((prepared) => createBoundaryPayload(prepared.shadowRenderResult, prepared.hostAttributes));

      return { pendingContent, boundaryPromise };
    },
  };
}

/** Enriches `HtmlRewriterSsrOptions` with the server element adapter. */
export function createServerElementsRewriterOptions(options: ServerElementsHtmlRewriterOptions = {}): HtmlRewriterSsrOptions {
  return {
    resumable: false,
    ...options,
    serverElementAdapter: options.serverElementAdapter ?? createServerElementRewriterAdapter(options),
  };
}

/**
 * Streams an HTML response through `HTMLRewriter`, executing `@loader()` methods concurrently,
 * reflecting host attributes, signing state, and emitting progressive Declarative Shadow DOM.
 */
export function transformServerElementsWithHtmlRewriter(input: Response | string, options: ServerElementsHtmlRewriterOptions = {}, rewriterFactory?: () => HtmlRewriterLike): Response {
  return transformWithHtmlRewriter(input, createServerElementsRewriterOptions(options), rewriterFactory);
}
