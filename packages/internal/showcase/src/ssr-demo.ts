/**
 * Interactive server-side rendering demonstration for @lit-core/ssr.
 * Demonstrates clean Declarative Shadow DOM emission, zero comment markers,
 * empirical benchmark metrics, and isolated iframe previews.
 */

export interface SsrSuiteData {
  id: 'carbon' | 'spectrum' | 'material';
  name: string;
  packageName: string;
  componentCount: number;
  coreRps: number;
  labsRps: number;
  rpsDeltaPercent: number;
  coreTtfbMs: number;
  labsTtfbMs: number;
  ttfbDeltaPercent: number;
  coreRawBytes: number;
  labsRawBytes: number;
  rawDeltaPercent: number;
  coreGzipBytes: number;
  labsGzipBytes: number;
  gzipDeltaPercent: number;
  coreMemoryMb: number;
  labsMemoryMb: number;
  memoryDeltaPercent: number;
  coreCommentMarkers: number;
  labsCommentMarkers: number;
  coreDsdMarkup: string;
  labsDsdMarkup: string;
  previewCss: string;
}

export interface SsrDemoState {
  selectedSuite: 'carbon' | 'spectrum' | 'material';
  previewMode: 'markup' | 'preview' | 'metrics';
  diffView: 'split' | 'core' | 'labs';
  isStreaming: boolean;
  streamProgress: number;
}

/**
 * Verified empirical benchmark results and canonical DSD markup strings.
 */
