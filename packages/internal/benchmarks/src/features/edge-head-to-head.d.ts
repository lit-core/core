export interface TargetDefinition {
  id: string;
  name: string;
  shortName: string;
  runtime: string;
  description: string;
}

export interface DesignSystemDefinition {
  id: string;
  name: string;
  packageName: string;
}

export const TARGETS: TargetDefinition[];
export const EDGE_DESIGN_SYSTEMS: DesignSystemDefinition[];

export function measureCompression(input: string | Buffer): {
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
};

export function getFullLitClientBundle(componentSource?: string): string;
export function getLitLabsClientBundle(componentSource?: string): string;

export function countMarkers(htmlStr: string): {
  commentMarkersCount: number;
  rangeMarkersCount: number;
  totalMarkersCount: number;
};

export function evaluateTargetA(): Promise<any>;
export function evaluateTargetC(): Promise<any>;
export function evaluateTargetD(): Promise<any>;
export function verifyEdgeDesignSystemSsr(): Promise<any[]>;
export function comparePlainSsr(): Promise<any>;
export function runEdgeHeadToHeadBenchmark(options?: { save?: boolean; verbose?: boolean }): Promise<any>;
export default runEdgeHeadToHeadBenchmark;

export interface PlainSsrTiming {
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
  workerdCpuMedianMs: number;
  workerdCpuP95Ms: number;
  nodeCpuMedianMs: number;
  nodeCpuP95Ms: number;
}

export interface PlainSsrWorkload {
  id: string;
  rootTag: string;
  sameTreeVerified: boolean;
  litCore: PlainSsrTiming;
  litLabs: PlainSsrTiming;
}

/** One run of the plain SSR comparison against `@lit-labs/ssr`; the suite is memoized inside a process. */
export function measurePlainSsrHeadToHead(): Promise<{
  environment: { workerdVersion: string; workerdEnvironment: string; nodeEnvironment: string };
  workloads: PlainSsrWorkload[];
}>;
