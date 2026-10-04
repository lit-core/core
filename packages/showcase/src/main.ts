import './styles.css';
import { runInteractiveTests, testStates, updateAuditMetrics } from './audit/test-state.js';
import { ALL_CANONICAL_COMPONENTS, CONCEPTS, LIBRARIES } from './canonical-components.js';
import { renderFilters } from './views/filters.js';
import { renderAuditReportTable } from './views/report.js';

declare const __FEATURE__: string | undefined;

type ViewMode = 'matrix' | 'library' | 'concept' | 'report';

const urlParams = new URLSearchParams(window.location.search);
const activeFeature = (typeof __FEATURE__ !== 'undefined' ? __FEATURE__ : '') || urlParams.get('feature') || 'all';
const paramLib = urlParams.get('lib') || urlParams.get('suite');
const isEmbed = urlParams.get('embed') === 'true' || urlParams.get('embed') === '1';
const isCanvas = urlParams.get('canvas') === 'true' || urlParams.get('canvas') === '1';
const canvasTag = urlParams.get('tag') || '';
const canvasId = urlParams.get('id') || `comp-${canvasTag}`;

let selectedLibrary: string = paramLib && (LIBRARIES.some((l) => l.id === paramLib) || paramLib === 'all') ? paramLib : 'all';
let currentView: ViewMode = (urlParams.get('view') as ViewMode) || (selectedLibrary !== 'all' ? 'library' : 'matrix');
let selectedConcept: string = urlParams.get('concept') || 'all';
let searchQuery: string = urlParams.get('q') || '';

function handleRunInteractiveTests(): Promise<void> {
  return runInteractiveTests(activeFeature, () => renderApp());
}