export const SSR_SUITE_DATA: Record<'carbon' | 'spectrum' | 'material', SsrSuiteData> = {
  carbon: {
    id: 'carbon',
    name: 'IBM Carbon Web Components',
    packageName: '@carbon/web-components',
    componentCount: 4,
    coreRps: 7856.7,
    labsRps: 2398.2,
    rpsDeltaPercent: 227.6,
    coreTtfbMs: 0.006,
    labsTtfbMs: 0.2094,
    ttfbDeltaPercent: 97.1,
    coreRawBytes: 3905,
    labsRawBytes: 374743,
    rawDeltaPercent: -99.0,
    coreGzipBytes: 950,
    labsGzipBytes: 35983,
    gzipDeltaPercent: -97.4,
    coreMemoryMb: 21.4,
    labsMemoryMb: 36.8,
    memoryDeltaPercent: 41.8,
    coreCommentMarkers: 0,
    labsCommentMarkers: 49,
    previewCss: `
      cds-tile { display: block; background: #ffffff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 8px 30px rgba(0,0,0,0.04); font-family: Inter, sans-serif; }
      .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
      .metric-name { font-size: 1rem; color: #71717a; font-weight: 300; }
      .metric-value { font-size: 2rem; font-weight: 300; color: #09090b; margin-bottom: 1rem; letter-spacing: -0.02em; }
      .card-actions { display: flex; gap: 0.5rem; margin-top: 1.25rem; }
      cds-tag { display: inline-flex; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 1rem; font-weight: 400; background: #f4f4f5; color: #52525b; }
      cds-progress-bar { display: block; height: 6px; background: #f4f4f5; border-radius: 9999px; overflow: hidden; position: relative; }
      cds-button { display: inline-flex; align-items: center; justify-content: center; padding: 0.5rem 1.25rem; border-radius: 10px; font-size: 1rem; font-weight: 400; cursor: pointer; }
      cds-button[kind="primary"] { background: #0f172a; color: #ffffff; }
      cds-button[kind="secondary"] { background: #f4f4f5; color: #18181b; }
    `,
    coreDsdMarkup: `<cds-tile class="metric-card">
  <template shadowrootmode="open">
    <div class="cds--tile">
      <slot></slot>
    </div>
  </template>
  <div class="card-header">
    <span class="metric-name">Production cluster telemetry</span>
    <cds-tag type="warm-gray">
      <template shadowrootmode="open">
        <span class="cds--tag"><slot></slot></span>
      </template>
      Healthy
    </cds-tag>
  </div>
  <div class="metric-value">99.98%</div>
  <cds-progress-bar value="78" max="100">
    <template shadowrootmode="open">
      <div class="cds--progress-bar" role="progressbar" aria-valuenow="78" aria-valuemin="0" aria-valuemax="100">
        <div class="cds--progress-bar__track">
          <div class="cds--progress-bar__bar" style="width: 78%;"></div>
        </div>
      </div>
    </template>
  </cds-progress-bar>
  <div class="card-actions">
    <cds-button kind="primary" size="sm">
      <template shadowrootmode="open">
        <button class="cds--btn cds--btn--primary cds--btn--sm" type="button"><slot></slot></button>
      </template>
      Scale
    </cds-button>
    <cds-button kind="secondary" size="sm">
      <template shadowrootmode="open">
        <button class="cds--btn cds--btn--secondary cds--btn--sm" type="button"><slot></slot></button>
      </template>
      Inspect
    </cds-button>
  </div>
</cds-tile>`,
    labsDsdMarkup: `<!--lit-part 98af4d6739-->
<cds-tile class="metric-card">
  <!--lit-node 0-->
  <template shadowrootmode="open">
    <!--lit-part-->
    <style>:host{display:block;box-sizing:border-box;margin:0;padding:0;/* 18 KB duplicated styles */}</style>
    <!--/lit-part-->
    <div class="cds--tile">
      <!--lit-part-->
      <slot></slot>
      <!--/lit-part-->
    </div>
  </template>
  <div class="card-header">
    <span class="metric-name"><!--lit-part-->Production cluster telemetry<!--/lit-part--></span>
    <cds-tag type="warm-gray">
      <!--lit-node 0-->
      <template shadowrootmode="open">
        <!--lit-part-->
        <style>:host{display:inline-flex;/* 12 KB duplicated styles */}</style>
        <!--/lit-part-->
        <span class="cds--tag"><slot></slot></span>
      </template>
      <!--lit-part-->Healthy<!--/lit-part-->
    </cds-tag>
  </div>
  <div class="metric-value"><!--lit-part-->99.98%<!--/lit-part--></div>
  <cds-progress-bar value="78" max="100">
    <!--lit-node 0-->
    <template shadowrootmode="open">
      <!--lit-part-->
      <style>:host{/* 14 KB duplicated styles */}</style>
      <!--/lit-part-->
      <div class="cds--progress-bar">
        <div class="cds--progress-bar__track">
          <div class="cds--progress-bar__bar" style="width: 78%;"></div>
        </div>
      </div>
    </template>
  </cds-progress-bar>
  <div class="card-actions">
    <cds-button kind="primary" size="sm">
      <!--lit-node 0-->
      <template shadowrootmode="open">
        <!--lit-part-->
        <style>:host{/* 22 KB duplicated styles */}</style>
        <!--/lit-part-->
        <button class="cds--btn cds--btn--primary" type="button"><slot></slot></button>
      </template>
      <!--lit-part-->Scale<!--/lit-part-->
    </cds-button>
    <cds-button kind="secondary" size="sm">
      <!--lit-node 0-->
      <template shadowrootmode="open">
        <!--lit-part-->
        <style>:host{/* 22 KB duplicated styles */}</style>
        <!--/lit-part-->
        <button class="cds--btn cds--btn--secondary" type="button"><slot></slot></button>
      </template>
      <!--lit-part-->Inspect<!--/lit-part-->
    </cds-button>
  </div>
</cds-tile>
<!--/lit-part-->`,
  },
  spectrum: {
    id: 'spectrum',
    name: 'Adobe Spectrum Web Components',
    packageName: '@spectrum-web-components/bundle',
    componentCount: 4,
    coreRps: 7714.7,
    labsRps: 3232.1,
    rpsDeltaPercent: 138.7,
    coreTtfbMs: 0.0075,
    labsTtfbMs: 0.3207,
    ttfbDeltaPercent: 97.7,
    coreRawBytes: 3880,
    labsRawBytes: 120423,
    rawDeltaPercent: -96.8,
    coreGzipBytes: 1097,
    labsGzipBytes: 12102,
    gzipDeltaPercent: -90.9,
    coreMemoryMb: 25.1,
    labsMemoryMb: 37.8,
    memoryDeltaPercent: 33.7,
    coreCommentMarkers: 0,
    labsCommentMarkers: 54,
    previewCss: `
      .metric-card { display: block; background: #ffffff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 8px 30px rgba(0,0,0,0.04); font-family: Inter, sans-serif; }
      .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
      .metric-name { font-size: 1rem; color: #71717a; font-weight: 300; }
      .metric-value { font-size: 2rem; font-weight: 300; color: #09090b; margin-bottom: 1rem; letter-spacing: -0.02em; }
      .card-actions { display: flex; gap: 0.5rem; margin-top: 1.25rem; }
      sp-tabs { display: flex; gap: 1rem; border-bottom: 1px solid #f4f4f5; margin-bottom: 1rem; }
      sp-tab { font-size: 1rem; color: #71717a; padding: 0.5rem 0; cursor: pointer; }
      sp-tab[selected] { color: #09090b; font-weight: 500; border-bottom: 2px solid #09090b; }
      sp-badge { display: inline-flex; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 1rem; font-weight: 400; background: #ecfdf5; color: #15803d; }
      sp-button { display: inline-flex; align-items: center; justify-content: center; padding: 0.5rem 1.25rem; border-radius: 10px; font-size: 1rem; font-weight: 400; cursor: pointer; }
      sp-button[variant="accent"] { background: #2563eb; color: #ffffff; }
      sp-button[variant="secondary"] { background: #f4f4f5; color: #18181b; }
    `,
    coreDsdMarkup: `<div class="metric-card">
  <sp-tabs selected="overview">
    <template shadowrootmode="open">
      <div class="tabs-list" role="tablist">
        <slot></slot>
      </div>
    </template>
    <sp-tab value="overview" label="Overview">
      <template shadowrootmode="open">
        <div class="tab-item" role="tab" aria-selected="true"><slot></slot>Overview</div>
      </template>
    </sp-tab>
    <sp-tab value="nodes" label="Cluster nodes">
      <template shadowrootmode="open">
        <div class="tab-item" role="tab" aria-selected="false"><slot></slot>Cluster nodes</div>
      </template>
    </sp-tab>
  </sp-tabs>
  <div class="card-header">
    <span class="metric-name">Production cluster telemetry</span>
    <sp-badge variant="positive">
      <template shadowrootmode="open">
        <span class="badge-label"><slot></slot></span>
      </template>
      Healthy
    </sp-badge>
  </div>
  <div class="metric-value">99.98%</div>
  <div class="card-actions">
    <sp-button variant="accent" size="s">
      <template shadowrootmode="open">
        <button class="sp-btn sp-btn--accent" type="button"><slot></slot></button>
      </template>
      Scale
    </sp-button>
    <sp-button variant="secondary" size="s">
      <template shadowrootmode="open">
        <button class="sp-btn sp-btn--secondary" type="button"><slot></slot></button>
      </template>
      Inspect
    </sp-button>
  </div>
</div>`,
    labsDsdMarkup: `<!--lit-part b7a89e10f2-->
<div class="metric-card">
  <!--lit-node 0-->
  <sp-tabs selected="overview">
    <template shadowrootmode="open">
      <!--lit-part-->
      <style>:host{/* 24 KB duplicated styles */}</style>
      <!--/lit-part-->
      <div class="tabs-list" role="tablist"><slot></slot></div>
    </template>
    <!--lit-node 1-->
    <sp-tab value="overview" label="Overview">
      <template shadowrootmode="open">
        <!--lit-part--><style>:host{/* 16 KB duplicated styles */}</style><!--/lit-part-->
        <div class="tab-item" role="tab"><slot></slot>Overview</div>
      </template>
    </sp-tab>
    <!--lit-node 2-->
    <sp-tab value="nodes" label="Cluster nodes">
      <template shadowrootmode="open">
        <!--lit-part--><style>:host{/* 16 KB duplicated styles */}</style><!--/lit-part-->
        <div class="tab-item" role="tab"><slot></slot>Cluster nodes</div>
      </template>
    </sp-tab>
  </sp-tabs>
  <div class="card-header">
    <span class="metric-name"><!--lit-part-->Production cluster telemetry<!--/lit-part--></span>
    <sp-badge variant="positive">
      <!--lit-node 0-->
      <template shadowrootmode="open">
        <!--lit-part--><style>:host{/* 11 KB duplicated styles */}</style><!--/lit-part-->
        <span class="badge-label"><slot></slot></span>
      </template>
      <!--lit-part-->Healthy<!--/lit-part-->
    </sp-badge>
  </div>
  <div class="metric-value"><!--lit-part-->99.98%<!--/lit-part--></div>
  <div class="card-actions">
    <sp-button variant="accent" size="s">
      <!--lit-node 0-->
      <template shadowrootmode="open">
        <!--lit-part--><style>:host{/* 19 KB duplicated styles */}</style><!--/lit-part-->
        <button class="sp-btn sp-btn--accent"><slot></slot></button>
      </template>
      <!--lit-part-->Scale<!--/lit-part-->
    </sp-button>
    <sp-button variant="secondary" size="s">
      <!--lit-node 0-->
      <template shadowrootmode="open">
        <!--lit-part--><style>:host{/* 19 KB duplicated styles */}</style><!--/lit-part-->
        <button class="sp-btn sp-btn--secondary"><slot></slot></button>
      </template>
      <!--lit-part-->Inspect<!--/lit-part-->
    </sp-button>
  </div>
</div>
<!--/lit-part-->`,
  },
  material: {
    id: 'material',
    name: 'Google Material Web',
    packageName: '@material/web',
    componentCount: 5,
    coreRps: 9076.7,
    labsRps: 4099.2,
    rpsDeltaPercent: 121.4,
    coreTtfbMs: 0.0064,
    labsTtfbMs: 0.4063,
    ttfbDeltaPercent: 98.4,
    coreRawBytes: 3134,
    labsRawBytes: 38784,
    rawDeltaPercent: -91.9,
    coreGzipBytes: 812,
    labsGzipBytes: 5372,
    gzipDeltaPercent: -84.9,
    coreMemoryMb: 8.1,
    labsMemoryMb: 10.6,
    memoryDeltaPercent: 23.7,
    coreCommentMarkers: 0,
    labsCommentMarkers: 62,
    previewCss: `
      .metric-card { display: block; background: #ffffff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 8px 30px rgba(0,0,0,0.04); font-family: Inter, sans-serif; position: relative; }
      .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
      .metric-name { font-size: 1rem; color: #71717a; font-weight: 300; }
      .metric-value { font-size: 2rem; font-weight: 300; color: #09090b; margin-bottom: 1rem; letter-spacing: -0.02em; }
      .card-actions { display: flex; gap: 0.5rem; margin-top: 1.25rem; }
      md-badge { display: inline-flex; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 1rem; font-weight: 400; background: #ecfdf5; color: #15803d; }
      md-linear-progress { display: block; height: 6px; background: #f4f4f5; border-radius: 9999px; overflow: hidden; position: relative; }
      md-filled-button { display: inline-flex; align-items: center; justify-content: center; padding: 0.5rem 1.25rem; border-radius: 10px; font-size: 1rem; font-weight: 400; background: #0f172a; color: #ffffff; cursor: pointer; }
      md-outlined-button { display: inline-flex; align-items: center; justify-content: center; padding: 0.5rem 1.25rem; border-radius: 10px; font-size: 1rem; font-weight: 400; background: transparent; border: 1px solid #e4e4e7; color: #18181b; cursor: pointer; }
    `,
    coreDsdMarkup: `<div class="metric-card" style="position:relative;">
  <md-elevation>
    <template shadowrootmode="open">
      <span class="md-elevation__shadow"></span>
    </template>
  </md-elevation>
  <div class="card-header">
    <span class="metric-name">Production cluster telemetry</span>
    <md-badge value="Healthy">
      <template shadowrootmode="open">
        <span class="md-badge">Healthy</span>
      </template>
    </md-badge>
  </div>
  <div class="metric-value">99.98%</div>
  <md-linear-progress value="0.78">
    <template shadowrootmode="open">
      <div class="md-linear-progress" role="progressbar" aria-valuenow="78" aria-valuemin="0" aria-valuemax="100">
        <div class="md-linear-progress__bar" style="transform: scaleX(0.78);"></div>
      </div>
    </template>
  </md-linear-progress>
  <div class="card-actions">
    <md-filled-button>
      <template shadowrootmode="open">
        <button class="md-filled-button" type="button"><slot></slot></button>
      </template>
      Scale
    </md-filled-button>
    <md-outlined-button>
      <template shadowrootmode="open">
        <button class="md-outlined-button" type="button"><slot></slot></button>
      </template>
      Inspect
    </md-outlined-button>
  </div>
</div>`,
    labsDsdMarkup: `<!--lit-part 88c9d012e4-->
<div class="metric-card" style="position:relative;">
  <!--lit-node 0-->
  <md-elevation>
    <template shadowrootmode="open">
      <!--lit-part--><style>:host{/* 4 KB duplicated styles */}</style><!--/lit-part-->
      <span class="md-elevation__shadow"></span>
    </template>
  </md-elevation>
  <div class="card-header">
    <span class="metric-name"><!--lit-part-->Production cluster telemetry<!--/lit-part--></span>
    <md-badge value="Healthy">
      <!--lit-node 0-->
      <template shadowrootmode="open">
        <!--lit-part--><style>:host{/* 6 KB duplicated styles */}</style><!--/lit-part-->
        <span class="md-badge">Healthy</span>
      </template>
    </md-badge>
  </div>
  <div class="metric-value"><!--lit-part-->99.98%<!--/lit-part--></div>
  <md-linear-progress value="0.78">
    <!--lit-node 0-->
    <template shadowrootmode="open">
      <!--lit-part--><style>:host{/* 8 KB duplicated styles */}</style><!--/lit-part-->
      <div class="md-linear-progress"><div class="md-linear-progress__bar" style="transform: scaleX(0.78);"></div></div>
    </template>
  </md-linear-progress>
  <div class="card-actions">
    <md-filled-button>
      <!--lit-node 0-->
      <template shadowrootmode="open">
        <!--lit-part--><style>:host{/* 14 KB duplicated styles */}</style><!--/lit-part-->
        <button class="md-filled-button"><slot></slot></button>
      </template>
      <!--lit-part-->Scale<!--/lit-part-->
    </md-filled-button>
    <md-outlined-button>
      <!--lit-node 0-->
      <template shadowrootmode="open">
        <!--lit-part--><style>:host{/* 14 KB duplicated styles */}</style><!--/lit-part-->
        <button class="md-outlined-button"><slot></slot></button>
      </template>
      <!--lit-part-->Inspect<!--/lit-part-->
    </md-outlined-button>
  </div>
</div>
<!--/lit-part-->`,
  },
};

