import React, { useEffect, useState, useCallback } from 'react';
import { fetchBenchmarkResult, fetchManifest } from './api/client.js';
import { CanonicalComponentsDrawer } from './components/CanonicalComponentsDrawer.js';
import { FeatureView } from './components/FeatureView.js';
import { Header } from './components/Header.js';
import { LibraryView } from './components/LibraryView.js';
import { MatrixOverview } from './components/MatrixOverview.js';
import { Navigation, type TabView } from './components/Navigation.js';
import { RawJsonViewer } from './components/RawJsonViewer.js';
import type { ManifestData, StandaloneBenchmarkResult } from './types.js';

export const App: React.FC = () => {
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [currentTab, setCurrentTab] = useState<TabView>('matrix');
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>('carbon');
  const [selectedFeatureId, setSelectedFeatureId] = useState<string>('css-fuse');
  const [selectedResult, setSelectedResult] = useState<StandaloneBenchmarkResult | null>(null);

  // Parse initial state from URL hash if available
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      const params = new URLSearchParams(hash);
      const tabParam = params.get('tab') as TabView;
      const suiteParam = params.get('suite');
      const featureParam = params.get('feature');

      if (tabParam) setCurrentTab(tabParam);
      if (suiteParam) setSelectedSuiteId(suiteParam);
      if (featureParam) setSelectedFeatureId(featureParam);
    }
  }, []);

  // Update URL hash when state changes
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('tab', currentTab);
    params.set('suite', selectedSuiteId);
    params.set('feature', selectedFeatureId);
    window.history.replaceState(null, '', `#${params.toString()}`);
  }, [currentTab, selectedSuiteId, selectedFeatureId]);

  // Load manifest
  const loadManifest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchManifest();
      setManifest(data);

      // Verify that selectedSuiteId and selectedFeatureId are valid in the manifest
      if (data.libraries.length > 0 && !data.libraries.some((l) => l.id === selectedSuiteId)) {
        setSelectedSuiteId(data.libraries[0].id);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load benchmark manifest');
    } finally {
      setLoading(false);
    }
  }, [selectedSuiteId]);

  useEffect(() => {
    loadManifest();
  }, [loadManifest]);

  // Load selected result JSON dynamically whenever suite or feature changes
  useEffect(() => {
    if (!manifest) return;

    let isMounted = true;

    fetchBenchmarkResult(`${selectedSuiteId}/${selectedFeatureId}.json`)
      .then((res) => {
        if (isMounted) {
          setSelectedResult(res);
        }
      })
      .catch(() => {
        // Fallback: if selected feature result isn't found, try baseline
        if (selectedFeatureId !== 'baseline') {
          fetchBenchmarkResult(`${selectedSuiteId}/baseline.json`)
            .then((res) => {
              if (isMounted) {
                setSelectedResult(res);
              }
            })
            .catch(() => {
              if (isMounted) {
                setSelectedResult(null);
              }
            });
        } else {
          if (isMounted) {
            setSelectedResult(null);
          }
        }
      });

    return () => {
      isMounted = false;
    };
  }, [manifest, selectedSuiteId, selectedFeatureId]);

  const handleSelectRun = (suiteId: string, featureId: string) => {
    setSelectedSuiteId(suiteId);
    setSelectedFeatureId(featureId);
    setCurrentTab('library');
  };

  return (
    <div className="app-container">
      <Header manifest={manifest} onRefresh={loadManifest} loading={loading} />

      <Navigation currentTab={currentTab} onSelectTab={setCurrentTab} />

      <main className="app-content">
        {loading && !manifest && (
          <div className="state-box">
            <div className="spinner" />
            <p>Loading benchmark manifest and results...</p>
          </div>
        )}

        {error && (
          <div className="state-box">
            <span className="state-icon">⚠️</span>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Failed to load benchmark data</h2>
            <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Make sure benchmark results exist in <code>packages/benchmarks/results/manifest.json</code>. Run <code>pnpm run benchmark:carbon</code> to generate results.
            </p>
            <button type="button" className="refresh-button" onClick={loadManifest} style={{ marginTop: '0.75rem' }}>
              Retry
            </button>
          </div>
        )}

        {manifest && (
          <>
            {currentTab === 'matrix' && <MatrixOverview manifest={manifest} onSelectRun={handleSelectRun} />}

            {currentTab === 'library' && (
              <LibraryView
                manifest={manifest}
                selectedSuiteId={selectedSuiteId}
                selectedFeatureId={selectedFeatureId}
                selectedResult={selectedResult}
                onSelectSuite={setSelectedSuiteId}
                onSelectFeature={setSelectedFeatureId}
              />
            )}

            {currentTab === 'feature' && (
              <FeatureView
                manifest={manifest}
                selectedSuiteId={selectedSuiteId}
                selectedFeatureId={selectedFeatureId}
                selectedResult={selectedResult}
                onSelectFeature={setSelectedFeatureId}
                onSelectSuite={setSelectedSuiteId}
              />
            )}

            {currentTab === 'components' && <CanonicalComponentsDrawer manifest={manifest} />}

            {currentTab === 'json' && <RawJsonViewer selectedSuiteId={selectedSuiteId} selectedFeatureId={selectedFeatureId} result={selectedResult} />}
          </>
        )}
      </main>
    </div>
  );
};