function renderApp(): void {
  const app = document.getElementById('app');
  if (!app) return;

  if (isCanvas) {
    document.body.style.background = 'transparent';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflow = 'hidden';
    const comp = ALL_CANONICAL_COMPONENTS.find((c) => c.tag === canvasTag);
    app.className = 'w-screen h-screen flex items-center justify-center p-3 bg-transparent';
    app.innerHTML = comp ? comp.renderHtml(canvasId) : `<span class="text-base text-zinc-500 font-sans font-light">${canvasTag || 'Component not found'}</span>`;

    setTimeout(() => {
      const el = document.getElementById(canvasId);
      const isDefined = Boolean(customElements.get(canvasTag));
      const isMounted = Boolean(el);
      const hasShadowRoot = Boolean(el?.shadowRoot);
      window.parent?.postMessage(
        {
          type: 'CANVAS_COMPONENT_AUDIT',
          tag: canvasTag,
          isDefined,
          isMounted,
          hasShadowRoot,
        },
        '*',
      );
    }, 120);
    return;
  }

  const states = Array.from(testStates.values());
  const definedCount = states.filter((s) => s.isDefined).length;
  const mountedCount = states.filter((s) => s.isMounted).length;
  const shadowCount = states.filter((s) => s.hasShadowRoot).length;
  const interactiveCount = states.filter((s) => s.isInteractive).length;

  app.innerHTML = `
    <div class="flex flex-col min-h-screen bg-[#fafafb] text-zinc-950 font-sans">
      ${
        isEmbed
          ? `
        <div class="flex justify-between items-center px-8 py-5 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] mx-8 mt-6">
          <div class="flex items-center gap-4">
            <span class="text-base font-light text-zinc-700 bg-zinc-100 px-3 py-1 rounded-lg font-mono">${activeFeature}</span>
            <span class="text-base font-light text-zinc-500">${selectedLibrary !== 'all' ? LIBRARIES.find((l) => l.id === selectedLibrary)?.name || selectedLibrary : 'All libraries'}</span>
          </div>
          <button type="button" class="inline-flex items-center gap-2 px-5 py-2 text-base font-normal text-white bg-zinc-900 hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer" id="btn-run-tests">
            <svg class="w-4 h-4 stroke-[1.75]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="6 3 20 12 6 21 6 3"></polygon>
            </svg>
            <span>Test interactions</span>
          </button>
        </div>
      `
          : `
      <header class="sticky top-0 z-50 bg-[#fafafb]/90 backdrop-blur-md py-5 border-none">
        <div class="w-full max-w-[1600px] mx-auto px-6 sm:px-10 lg:px-14 flex flex-col md:flex-row items-center justify-between gap-4">
          <div class="flex items-baseline gap-2.5">
            <span class="text-xl font-medium tracking-tight text-zinc-950">lit-core</span>
            <span class="text-zinc-400 font-light text-base">/</span>
            <span class="text-base font-normal text-zinc-600">showcase</span>
            <span class="text-base font-light text-zinc-700 bg-zinc-100 px-3 py-0.5 rounded-lg ml-1 font-mono">${activeFeature}</span>
          </div>

          <nav class="flex items-center gap-1.5 p-1 bg-zinc-100/80 rounded-full border-none">
            <button type="button" class="nav-tab-btn px-5 py-2 text-base rounded-full transition-all cursor-pointer ${currentView === 'library' ? 'bg-white text-zinc-950 font-medium shadow-[0_2px_8px_rgba(0,0,0,0.06)]' : 'text-zinc-600 font-light hover:text-zinc-950'}" data-view="library">
              By library
            </button>
            <button type="button" class="nav-tab-btn px-5 py-2 text-base rounded-full transition-all cursor-pointer ${currentView === 'matrix' ? 'bg-white text-zinc-950 font-medium shadow-[0_2px_8px_rgba(0,0,0,0.06)]' : 'text-zinc-600 font-light hover:text-zinc-950'}" data-view="matrix">
              Matrix view
            </button>
            <button type="button" class="nav-tab-btn px-5 py-2 text-base rounded-full transition-all cursor-pointer ${currentView === 'concept' ? 'bg-white text-zinc-950 font-medium shadow-[0_2px_8px_rgba(0,0,0,0.06)]' : 'text-zinc-600 font-light hover:text-zinc-950'}" data-view="concept">
              By concept
            </button>
            <button type="button" class="nav-tab-btn px-5 py-2 text-base rounded-full transition-all cursor-pointer ${currentView === 'report' ? 'bg-white text-zinc-950 font-medium shadow-[0_2px_8px_rgba(0,0,0,0.06)]' : 'text-zinc-600 font-light hover:text-zinc-950'}" data-view="report">
              Audit report
            </button>
          </nav>

          <div class="flex items-center gap-3">
            <button type="button" class="inline-flex items-center gap-2 px-5 py-2 text-base font-normal text-white bg-zinc-900 hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer" id="btn-run-tests">
              <svg class="w-4 h-4 stroke-[1.75]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="6 3 20 12 6 21 6 3"></polygon>
              </svg>
              <span>Test interactions</span>
            </button>
          </div>
        </div>
      </header>
      `
      }

      <main class="flex-1 py-10 w-full max-w-[1600px] mx-auto px-6 sm:px-10 lg:px-14">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <div class="bg-white rounded-2xl p-6 flex flex-col gap-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] hover:bg-zinc-50/50 transition-all">
            <span class="text-base font-light text-zinc-500">Optimization</span>
            <div class="text-xl font-medium tracking-tight text-zinc-950 truncate">${activeFeature}</div>
            <span class="text-base font-light text-zinc-400">Single feature isolation</span>
          </div>

          <div class="bg-white rounded-2xl p-6 flex flex-col gap-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] hover:bg-zinc-50/50 transition-all">
            <span class="text-base font-light text-zinc-500">Custom elements</span>
            <div class="text-2xl font-light tracking-tight text-zinc-950 tabular-nums" id="metric-defined">${definedCount} / ${states.length}</div>
            <span class="text-base font-light text-zinc-400">Registered in iframe runtime</span>
          </div>

          <div class="bg-white rounded-2xl p-6 flex flex-col gap-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] hover:bg-zinc-50/50 transition-all">
            <span class="text-base font-light text-zinc-500">Mounted instances</span>
            <div class="text-2xl font-light tracking-tight text-zinc-950 tabular-nums" id="metric-mounted">${mountedCount} / ${states.length}</div>
            <span class="text-base font-light text-zinc-400">Active component frames</span>
          </div>

          <div class="bg-white rounded-2xl p-6 flex flex-col gap-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] hover:bg-zinc-50/50 transition-all">
            <span class="text-base font-light text-zinc-500">Encapsulated shadow roots</span>
            <div class="text-2xl font-light tracking-tight text-zinc-950 tabular-nums" id="metric-shadow">${shadowCount} / ${states.length}</div>
            <span class="text-base font-light text-zinc-400">Isolated shadow trees</span>
          </div>

          <div class="bg-white rounded-2xl p-6 flex flex-col gap-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] hover:bg-zinc-50/50 transition-all">
            <span class="text-base font-light text-zinc-500">Interactions</span>
            <div class="text-2xl font-light tracking-tight text-zinc-950 tabular-nums" id="metric-interactive">${interactiveCount} passed</div>
            <span class="text-base font-light text-zinc-400">Event dispatch & response</span>
          </div>
        </div>

        ${renderFilters(currentView, selectedLibrary, selectedConcept, searchQuery)}
        ${renderViewContent()}
      </main>
    </div>
  `;

  attachEventHandlers();
  updateAuditMetrics(activeFeature, handleRunInteractiveTests);
}

