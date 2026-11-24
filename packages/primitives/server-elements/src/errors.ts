import { RELOAD_REQUIRED_CODES } from './protocol.js';

/**
 * Error thrown when an uncompiled server element with @loader() or @action() is executed at runtime.
 */
export class UncompiledServerElementError extends Error {
  constructor(decoratorName: string, memberName: string, targetName: string) {
    super(
      `[@lit-core/server-elements] ${targetName}.${memberName} is decorated with @${decoratorName}(), ` +
        `but the file was executed without being compiled by @lit-core/vite-plugin or @lit-core/webpack-plugin.\n\n` +
        `Server element methods containing @loader() and @action() run on edge workers and must be split ` +
        `at build time into server-only and client-safe artifacts.\n` +
        `Ensure that @lit-core/vite-plugin (or @lit-core/webpack-plugin) is configured in your build pipeline.`,
    );
    this.name = 'UncompiledServerElementError';
  }
}

/**
 * Error thrown when a server action fails during execution or network dispatch.
 */
export class ServerActionError extends Error {
  readonly code: string;
  readonly status: number;
  /** Per-field messages from a deliberate server `ActionError`, keyed by input name. */
  readonly fields?: Readonly<Record<string, string>>;

  constructor(message: string, code = 'ACTION_FAILED', status = 500, fields?: Record<string, string>) {
    super(message);
    this.fields = fields;
    this.name = 'ServerActionError';
    this.code = code;
    this.status = status;
  }
}

/**
 * True when an action failed because its page is out of date (a newer deploy, a snapshot already used,
 * or a page open past its signed state's lifetime). The fix is to reload, so an application can offer that:
 *
 * ```ts
 * document.addEventListener('lit-action-error', (event) => {
 *   if (isReloadRequired(event.detail.error)) showReloadBanner();
 * });
 * ```
 */
export function isReloadRequired(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && RELOAD_REQUIRED_CODES.includes(code);
}
