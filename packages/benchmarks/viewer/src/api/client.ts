import type { ManifestData, StandaloneBenchmarkResult } from '../types.js';

/**
 * Safely fetches a benchmark JSON file from results, checking content-type and
 * gracefully trying fallback URL paths to prevent SPA index.html from being parsed as JSON.
 */
async function fetchJsonSafely<T>(relativeResultsPath: string): Promise<T> {
  const cleanPath = relativeResultsPath.replace(/^\.?\/?results\/?/, '').replace(/^\//, '');
  const timestamp = Date.now();

  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
  const currentDir = currentPath.replace(/\/[^/]*$/, '');

  const candidateUrls = [`/results/${cleanPath}?t=${timestamp}`, `./results/${cleanPath}?t=${timestamp}`, `${currentDir}/results/${cleanPath}?t=${timestamp}`.replace(/\/+/g, '/')];
  const uniqueUrls = Array.from(new Set(candidateUrls));

  for (const url of uniqueUrls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      // If server returned an HTML fallback page, skip it (do not parse as JSON)
      if (contentType.includes('text/html')) {
        continue;
      }

      return (await response.json()) as T;
    } catch {
      // Try next candidate URL
    }
  }

  // If all candidate URLs failed, perform one final fetch to produce an accurate HTTP error
  const primaryUrl = `/results/${cleanPath}?t=${timestamp}`;
  const finalResponse = await fetch(primaryUrl).catch(() => null);

  if (finalResponse && !finalResponse.ok) {
    throw new Error(`Failed to load benchmark result (HTTP ${finalResponse.status} from ${primaryUrl})`);
  }

  const finalContentType = finalResponse?.headers.get('content-type') || '';
  if (finalContentType.includes('text/html')) {
    throw new Error(
      `Benchmark data file 'results/${cleanPath}' was not found on the server (server returned HTML fallback instead of JSON). Make sure benchmark results exist in packages/benchmarks/results/.`,
    );
  }

  throw new Error(`Failed to connect to benchmark server at ${primaryUrl}`);
}

/**
 * Fetch the benchmark index manifest.
 */
export async function fetchManifest(): Promise<ManifestData> {
  return fetchJsonSafely<ManifestData>('manifest.json');
}

/**
 * Fetch a standalone benchmark JSON result file by relative path or suite + feature.
 */
export async function fetchBenchmarkResult(relativePath: string): Promise<StandaloneBenchmarkResult> {
  return fetchJsonSafely<StandaloneBenchmarkResult>(relativePath);
}

/**
 * Fetch a benchmark result specifically by suite ID and feature ID.
 */
export async function fetchSuiteFeatureResult(suiteId: string, featureId: string): Promise<StandaloneBenchmarkResult> {
  return fetchBenchmarkResult(`${suiteId}/${featureId}.json`);
}