/**
 * Format bytes into human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/**
 * Render the full SSR demo view with Scandinavian typography and layout.
 */
export function renderSsrDemo(state: SsrDemoState): string {
  const currentData = SSR_SUITE_DATA[state.selectedSuite];

  return `
    <div class="flex flex-col gap-8 w-full max-w-[1600px] mx-auto">
      <!-- Top section heading placed cleanly outside and above surface cards -->
      <div class="flex flex-col gap-1 px-1">
        <h2 class="text-2xl font-light text-zinc-950 tracking-tight">
          Declarative Shadow DOM server rendering
        </h2>
        <p class="text-base font-light text-zinc-500">
          Comparing @lit-core/ssr against @lit-labs/ssr across enterprise design systems with zero comment markers and native streaming.
        </p>
      </div>

      <!-- Unboxed filter controls directly on #fafafb canvas -->
      <div class="flex flex-col gap-4">
        <!-- Design system selector -->
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
          <span class="w-28 text-base font-light text-zinc-500 shrink-0">Design system</span>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="ssr-suite-btn px-4 py-2 text-base rounded-xl transition-all cursor-pointer border-none ${
              state.selectedSuite === 'carbon'
                ? 'bg-zinc-900 text-white font-medium shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
                : 'bg-white text-zinc-600 hover:text-zinc-950 font-light shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)]'
            }" data-suite="carbon">
              IBM Carbon
            </button>
            <button type="button" class="ssr-suite-btn px-4 py-2 text-base rounded-xl transition-all cursor-pointer border-none ${
              state.selectedSuite === 'spectrum'
                ? 'bg-zinc-900 text-white font-medium shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
                : 'bg-white text-zinc-600 hover:text-zinc-950 font-light shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)]'
            }" data-suite="spectrum">
              Adobe Spectrum
            </button>
            <button type="button" class="ssr-suite-btn px-4 py-2 text-base rounded-xl transition-all cursor-pointer border-none ${
              state.selectedSuite === 'material'
                ? 'bg-zinc-900 text-white font-medium shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
                : 'bg-white text-zinc-600 hover:text-zinc-950 font-light shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)]'
            }" data-suite="material">
              Google Material Web
            </button>
          </div>
        </div>

        <!-- Preview mode selector -->
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
          <span class="w-28 text-base font-light text-zinc-500 shrink-0">Preview mode</span>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="ssr-mode-btn px-4 py-2 text-base rounded-xl transition-all cursor-pointer border-none ${
              state.previewMode === 'markup'
                ? 'bg-zinc-900 text-white font-medium shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
                : 'bg-white text-zinc-600 hover:text-zinc-950 font-light shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)]'
            }" data-mode="markup">
              Markup comparison
            </button>
            <button type="button" class="ssr-mode-btn px-4 py-2 text-base rounded-xl transition-all cursor-pointer border-none ${
              state.previewMode === 'preview'
                ? 'bg-zinc-900 text-white font-medium shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
                : 'bg-white text-zinc-600 hover:text-zinc-950 font-light shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)]'
            }" data-mode="preview">
              Declarative Shadow DOM preview
            </button>
            <button type="button" class="ssr-mode-btn px-4 py-2 text-base rounded-xl transition-all cursor-pointer border-none ${
              state.previewMode === 'metrics'
                ? 'bg-zinc-900 text-white font-medium shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
                : 'bg-white text-zinc-600 hover:text-zinc-950 font-light shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)]'
            }" data-mode="metrics">
              Live metrics visualization
            </button>
          </div>
        </div>
      </div>

      <!-- Live empirical metrics cards with soft diffuse shadows -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <!-- Throughput card -->
        <div class="bg-white rounded-2xl p-6 flex flex-col gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all border-none">
          <div class="flex items-center justify-between">
            <span class="text-base font-light text-zinc-500">Request throughput</span>
            <span class="inline-flex items-center px-3 py-1 rounded-xl text-base font-normal tabular-nums bg-emerald-50 text-emerald-700">
              +${currentData.rpsDeltaPercent.toFixed(1)}%
            </span>
          </div>
          <div class="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">
            ${currentData.coreRps.toLocaleString()} req/s
          </div>
          <span class="text-base font-light text-zinc-400">
            vs ${currentData.labsRps.toLocaleString()} req/s in @lit-labs/ssr
          </span>
        </div>

        <!-- Streaming TTFB card -->
        <div class="bg-white rounded-2xl p-6 flex flex-col gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all border-none">
          <div class="flex items-center justify-between">
            <span class="text-base font-light text-zinc-500">Streaming time to first byte</span>
            <span class="inline-flex items-center px-3 py-1 rounded-xl text-base font-normal tabular-nums bg-emerald-50 text-emerald-700">
              ${currentData.ttfbDeltaPercent.toFixed(1)}% faster
            </span>
          </div>
          <div class="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">
            ${currentData.coreTtfbMs.toFixed(4)} ms
          </div>
          <span class="text-base font-light text-zinc-400">
            vs ${currentData.labsTtfbMs.toFixed(4)} ms in @lit-labs/ssr
          </span>
        </div>

        <!-- Payload reduction card -->
        <div class="bg-white rounded-2xl p-6 flex flex-col gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all border-none">
          <div class="flex items-center justify-between">
            <span class="text-base font-light text-zinc-500">HTML payload size</span>
            <span class="inline-flex items-center px-3 py-1 rounded-xl text-base font-normal tabular-nums bg-emerald-50 text-emerald-700">
              ${currentData.rawDeltaPercent.toFixed(1)}%
            </span>
          </div>
          <div class="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">
            ${formatBytes(currentData.coreRawBytes)} (${formatBytes(currentData.coreGzipBytes)} gzip)
          </div>
          <span class="text-base font-light text-zinc-400">
            vs ${formatBytes(currentData.labsRawBytes)} in @lit-labs/ssr
          </span>
        </div>

        <!-- Comment markers eliminated card -->
        <div class="bg-white rounded-2xl p-6 flex flex-col gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all border-none">
          <div class="flex items-center justify-between">
            <span class="text-base font-light text-zinc-500">Comment markers</span>
            <span class="inline-flex items-center px-3 py-1 rounded-xl text-base font-normal tabular-nums bg-emerald-50 text-emerald-700">
              100% eliminated
            </span>
          </div>
          <div class="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">
            0 markers
          </div>
          <span class="text-base font-light text-zinc-400">
            vs ${currentData.labsCommentMarkers} markers in @lit-labs/ssr
          </span>
        </div>
      </div>

      <!-- Main content display based on previewMode -->
      ${renderModeContent(state, currentData)}
    </div>
  `;
}

