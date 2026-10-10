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

export interface ScenarioMetadata {
  id: string;
  name: string;
  description: string;
  relevantFeatures: string[];
  componentConcepts: string[];
}

export interface FeatureMetadata {
  id: string;
  name: string;
  description: string;
  category: 'baseline' | 'styles' | 'templates' | 'reactivity' | 'dom' | 'registration' | 'runtime' | 'resumption' | 'tree-shaking' | 'combined' | string;
  isBaseline?: boolean;
  scenarioId?: string;
  scenarioName?: string;
}

export interface StandaloneBenchmarkResult {
  schemaVersion: string;
  id: string;
  suite: SuiteMetadata;
  feature: FeatureMetadata;
  scenario?: {
    id: string;
    name: string;
    description: string;
  };
  timestamp: string;
  environment: EnvironmentMetadata;
  metrics: SizeMetrics;
  baseline?: SizeMetrics;
  deltas?: SizeDeltas;
  runtime?: RuntimeMetrics;
  diagnostics?: Record<string, any>;
}

export interface ScenarioBenchmarkResult {
  schemaVersion: string;
  id: string;
  scenario: ScenarioMetadata;
  suite: SuiteMetadata;
  variant: {
    id: string;
    name: string;
    isBaseline: boolean;
  };
  timestamp: string;
  environment: EnvironmentMetadata;
  metrics: SizeMetrics & RuntimeMetrics & { scenarioSpecific?: Record<string, any> };
  baseline?: SizeMetrics & RuntimeMetrics;
  deltas?: SizeDeltas & {
    firstRenderMs?: number;
    speedupPercent?: number;
    updateMs?: number;
    updateSpeedupPercent?: number;
    evalSpeedupPercent?: number;
    registrationSpeedupPercent?: number;
    memorySavingsPercent?: number;
  };
  equivalence?: {
    domStructureMatch: boolean;
    elementsCount: number;
    verified: boolean;
  };
}

export interface ManifestRunEntry {
  suiteId: string;
  featureId: string;
  scenarioId?: string;
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
  scenarios?: ScenarioMetadata[];
  features: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    scenarioId?: string;
    scenarioName?: string;
  }>;
  runs: ManifestRunEntry[];
}
