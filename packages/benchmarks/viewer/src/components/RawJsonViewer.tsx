import React, { useState } from 'react';
import type { StandaloneBenchmarkResult } from '../types.js';

interface RawJsonViewerProps {
  selectedSuiteId: string;
  selectedFeatureId: string;
  result: StandaloneBenchmarkResult | null;
}

export const RawJsonViewer: React.FC<RawJsonViewerProps> = ({ selectedSuiteId, selectedFeatureId, result }) => {
  const [copied, setCopied] = useState(false);

  if (!result) {
    return (
      <div className="state-box">
        <p>
          No benchmark data loaded for {selectedSuiteId}/{selectedFeatureId}.json
        </p>
      </div>
    );
  }

  const jsonString = JSON.stringify(result, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedSuiteId}-${selectedFeatureId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="json-viewer-card">
      <div className="json-toolbar">
        <code>
          results/{selectedSuiteId}/{selectedFeatureId}.json
        </code>

        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button type="button" className="btn-secondary" onClick={handleCopy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="btn-secondary" onClick={handleDownload}>
            Download
          </button>
        </div>
      </div>

      <pre className="json-code">
        <code>{jsonString}</code>
      </pre>
    </div>
  );
};
