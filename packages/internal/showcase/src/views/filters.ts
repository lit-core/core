import { CONCEPTS, LIBRARIES } from '../canonical-components.js';

export function renderFilters(currentView: string, selectedLibrary: string, selectedConcept: string, searchQuery: string): string {
  if (currentView === 'report') return '';

  return `
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
      ${
        currentView === 'library'
          ? `
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
          <span class="w-28 text-base font-light text-zinc-500 shrink-0">Library</span>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="px-4 py-2 text-base rounded-xl transition-all cursor-pointer border-none ${selectedLibrary === 'all' ? 'bg-zinc-900 text-white font-medium shadow-[0_2px_8px_rgba(0,0,0,0.12)]' : 'bg-white text-zinc-600 hover:text-zinc-950 font-light shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)]'}" data-lib="all">All libraries</button>
            ${LIBRARIES.map(
              (l) => `
              <button type="button" class="px-4 py-2 text-base rounded-xl transition-all cursor-pointer border-none ${selectedLibrary === l.id ? 'bg-zinc-900 text-white font-medium shadow-[0_2px_8px_rgba(0,0,0,0.12)]' : 'bg-white text-zinc-600 hover:text-zinc-950 font-light shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)]'}" data-lib="${l.id}">${l.name}</button>
            `,
            ).join('')}
          </div>
        </div>
      `
          : ''
      }

      ${
        currentView === 'concept'
          ? `
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
          <span class="w-28 text-base font-light text-zinc-500 shrink-0">Concept</span>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="px-4 py-2 text-base rounded-xl transition-all cursor-pointer border-none ${selectedConcept === 'all' ? 'bg-zinc-900 text-white font-medium shadow-[0_2px_8px_rgba(0,0,0,0.12)]' : 'bg-white text-zinc-600 hover:text-zinc-950 font-light shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)]'}" data-concept="all">All concepts</button>
            ${CONCEPTS.map(
              (c) => `
              <button type="button" class="px-4 py-2 text-base rounded-xl transition-all cursor-pointer border-none ${selectedConcept === c.id ? 'bg-zinc-900 text-white font-medium shadow-[0_2px_8px_rgba(0,0,0,0.12)]' : 'bg-white text-zinc-600 hover:text-zinc-950 font-light shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)]'}" data-concept="${c.id}">${c.label}</button>
            `,
            ).join('')}
          </div>
        </div>
      `
          : ''
      }

      <div class="flex items-center gap-3">
        <div class="relative flex items-center">
          <svg class="w-4 h-4 text-zinc-400 absolute left-3.5 pointer-events-none stroke-[1.5]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.3-4.3"></path>
          </svg>
          <input type="search" class="pl-10 pr-4 py-2 text-base bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-xl text-zinc-950 placeholder:text-zinc-400 outline-none w-64 font-light border-none transition-all focus:ring-2 focus:ring-zinc-900/10" id="search-input" placeholder="Search components or tags..." value="${searchQuery}" />
        </div>
      </div>
    </div>
  `;
}
