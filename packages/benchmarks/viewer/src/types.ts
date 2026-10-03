export interface EnvironmentMetadata {
  node: string;
  platform: string;
  arch: string;
  gitCommit: string;
  gitBranch: string;
}

export interface SizeMetrics {
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
  buildTimeMs: number;
}

export interface SizeDeltas {
  rawBytes?: number;
  rawPercent?: number;
  gzipBytes?: number;
  gzipPercent?: number;
  brotliBytes?: number;
  brotliPercent?: number;
  buildTimeMs?: number;
}

export interface RuntimeMetrics {
  firstRenderMs: number;
  updateMs?: number;
  scriptEvalMs?: number;
  registrationMs?: number;
  heapUsedBytes?: number;
  speedupPercent?: number;
  updateSpeedupPercent?: number;
  evalSpeedupPercent?: number;
  registrationSpeedupPercent?: number;
  memorySavingsPercent?: number;
}

export interface CanonicalComponentItem {
  concept: string;
  tag: string;
  name: string;
  path?: string;
}

export interface SuiteMetadata {
  id: string;
  name: string;
  packageName: string;
  version: string;
  componentCount: number;
  components?: CanonicalComponentItem[];
}

export interface FeatureMetadata {
  id: string;
  name: string;
  description: string;
  category: 'baseline' | 'styles' | 'templates' | 'reactivity' | 'dom' | 'registration' | 'runtime' | 'resumption' | 'combined' | string;
  isBaseline?: boolean;
}

export interface StandaloneBenchmarkResult {
  schemaVersion: string;
  id: string;
  suite: SuiteMetadata;
  feature: FeatureMetadata;
  timestamp: string;
  environment: EnvironmentMetadata;
  metrics: SizeMetrics;
  baseline?: SizeMetrics;
  deltas?: SizeDeltas;
  runtime?: RuntimeMetrics;
  diagnostics?: Record<string, any>;
}

export interface ManifestRunEntry {
  suiteId: string;
  featureId: string;
  path: string;
  htmlPath?: string;
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
  buildTimeMs: number;
  rawPercent: number;
  gzipPercent: number;
  brotliPercent: number;
  firstRenderMs: number;
  updateMs?: number;
  scriptEvalMs?: number;
  registrationMs?: number;
  heapUsedBytes?: number;
  speedupPercent: number;
  updateSpeedupPercent?: number;
  evalSpeedupPercent?: number;
  registrationSpeedupPercent?: number;
  memorySavingsPercent?: number;
  timestamp: string;
}

export interface ManifestData {
  schemaVersion: string;
  generatedAt: string;
  canonicalComponentCount: number;
  canonicalComponents: string[];
  libraries: Array<{
    id: string;
    name: string;
    packageName: string;
    componentCount: number;
  }>;
  features: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
  }>;
  runs: ManifestRunEntry[];
}