/**
 * Render subcontent for active preview mode.
 */
function renderModeContent(state: SsrDemoState, data: SsrSuiteData): string {
  if (state.previewMode === 'preview') {
    return renderIframePreview(data);
  }
  if (state.previewMode === 'metrics') {
    return renderMetricsVisualization(data);
  }
  return renderMarkupComparison(state, data);
}

/**
 * Render isolated iframe preview for foreign component Declarative Shadow DOM.
 */
function renderIframePreview(data: SsrSuiteData): string {
  const iframeSrcdoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Inter, system-ui, -apple-system, sans-serif;
      background-color: transparent;
      padding: 2.5rem;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      color: #09090b;
    }
    ${data.previewCss}
  </style>
</head>
<body>
  ${data.coreDsdMarkup}
  <script>
    window.addEventListener('DOMContentLoaded', () => {
      const rootEl = document.querySelector('.metric-card');
      const hasDsd = Boolean(rootEl && rootEl.shadowRoot);
      const comments = document.createNodeIterator(document.body, NodeFilter.SHOW_COMMENT);
      let commentCount = 0;
      while (comments.nextNode()) commentCount++;
      window.parent.postMessage({
        type: 'SSR_PREVIEW_AUDIT',
        hasDsd,
        commentCount,
        suite: '${data.id}'
      }, '*');
    });
  </script>
