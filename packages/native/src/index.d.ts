export interface TransformOptions {
  mode?: 'auto' | 'vanilla-only' | 'micro-only';
  sourcemap?: boolean;
  filename?: string;
  include?: string[];
  exclude?: string[];
}

export interface ClassifyOptions {
  mode?: 'auto' | 'vanilla-only' | 'micro-only';
  filename?: string;
}

export interface ClassificationResult {
  mode: 'vanilla' | 'micro' | 'skip';
  componentName: string;
  tagName?: string | null;
  reason?: string | null;
}

export interface TransformResult {
  code: string;
  map?: string | null;
  vanillaCount: number;
  microCount: number;
  classifications: ClassificationResult[];
}

export function classify(source: string, options?: ClassifyOptions): ClassificationResult[];
export function transformNative(source: string, options?: TransformOptions): TransformResult;
export default transformNative;
