import type { ComponentTestState } from '../audit/test-state.js';

export function renderAuditReportTable(allStates: ComponentTestState[]): string {
  return `
    <div class="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden mb-8 border-none">
      <div class="px-8 py-6">
        <h3 class="text-lg font-medium text-zinc-950 tracking-tight">Component audit status (100 canonical instances)</h3>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-base">
          <thead>
            <tr class="bg-zinc-50/60 border-none">
              <th class="py-4 px-6 text-base font-normal text-zinc-500">#</th>
              <th class="py-4 px-6 text-base font-normal text-zinc-500">Concept</th>
              <th class="py-4 px-6 text-base font-normal text-zinc-500">Library</th>
              <th class="py-4 px-6 text-base font-normal text-zinc-500">Custom element tag</th>
              <th class="py-4 px-6 text-base font-normal text-zinc-500">Custom element registry</th>
              <th class="py-4 px-6 text-base font-normal text-zinc-500">Mounted</th>
              <th class="py-4 px-6 text-base font-normal text-zinc-500">Shadow root</th>
              <th class="py-4 px-6 text-base font-normal text-zinc-500">Interactivity</th>
            </tr>
          </thead>
          <tbody>
            ${allStates
              .map(
                (s, idx) => `
              <tr class="transition-colors hover:bg-zinc-50/60 border-none ${idx % 2 === 1 ? 'bg-zinc-50/30' : 'bg-white'}">
                <td class="py-4 px-6 text-base font-light text-zinc-400">${idx + 1}</td>
                <td class="py-4 px-6 text-base font-normal text-zinc-950">${s.item.conceptLabel}</td>
                <td class="py-4 px-6 text-base font-light text-zinc-600">${s.item.libraryLabel}</td>
                <td class="py-4 px-6">
                  <span class="text-base font-light text-zinc-700 bg-zinc-100 px-3 py-1 rounded-lg font-mono border-none">${s.item.tag}</span>
                </td>
                <td class="py-4 px-6">
                  <span class="inline-flex items-center px-3 py-1 rounded-xl text-base font-light border-none ${s.isDefined ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}">
                    ${s.isDefined ? 'defined' : 'pending'}
                  </span>
                </td>
                <td class="py-4 px-6">
                  <span class="inline-flex items-center px-3 py-1 rounded-xl text-base font-light border-none ${s.isMounted ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}">
                    ${s.isMounted ? 'mounted' : 'unmounted'}
                  </span>
                </td>
                <td class="py-4 px-6">
                  <span class="inline-flex items-center px-3 py-1 rounded-xl text-base font-light border-none ${s.hasShadowRoot ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}">
                    ${s.hasShadowRoot ? 'open shadow' : 'light dom'}
                  </span>
                </td>
                <td class="py-4 px-6">
                  <span class="inline-flex items-center px-3 py-1 rounded-xl text-base font-light border-none ${s.isInteractive ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}">
                    ${s.isInteractive ? 'verified' : 'ready'}
                  </span>
                </td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
