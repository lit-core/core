export interface MinifyCssOptions {
  sourcemap?: boolean;
  filename?: string;
}

export interface MinifyCssResult {
  code: string;
  map?: string;
  minifiedTemplates: number;
  bytesSaved: number;
}

export function minifyEmbeddedCss(source: string, options?: MinifyCssOptions): MinifyCssResult;
export function minifyTemplateCss(source: string, options?: MinifyCssOptions): MinifyCssResult;
export function transformEmbeddedCss(source: string, options?: MinifyCssOptions): MinifyCssResult;
export default minifyEmbeddedCss;
