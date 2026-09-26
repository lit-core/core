export interface TransformOptions {
  sourcemap?: boolean;
  filename?: string;
}

export interface TransformResult {
  code: string;
  map?: string;
}

export function transformLitProps(source: string, options?: TransformOptions): TransformResult;
