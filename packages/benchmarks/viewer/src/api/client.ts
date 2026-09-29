import type { ManifestData, StandaloneBenchmarkResult } from '../types.js';

/**
 * Fetch the benchmark index manifest.
 */
export async function fetchManifest(): Promise<ManifestData> {
  const url = `./results/manifest.json?t=${Date.now()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load benchmark manifest (HTTP ${response.status} from ${url})`);
  }
  return response.json();
}

/**
 * Fetch a standalone benchmark JSON result file by relative path or suite + feature.
 */
export async function fetchBenchmarkResult(relativePath: string): Promise<StandaloneBenchmarkResult> {
  const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  const url = `./results/${cleanPath}?t=${Date.now()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load benchmark result (HTTP ${response.status} from ${url})`);
  }
  return response.json();
}

/**
 * Fetch a benchmark result specifically by suite ID and feature ID.
 */
export async function fetchSuiteFeatureResult(suiteId: string, featureId: string): Promise<StandaloneBenchmarkResult> {
  return fetchBenchmarkResult(`${suiteId}/${featureId}.json`);
}
