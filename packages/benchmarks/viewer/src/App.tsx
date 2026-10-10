import { AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { fetchBenchmarkResult, fetchManifest } from './api/client.js';
import { FeatureView } from './components/FeatureView.js';
import { Header } from './components/Header.js';
import { LibraryView } from './components/LibraryView.js';
import { MatrixOverview } from './components/MatrixOverview.js';
import type { TabView } from './components/Navigation.js';
import { ScenarioView } from './components/ScenarioView.js';
import { ShowcaseViewer } from './components/ShowcaseViewer.js';
import type { ManifestData, StandaloneBenchmarkResult } from './types.js';

export const App: React.FC = () => {
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [currentTab, setCurrentTab] = useState<TabView>('matrix');
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>('carbon');
  const [selectedFeatureId, setSelectedFeatureId] = useState<string>('all');
  const [selectedResult, setSelectedResult] = useState<StandaloneBenchmarkResult | null>(null);

  // Parse initial state from URL hash if available
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      const params = new URLSearchParams(hash);
      const tabParam = params.get('tab') as TabView;
      const suiteParam = params.get('suite');
      const featureParam = params.get('feature');

      if (tabParam && ['matrix', 'scenario', 'library', 'feature', 'showcase'].includes(tabParam)) setCurrentTab(tabParam);
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
    <div className="flex flex-col min-h-screen bg-white text-zinc-900 font-sans">
      <Header currentTab={currentTab} onSelectTab={setCurrentTab} />

      <main className="flex-1 w-full max-w-[1600px] mx-auto px-6 sm:px-10 lg:px-14 py-8">
        {loading && !manifest && (
          <div className="flex flex-col items-center justify-center p-20 gap-4 text-zinc-600">
            <Loader2 className="w-8 h-8 text-zinc-900 animate-spin stroke-[1.5]" />
            <p className="text-base font-normal">Loading benchmark manifest and results...</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center p-16 gap-3 text-center bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5">
            <AlertCircle className="w-8 h-8 text-rose-500 stroke-[1.75]" />
            <h2 className="text-lg font-medium text-zinc-950 tracking-tight">Failed to load benchmark data</h2>
            <p className="text-base font-normal text-zinc-600 max-w-md">{error}</p>
            <p className="text-base font-light text-zinc-500 max-w-lg leading-relaxed">
              Make sure benchmark results exist in results/manifest.json. Run pnpm run benchmark:carbon to generate results.
            </p>
            <button
              type="button"
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 text-base font-medium text-zinc-800 bg-zinc-100/90 hover:bg-zinc-200/80 rounded-xl transition-all shadow-none cursor-pointer"
              onClick={loadManifest}
            >
              <RotateCcw className="w-4 h-4 stroke-[1.75]" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {manifest && (
          <>
            {currentTab === 'matrix' && <MatrixOverview manifest={manifest} onSelectRun={handleSelectRun} onOpenScenarioView={() => setCurrentTab('scenario')} />}

            {currentTab === 'scenario' && (
              <ScenarioView
                manifest={manifest}
                selectedSuiteId={selectedSuiteId}
                onSelectSuite={setSelectedSuiteId}
                onSelectFeature={(featId) => {
                  setSelectedFeatureId(featId);
                  setCurrentTab('feature');
                }}
                onOpenFeatureView={() => setCurrentTab('feature')}
              />
            )}

            {currentTab === 'library' && (
              <LibraryView
                manifest={manifest}
                selectedSuiteId={selectedSuiteId}
                selectedFeatureId={selectedFeatureId}
                selectedResult={selectedResult}
                onSelectSuite={setSelectedSuiteId}
                onSelectFeature={setSelectedFeatureId}
                onOpenShowcase={() => setCurrentTab('showcase')}
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
                onOpenShowcase={() => setCurrentTab('showcase')}
                onOpenScenario={() => setCurrentTab('scenario')}
              />
            )}

            {currentTab === 'showcase' && (
              <ShowcaseViewer manifest={manifest} selectedSuiteId={selectedSuiteId} selectedFeatureId={selectedFeatureId} onSelectSuite={setSelectedSuiteId} onSelectFeature={setSelectedFeatureId} />
            )}
          </>
        )}
      </main>
    </div>
  );
};
