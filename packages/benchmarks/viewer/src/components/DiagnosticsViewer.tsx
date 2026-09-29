import React from 'react';

interface DiagnosticsViewerProps {
  diagnostics: Record<string, any>;
}

export const DiagnosticsViewer: React.FC<DiagnosticsViewerProps> = ({ diagnostics }) => {
  const entries = Object.entries(diagnostics);
  if (entries.length === 0) return null;

  function formatKey(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toLowerCase())
      .trim();
  }

  function formatVal(val: any): string {
    if (typeof val === 'number') return val.toLocaleString();
    if (typeof val === 'boolean') return val ? 'yes' : 'no';
    if (typeof val === 'object' && val !== null) return JSON.stringify(val);
    return String(val);
  }

  return (
    <div className="table-card">
      <div className="table-header-bar">
        <span className="table-title">Compiler AST diagnostics</span>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Diagnostic metric</th>
              <th className="numeric">Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, val]) => (
              <tr key={key}>
                <td>{formatKey(key)}</td>
                <td className="numeric">
                  <strong>{formatVal(val)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
