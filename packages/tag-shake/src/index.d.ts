export interface TagShakeOptions {
  usedTags?: string[];
  filename?: string;
  sourcemap?: boolean;
}

export interface TagShakeResult {
  code: string;
  map?: string;
  removedTags: string[];
  preservedTags: string[];
  shakenRegistrationsCount: number;
  prunedImportsCount: number;
  isEmpty: boolean;
}

/**
 * Scan application source text for custom element tag names.
 */
export function scanTags(source: string, filename?: string): string[];

/**
 * Ahead-of-time dead code elimination for Web Component registrations.
 */
export function transformTagShake(source: string, options?: TagShakeOptions): TagShakeResult;

export default transformTagShake;
