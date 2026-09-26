export interface CollapseOptions {
  filename?: string;
  sourcemap?: boolean;
}

export type HtmlMinifierOptions = CollapseOptions;

export interface CollapseResult {
  code: string;
  map?: string | null;
  templatesCount: number;
  bytesSaved: number;
}

export type HtmlMinifierResult = CollapseResult;

export function minifyHtmlTemplates(source: string, options?: CollapseOptions): CollapseResult;
export function minifyLitTemplates(source: string, options?: CollapseOptions): CollapseResult;
export function collapseLitTemplates(source: string, options?: CollapseOptions): CollapseResult;

export default minifyHtmlTemplates;
