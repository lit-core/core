import { Terminal } from 'lucide-react';
import type React from 'react';

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
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-lg font-medium text-zinc-950 tracking-tight flex items-center gap-2.5">
          <Terminal className="w-4 h-4 text-zinc-400 stroke-[1.75]" />
          <span>Compiler AST diagnostics</span>
        </h2>
        <span className="text-base font-light text-zinc-500">{entries.length} metrics evaluated</span>
      </div>

      <div className="bg-white rounded-2xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-base">
            <thead>
              <tr className="bg-zinc-100/75">
                <th className="py-3.5 px-6 text-base font-medium text-zinc-700">Diagnostic metric</th>
                <th className="py-3.5 px-6 text-base font-medium text-zinc-700 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([key, val], idx) => (
                <tr key={key} className={`transition-colors hover:bg-zinc-100/60 ${idx % 2 === 1 ? 'bg-zinc-50/70' : 'bg-white'}`}>
                  <td className="py-3.5 px-6 font-normal text-zinc-900">{formatKey(key)}</td>
                  <td className="py-3.5 px-6 text-right tabular-nums font-light text-zinc-800">{formatVal(val)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
