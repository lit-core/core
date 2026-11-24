/** Well-known secret used only when `devMode: true` is passed explicitly. Never valid in production. */
const DEV_MODE_SECRET = 'lit-server-element-dev-secret';

/**
 * Shortest string secret accepted.
 *
 * A signed snapshot, the state it covers and the signature are all in the page, so anyone who can load
 * the page holds everything needed to test a guess at the secret offline. Length is only a floor that
 * catches placeholders and typed-in words; what makes guessing infeasible is that the secret is random,
 * so generate 32 random bytes (`openssl rand -base64 32`) rather than writing one.
 */
export const MIN_SECRET_LENGTH = 32;

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
    if (typeof secret === 'string' && secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `[@lit-core/server-elements] The signing secret is ${secret.length} characters; it must be at least ${MIN_SECRET_LENGTH} characters and random, because the signature is visible in every page and a short secret can be guessed from it. Generate one with: openssl rand -base64 32`,
      );
    }
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
