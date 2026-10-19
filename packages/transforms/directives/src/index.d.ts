export interface DirectivesOptions {
  sourcemap?: boolean;
  filename?: string;
}

export interface DirectivesResult {
  code: string;
  map?: string | null;
  loweredCount: number;
  directivesUsed: string[];
}

export function transformDirectives(source: string, options?: DirectivesOptions): DirectivesResult;
export default transformDirectives;
