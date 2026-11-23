/** Well-known secret used only when `devMode: true` is passed explicitly. Never valid in production. */
const DEV_MODE_SECRET = 'lit-server-element-dev-secret';

export interface SecretSource {
  secret?: string | CryptoKey;
  env?: Record<string, unknown>;
  devMode?: boolean;
}

/**
 * Resolves the HMAC signing secret, failing closed.
 *
 * Order: explicit `secret`, then the `LIT_ACTION_SECRET` binding, then (only when `devMode` is
 * explicitly `true`) a fixed development secret. The ambient `NODE_ENV` is never consulted.
 */
export function resolveMandatorySecret(source: SecretSource): string | CryptoKey {
  const secret = source.secret || (source.env?.LIT_ACTION_SECRET as string | CryptoKey | undefined);
  if (secret) {
    return secret;
  }
  if (source.devMode === true) {
    return DEV_MODE_SECRET;
  }
  throw new Error(
    '[@lit-core/server-elements] Missing mandatory secret key for HMAC state signing. ' +
      'Configure options.secret or the LIT_ACTION_SECRET binding, or pass devMode: true for local development only.',
  );
}
