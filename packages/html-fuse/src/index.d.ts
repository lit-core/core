export interface HtmlFuseConfig {
  include?: Array<string>;
  exclude?: Array<string>;
  files?: Array<string>;
  threshold?: number;
  outputDir?: string;
  write?: boolean;
  virtualImports?: boolean;
  minSavings?: number;
  minFragmentLength?: number;
}

export interface FusedTemplateInfo {
  id: string;
  fileName: string;
  code: string;
  kind: 'html' | 'svg';
  rawTemplate: string;
  sharedBy: Array<string>;
  occurrencesCount: number;
}

export interface RewrittenFileInfo {
  filePath: string;
  originalCode: string;
  transformedCode: string;
  fusedImports: Array<string>;
}

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
}

export interface HtmlFuseStats {
  filesScanned: number;
  templatesScanned: number;
  fragmentsExtracted: number;
  uniqueFragments: number;
  fragmentsDeduped: number;
  fusedTemplatesCreated: number;
  componentsRewritten: number;
  bytesSaved: number;
}

export interface HtmlFuseResult {
  fusedTemplates: Array<FusedTemplateInfo>;
  rewrittenFiles: Array<RewrittenFileInfo>;
  diagnostics: Array<Diagnostic>;
  stats: HtmlFuseStats;
}

export declare function fuse(config?: HtmlFuseConfig): HtmlFuseResult;
export declare function analyze(config?: HtmlFuseConfig): HtmlFuseResult;
export declare function auditTemplates(config?: HtmlFuseConfig): Array<Diagnostic>;
