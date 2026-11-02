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

  constructor(message: string, code = 'ACTION_FAILED', status = 500) {
    super(message);
    this.name = 'ServerActionError';
    this.code = code;
    this.status = status;
  }
}