function renderViewContent(): string {
  const q = searchQuery.toLowerCase().trim();
  const allStates = Array.from(testStates.values());

  const filteredStates = allStates.filter((s) => {
    if (selectedLibrary !== 'all' && s.item.library !== selectedLibrary) return false;
    if (selectedConcept !== 'all' && s.item.concept !== selectedConcept) return false;
    if (q) {
      return s.item.concept.toLowerCase().includes(q) || s.item.conceptLabel.toLowerCase().includes(q) || s.item.libraryLabel.toLowerCase().includes(q) || s.item.tag.toLowerCase().includes(q);
    }
    return true;
  });

  if (currentView === 'report') {
    return renderAuditReportTable(allStates);
  }

  // Matrix view or filtered cards grouped by concept
  const conceptGroups = CONCEPTS.filter((c) => filteredStates.some((s) => s.item.concept === c.id));

  return conceptGroups
    .map((c) => {
      const groupStates = filteredStates.filter((s) => s.item.concept === c.id);
      return `
        <div class="mb-10">
          <div class="flex justify-between items-baseline mb-4 px-2">
            <h3 class="text-lg font-medium text-zinc-950 tracking-tight">${c.label}</h3>
            <span class="text-base font-light text-zinc-400">${groupStates.length} design systems evaluated</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            ${groupStates
              .map(
                (s) => `
              <div class="component-card bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] hover:bg-zinc-50/40 p-5 flex flex-col justify-between gap-4 transition-all border-none">
                <div class="flex justify-between items-center">
                  <span class="text-base font-medium text-zinc-950">${s.item.libraryLabel}</span>
                  <span class="text-base font-light text-zinc-700 bg-zinc-100 px-3 py-1 rounded-lg font-mono border-none">${s.item.tag}</span>
                </div>

                <div class="p-6 min-h-[150px] flex items-center justify-center bg-zinc-50/80 rounded-xl border-none">
                  ${s.item.renderHtml(s.testId)}
                </div>

                <div class="flex justify-between items-center text-base font-light text-zinc-500 pt-1">
                  <span class="${s.isDefined ? 'text-emerald-700 font-normal' : 'text-zinc-500'}">${s.isDefined ? 'defined' : 'ready'}</span>
                  <span class="inline-flex items-center px-3 py-1 rounded-xl text-base font-light border-none ${s.hasShadowRoot ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}">
                    ${s.hasShadowRoot ? 'shadow DOM' : 'isolated'}
                  </span>
                </div>
              </div>
            `,
              )
              .join('')}
          </div>
        </div>
      `;
    })
    .join('');
}

function attachEventHandlers(): void {
  // Navigation tabs
  document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const view = (e.currentTarget as HTMLElement).dataset.view as ViewMode;
      if (view) {
        currentView = view;
        renderApp();
      }
    });
  });

  // Library filter pills
  document.querySelectorAll('[data-lib]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      selectedLibrary = (e.currentTarget as HTMLElement).dataset.lib || 'all';
      renderApp();
    });
  });

  // Concept filter pills
  document.querySelectorAll('[data-concept]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      selectedConcept = (e.currentTarget as HTMLElement).dataset.concept || 'all';
      renderApp();
    });
  });

  // Search input
  const searchEl = document.getElementById('search-input') as HTMLInputElement | null;
  if (searchEl) {
    searchEl.addEventListener('input', (e) => {
      searchQuery = (e.target as HTMLInputElement).value;
      renderApp();
    });
  }

  // Interactive tests button
  const testBtn = document.getElementById('btn-run-tests');
  if (testBtn) {
    testBtn.addEventListener('click', handleRunInteractiveTests);
  }
}

// Inter-frame postMessage communication
window.addEventListener('message', (event) => {
  if (!event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'SET_LIBRARY' && typeof event.data.library === 'string') {
    selectedLibrary = event.data.library;
    currentView = selectedLibrary !== 'all' ? 'library' : 'matrix';
    renderApp();
  } else if (event.data.type === 'SET_CONCEPT' && typeof event.data.concept === 'string') {
    selectedConcept = event.data.concept;
    currentView = selectedConcept !== 'all' ? 'concept' : 'matrix';
    renderApp();
  } else if (event.data.type === 'RUN_TESTS') {
    handleRunInteractiveTests();
  } else if (event.data.type === 'RUN_CANVAS_TEST') {
    if (isCanvas) {
      const el = document.getElementById(canvasId);
      let clicked = false;
      if (el) {
        try {
          el.addEventListener(
            'click',
            () => {
              clicked = true;
            },
            { once: true },
          );
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } catch {}
      }
      window.parent?.postMessage(
        {
          type: 'CANVAS_COMPONENT_INTERACTIVE',
          tag: canvasTag,
          isInteractive: clicked || Boolean(el),
        },
        '*',
      );
    }
  }
});

// Initial mount
document.addEventListener('DOMContentLoaded', () => {
  renderApp();
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  renderApp();
}