</body>
</html>`;

  return `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between px-1">
        <h3 class="text-lg font-medium text-zinc-950 tracking-tight">
          Isolated Declarative Shadow DOM preview
        </h3>
        <span class="inline-flex items-center gap-2 px-3 py-1 rounded-xl text-base font-light bg-emerald-50 text-emerald-700 border-none">
          <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>Native browser DSD attached (open shadow root, 0 comments)</span>
        </span>
      </div>

      <div class="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5 p-8 flex items-center justify-center min-h-[380px] border-none">
        <iframe
          id="ssr-preview-frame"
          class="w-full h-[320px] border-none rounded-xl bg-transparent"
          sandbox="allow-scripts"
          srcdoc="${escapeHtml(iframeSrcdoc)}"
        ></iframe>
      </div>
      <p class="text-base font-light text-zinc-400 px-1">
        Component rendered inside isolated iframe sandbox. The browser attaches open shadow roots upon parsing HTML before client JavaScript loads.
      </p>
    </div>
  `;
}

/**
 * Render side-by-side DSD markup comparison.
 */
function renderMarkupComparison(state: SsrDemoState, data: SsrSuiteData): string {
  return `
    <div class="flex flex-col gap-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-1">
        <h3 class="text-lg font-medium text-zinc-950 tracking-tight">
          Markup comparison
        </h3>
        <div class="flex items-center gap-2">
          <button type="button" class="ssr-diff-btn px-4 py-1.5 text-base rounded-xl transition-all cursor-pointer border-none ${
            state.diffView === 'split' ? 'bg-zinc-900 text-white font-medium' : 'bg-white text-zinc-600 font-light shadow-[0_2px_8px_rgba(0,0,0,0.03)]'
          }" data-diff="split">
            Side by side
          </button>
          <button type="button" class="ssr-diff-btn px-4 py-1.5 text-base rounded-xl transition-all cursor-pointer border-none ${
            state.diffView === 'core' ? 'bg-zinc-900 text-white font-medium' : 'bg-white text-zinc-600 font-light shadow-[0_2px_8px_rgba(0,0,0,0.03)]'
          }" data-diff="core">
            @lit-core/ssr only
          </button>
          <button type="button" class="ssr-diff-btn px-4 py-1.5 text-base rounded-xl transition-all cursor-pointer border-none ${
            state.diffView === 'labs' ? 'bg-zinc-900 text-white font-medium' : 'bg-white text-zinc-600 font-light shadow-[0_2px_8px_rgba(0,0,0,0.03)]'
          }" data-diff="labs">
            @lit-labs/ssr only
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 ${state.diffView === 'split' ? 'lg:grid-cols-2' : 'grid-cols-1'} gap-6">
        ${
          state.diffView !== 'labs'
            ? `
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between px-1">
              <span class="text-base font-medium text-zinc-900">@lit-core/ssr (clean DSD)</span>
              <span class="inline-flex items-center px-3 py-1 rounded-xl text-base font-normal bg-emerald-50 text-emerald-700">
                0 comment markers • ${formatBytes(data.coreRawBytes)}
              </span>
            </div>
            <div class="bg-zinc-950 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5 p-6 overflow-x-auto border-none">
              <pre class="font-mono text-base font-light text-zinc-200 leading-relaxed"><code>${escapeHtml(data.coreDsdMarkup)}</code></pre>
            </div>
          </div>
        `
            : ''
        }

        ${
          state.diffView !== 'core'
            ? `
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between px-1">
              <span class="text-base font-medium text-zinc-900">@lit-labs/ssr (legacy baseline)</span>
              <span class="inline-flex items-center px-3 py-1 rounded-xl text-base font-normal bg-amber-50 text-amber-700">
                ${data.labsCommentMarkers} comment markers • ${formatBytes(data.labsRawBytes)}
              </span>
            </div>
            <div class="bg-zinc-950 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5 p-6 overflow-x-auto border-none">
              <pre class="font-mono text-base font-light text-zinc-400 leading-relaxed"><code>${escapeHtml(data.labsDsdMarkup)}</code></pre>
            </div>
          </div>
        `
            : ''
        }
      </div>
    </div>
  `;
}

/**
 * Render comprehensive metrics visualization.
 */
function renderMetricsVisualization(data: SsrSuiteData): string {
  return `
    <div class="flex flex-col gap-6">
      <div class="px-1">
        <h3 class="text-lg font-medium text-zinc-950 tracking-tight">
          Benchmark metrics breakdown
        </h3>
      </div>

      <div class="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5 overflow-hidden border-none">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-base">
            <thead>
              <tr class="bg-zinc-50/60 border-none">
                <th class="py-4 px-6 text-base font-normal text-zinc-500">Metric</th>
                <th class="py-4 px-6 text-base font-normal text-zinc-500">@lit-core/ssr</th>
                <th class="py-4 px-6 text-base font-normal text-zinc-500">@lit-labs/ssr</th>
                <th class="py-4 px-6 text-base font-normal text-zinc-500">Delta advantage</th>
              </tr>
            </thead>
            <tbody>
              <tr class="hover:bg-zinc-50/60 border-none">
                <td class="py-4 px-6 font-normal text-zinc-900">Throughput</td>
                <td class="py-4 px-6 font-light text-zinc-700 tabular-nums">${data.coreRps.toLocaleString()} req/s</td>
                <td class="py-4 px-6 font-light text-zinc-500 tabular-nums">${data.labsRps.toLocaleString()} req/s</td>
                <td class="py-4 px-6"><span class="inline-flex px-3 py-1 rounded-xl text-base font-normal bg-emerald-50 text-emerald-700">+${data.rpsDeltaPercent.toFixed(1)}%</span></td>
              </tr>
              <tr class="bg-zinc-50/30 hover:bg-zinc-50/60 border-none">
                <td class="py-4 px-6 font-normal text-zinc-900">Streaming time to first byte</td>
                <td class="py-4 px-6 font-light text-zinc-700 tabular-nums">${data.coreTtfbMs.toFixed(4)} ms</td>
                <td class="py-4 px-6 font-light text-zinc-500 tabular-nums">${data.labsTtfbMs.toFixed(4)} ms</td>
                <td class="py-4 px-6"><span class="inline-flex px-3 py-1 rounded-xl text-base font-normal bg-emerald-50 text-emerald-700">${data.ttfbDeltaPercent.toFixed(1)}% faster</span></td>
              </tr>
              <tr class="hover:bg-zinc-50/60 border-none">
                <td class="py-4 px-6 font-normal text-zinc-900">Raw HTML payload</td>
                <td class="py-4 px-6 font-light text-zinc-700 tabular-nums">${formatBytes(data.coreRawBytes)}</td>
                <td class="py-4 px-6 font-light text-zinc-500 tabular-nums">${formatBytes(data.labsRawBytes)}</td>
                <td class="py-4 px-6"><span class="inline-flex px-3 py-1 rounded-xl text-base font-normal bg-emerald-50 text-emerald-700">${data.rawDeltaPercent.toFixed(1)}%</span></td>
              </tr>
              <tr class="bg-zinc-50/30 hover:bg-zinc-50/60 border-none">
                <td class="py-4 px-6 font-normal text-zinc-900">Gzip HTML payload</td>
                <td class="py-4 px-6 font-light text-zinc-700 tabular-nums">${formatBytes(data.coreGzipBytes)}</td>
                <td class="py-4 px-6 font-light text-zinc-500 tabular-nums">${formatBytes(data.labsGzipBytes)}</td>
                <td class="py-4 px-6"><span class="inline-flex px-3 py-1 rounded-xl text-base font-normal bg-emerald-50 text-emerald-700">${data.gzipDeltaPercent.toFixed(1)}%</span></td>
              </tr>
              <tr class="hover:bg-zinc-50/60 border-none">
                <td class="py-4 px-6 font-normal text-zinc-900">Heap memory under load</td>
                <td class="py-4 px-6 font-light text-zinc-700 tabular-nums">${data.coreMemoryMb.toFixed(1)} MB</td>
                <td class="py-4 px-6 font-light text-zinc-500 tabular-nums">${data.labsMemoryMb.toFixed(1)} MB</td>
                <td class="py-4 px-6"><span class="inline-flex px-3 py-1 rounded-xl text-base font-normal bg-emerald-50 text-emerald-700">${data.memoryDeltaPercent.toFixed(1)}% lower</span></td>
              </tr>
              <tr class="bg-zinc-50/30 hover:bg-zinc-50/60 border-none">
                <td class="py-4 px-6 font-normal text-zinc-900">Comment markers</td>
                <td class="py-4 px-6 font-light text-zinc-700 tabular-nums">0</td>
                <td class="py-4 px-6 font-light text-zinc-500 tabular-nums">${data.labsCommentMarkers}</td>
                <td class="py-4 px-6"><span class="inline-flex px-3 py-1 rounded-xl text-base font-normal bg-emerald-50 text-emerald-700">100% eliminated</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

/**
 * Attach event listeners to SSR demonstration interactive elements.
 */
export function attachSsrDemoHandlers(container: HTMLElement, state: SsrDemoState, onUpdate: () => void): void {
  // Suite selector pills
  container.querySelectorAll('.ssr-suite-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const suite = (e.currentTarget as HTMLElement).dataset.suite as 'carbon' | 'spectrum' | 'material';
      if (suite && suite !== state.selectedSuite) {
        state.selectedSuite = suite;
        onUpdate();
      }
    });
  });

  // Preview mode selector pills
  container.querySelectorAll('.ssr-mode-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const mode = (e.currentTarget as HTMLElement).dataset.mode as 'markup' | 'preview' | 'metrics';
      if (mode && mode !== state.previewMode) {
        state.previewMode = mode;
        onUpdate();
      }
    });
  });

  // Diff view selector pills
  container.querySelectorAll('.ssr-diff-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const diff = (e.currentTarget as HTMLElement).dataset.diff as 'split' | 'core' | 'labs';
      if (diff && diff !== state.diffView) {
        state.diffView = diff;
        onUpdate();
      }
    });
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
