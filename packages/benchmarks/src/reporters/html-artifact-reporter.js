import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDuration, formatKb, formatNumber } from '../format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultArtifactsBaseDir = path.resolve(__dirname, '../../artifacts');

/**
 * Escape bundle code to be safely embedded within an HTML script tag.
 * @param {string} code
 * @returns {string}
 */
export function escapeScriptContent(code) {
  return code.replace(/<\/script>/gi, '<\\/script>');
}

/**
 * Escape string for safe insertion into HTML text.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Attempt to locate and inline package theme stylesheets if available.
 * @param {string} [packageDir]
 * @returns {string}
 */
export function resolveThemeCss(packageDir) {
  const rootDir = path.resolve(__dirname, '../../../..');

  // Carbon theme styles
  if (packageDir && packageDir.includes('carbon')) {
    const carbonStylesPath = path.resolve(rootDir, 'node_modules/@carbon/styles/css/styles.css');
    if (fs.existsSync(carbonStylesPath)) {
      try {
        return fs.readFileSync(carbonStylesPath, 'utf-8');
      } catch {}
    }
  }

  if (!packageDir || !fs.existsSync(packageDir)) {
    return '';
  }

  // Web Awesome theme styles
  const waThemes = path.join(packageDir, 'dist/styles/themes/default.css');
  if (fs.existsSync(waThemes)) {
    try {
      const stylesDir = path.join(packageDir, 'dist/styles');
      const layersPath = path.join(stylesDir, 'layers.css');
      const palettePath = path.join(stylesDir, 'color/palettes/default.css');

      const layers = fs.existsSync(layersPath) ? fs.readFileSync(layersPath, 'utf-8') : '';
      const palette = fs.existsSync(palettePath) ? fs.readFileSync(palettePath, 'utf-8') : '';
      let theme = fs.readFileSync(waThemes, 'utf-8');
      theme = theme.replace(/@import\s+url\([^)]+\);/g, '');

      return [layers, palette, theme].filter(Boolean).join('\n');
    } catch {
      return '';
    }
  }

  return '';
}

/**
 * Generate a self-contained inline HTML string for a benchmark bundle.
 * @param {Object} options
 * @param {string} options.bundleCode
 * @param {string} options.suiteName
 * @param {string} options.suiteId
 * @param {string} options.variant
 * @param {Partial<import('../metrics.js').SizeMetrics>} [options.metrics]
 * @param {Record<string, any>} [options.metadata]
 * @param {string} [options.themeCss]
 * @returns {string}
 */
export function generateArtifactHtml({ bundleCode, suiteName, suiteId, variant, metrics = {}, metadata = {}, themeCss = '' }) {
  const timestamp = new Date().toISOString();
  const rawBytes = metrics.rawBytes || 0;
  const gzipBytes = metrics.gzipBytes || 0;
  const buildTimeMs = metrics.buildTimeMs || 0;
  const componentCount = metadata.componentCount || (metadata.components ? metadata.components.length : 0);

  const formattedRaw = formatKb(rawBytes);
  const formattedGzip = formatKb(gzipBytes);
  const formattedBuildTime = formatDuration(buildTimeMs);

  const safeBundleCode = escapeScriptContent(bundleCode);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Benchmark artifact: ${escapeHtml(suiteName)} (${escapeHtml(variant)})</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0284c7;
      --success: #34d399;
      --warning: #fbbf24;
      --danger: #f87171;
      --stage-bg: #0b1329;
      --stage-dot: #1e293b;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f8fafc;
        --card-bg: #ffffff;
        --border: #e2e8f0;
        --text: #0f172a;
        --text-muted: #64748b;
        --accent: #0284c7;
        --accent-hover: #0369a1;
        --success: #059669;
        --warning: #d97706;
        --danger: #dc2626;
        --stage-bg: #ffffff;
        --stage-dot: #e2e8f0;
      }
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 2rem;
    }
    .header {
      margin-bottom: 2rem;
    }
    .title-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 0.5rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      font-size: 0.85rem;
      font-weight: 600;
      border-radius: 9999px;
      background: var(--accent);
      color: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 0.9rem;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1rem;
    }
    .metric-label {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 0.25rem;
    }
    .metric-value {
      font-size: 1.35rem;
      font-weight: 700;
      color: var(--text);
    }
    .metric-sub {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }
    .section {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .section-title {
      font-size: 1.1rem;
      font-weight: 600;
    }
    .search-box input {
      padding: 0.5rem 0.85rem;
      border: 1px solid var(--border);
      border-radius: 0.375rem;
      background: var(--bg);
      color: var(--text);
      font-size: 0.875rem;
      min-width: 260px;
    }
    .search-box input:focus {
      outline: 2px solid var(--accent);
      border-color: transparent;
    }
    .actions-bar {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin-bottom: 1.5rem;
    }
    button {
      background: var(--accent);
      color: #ffffff;
      border: none;
      border-radius: 0.375rem;
      padding: 0.5rem 1rem;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease-in-out;
    }
    button:hover {
      background: var(--accent-hover);
    }
    button.secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
    }
    button.secondary:hover {
      background: var(--border);
    }
    button.active {
      background: var(--warning);
      color: #000000;
    }
    details {
      margin-bottom: 1.5rem;
      border: 1px solid var(--border);
      border-radius: 0.375rem;
      padding: 0.75rem 1rem;
      background: var(--bg);
    }
    summary {
      cursor: pointer;
      font-weight: 600;
      font-size: 0.9rem;
    }
    .tag-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.75rem;
      list-style: none;
    }
    .tag-item {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.8rem;
      padding: 0.2rem 0.5rem;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.25rem;
    }
    #preview-container {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1.25rem;
      min-height: 200px;
    }
    .component-slot {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .component-slot:hover {
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .component-slot-header {
      padding: 0.5rem 0.75rem;
      background: rgba(0, 0, 0, 0.03);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.8rem;
    }
    .component-slot-tag code {
      color: var(--accent);
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .component-slot-idx {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-family: ui-monospace, monospace;
    }
    .component-stage {
      padding: 1.5rem 1rem;
      min-height: 110px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--stage-bg);
      background-image: radial-gradient(var(--stage-dot) 1px, transparent 1px);
      background-size: 16px 16px;
      overflow: auto;
    }
    .component-stage > * {
      max-width: 100%;
    }
    .component-slot-footer {
      padding: 0.4rem 0.75rem;
      background: rgba(0, 0, 0, 0.02);
      border-top: 1px solid var(--border);
      font-size: 0.7rem;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .shadow-indicator {
      display: inline-block;
      padding: 0.1rem 0.4rem;
      border-radius: 0.25rem;
      font-size: 0.65rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .shadow-indicator.has-shadow {
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
    }
    .shadow-indicator.no-shadow {
      background: rgba(148, 163, 184, 0.15);
      color: var(--text-muted);
    }
    .status-banner {
      padding: 0.75rem 1rem;
      border-radius: 0.375rem;
      margin-bottom: 1rem;
      font-size: 0.875rem;
      display: none;
    }
    .status-banner.error {
      display: block;
      background: rgba(248, 113, 113, 0.15);
      border: 1px solid var(--danger);
      color: var(--danger);
    }
  </style>
  ${themeCss ? `<style id="package-theme-styles">\n${themeCss}\n</style>` : ''}
</head>
<body class="wa-theme-default wa-light">
  <div class="header">
    <div class="title-row">
      <h1>${escapeHtml(suiteName)}</h1>
      <span class="badge">${escapeHtml(variant)}</span>
    </div>
    <p class="subtitle">Self-contained benchmark artifact generated at ${timestamp}</p>
  </div>

  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-label">Raw size</div>
      <div class="metric-value">${formattedRaw}</div>
      <div class="metric-sub">${formatNumber(rawBytes)} bytes</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Gzip size</div>
      <div class="metric-value">${formattedGzip}</div>
      <div class="metric-sub">${formatNumber(gzipBytes)} bytes</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Build time</div>
      <div class="metric-value">${formattedBuildTime}</div>
      <div class="metric-sub">Vite production build</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Components detected</div>
      <div class="metric-value" id="stat-registered">-</div>
      <div class="metric-sub">${componentCount ? `${componentCount} expected` : 'Custom element definitions'}</div>
    </div>
  </div>

  <div id="error-banner" class="status-banner"></div>

  <div class="section">
    <div class="section-header">
      <h2 class="section-title">Component live preview</h2>
      <div class="search-box">
        <input type="search" id="input-search" placeholder="Filter components (e.g. button, card)..." />
      </div>
    </div>

    <div class="actions-bar">
      <button id="btn-mount-sample">Mount sample (30)</button>
      <button id="btn-mount-all" class="secondary">Mount all (<span id="btn-count">0</span>)</button>
      <button id="btn-toggle" class="secondary">Toggle state</button>
      <button id="btn-highlight" class="secondary">Highlight shadow DOM</button>
      <button id="btn-clear" class="secondary">Clear preview</button>
    </div>

    <details id="tags-details">
      <summary id="tags-summary">Registered custom elements (0)</summary>
      <ul class="tag-list" id="tag-list"></ul>
    </details>

    <div id="preview-container"></div>
  </div>

  <script type="module">
    window.__registeredTags = [];
    const origDefine = customElements.define;
    customElements.define = function(tag, constructor, options) {
      if (!window.__registeredTags.includes(tag)) {
        window.__registeredTags.push(tag);
      }
      return origDefine.call(customElements, tag, constructor, options);
    };

    // --- Embedded bundle execution ---
    try {
${safeBundleCode}
    } catch (err) {
      console.error('[Benchmark Artifact] Execution error in inlined bundle:', err);
      const banner = document.getElementById('error-banner');
      if (banner) {
        banner.className = 'status-banner error';
        banner.textContent = 'Bundle execution warning/error: ' + (err && err.message ? err.message : String(err));
      }
    }
    window.__bundleReady = true;

    // --- Harness DOM orchestration ---
    const container = document.getElementById('preview-container');
    const statRegistered = document.getElementById('stat-registered');
    const tagsSummary = document.getElementById('tags-summary');
    const tagList = document.getElementById('tag-list');
    const inputSearch = document.getElementById('input-search');
    const btnMountSample = document.getElementById('btn-mount-sample');
    const btnMountAll = document.getElementById('btn-mount-all');
    const btnCount = document.getElementById('btn-count');
    const btnToggle = document.getElementById('btn-toggle');
    const btnHighlight = document.getElementById('btn-highlight');
    const btnClear = document.getElementById('btn-clear');

    let mountedElements = [];
    let toggleActive = false;
    let highlightActive = false;

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function getCustomElementTags() {
      return (window.__registeredTags || []).filter(t => typeof t === 'string' && t.includes('-'));
    }

    function updateTagsUi() {
      const tags = getCustomElementTags();
      if (statRegistered) statRegistered.textContent = String(tags.length);
      if (btnCount) btnCount.textContent = String(tags.length);
      if (tagsSummary) tagsSummary.textContent = 'Registered custom elements (' + tags.length + ')';
      if (tagList) {
        tagList.innerHTML = tags.map(t => '<li class="tag-item"><code>' + escapeHtml(t) + '</code></li>').join('');
      }
    }

    function populateComponent(el, tag, index) {
      const parts = tag.split('-');
      const cleanParts = parts.length > 1 ? parts.slice(1) : parts;
      const name = cleanParts.map((p, idx) => idx === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p).join(' ');

      el.setAttribute('data-bench-index', String(index));
      const tagLower = tag.toLowerCase();

      // Dialogs, Drawers, Modals: make visible without blocking window
      if (tagLower.includes('dialog') || tagLower.includes('modal') || tagLower.includes('drawer')) {
        el.setAttribute('open', '');
        if ('open' in el) try { el.open = true; } catch {}
        el.style.position = 'relative';
        el.style.zIndex = '1';
        el.textContent = name + ' content';
        return;
      }

      // Alerts, Banners, Callouts, Toasts: make visible with text
      if (tagLower.includes('alert') || tagLower.includes('banner') || tagLower.includes('toast') || tagLower.includes('callout')) {
        el.setAttribute('open', '');
        if (!el.hasAttribute('variant')) el.setAttribute('variant', 'primary');
        if ('open' in el) try { el.open = true; } catch {}
        el.textContent = 'Active message from ' + tag;
        return;
      }

      // Tooltips, Popovers, Dropdowns: make open or provide text
      if (tagLower.includes('tooltip') || tagLower.includes('popover') || tagLower.includes('dropdown')) {
        el.setAttribute('open', '');
        el.textContent = name + ' preview';
        return;
      }

      // Buttons, Badges, Tags, Chips, Tabs, Links: provide text label
      if (tagLower.includes('button') || tagLower.includes('badge') || tagLower.includes('tag') || tagLower.includes('chip') || tagLower.includes('link') || tagLower.includes('tab')) {
        el.textContent = name + ' #' + (index + 1);
        if (tagLower.includes('button') && !el.hasAttribute('variant')) {
          el.setAttribute('variant', 'brand');
        }
        return;
      }

      // Form Inputs, Textfields, Search, Textareas
      if (tagLower.includes('input') || tagLower.includes('text') || tagLower.includes('field') || tagLower.includes('search') || tagLower.includes('area')) {
        el.setAttribute('placeholder', 'Enter ' + name.toLowerCase() + '...');
        el.setAttribute('label', name);
        return;
      }

      // Checkboxes, Radios, Switches
      if (tagLower.includes('check') || tagLower.includes('radio') || tagLower.includes('switch') || tagLower.includes('toggle')) {
        el.textContent = 'Enable ' + name.toLowerCase();
        el.setAttribute('checked', '');
        if ('checked' in el) try { el.checked = true; } catch {}
        return;
      }

      // Progress, Sliders, Meters
      if (tagLower.includes('progress') || tagLower.includes('slider') || tagLower.includes('meter') || tagLower.includes('gauge')) {
        el.setAttribute('value', '65');
        if ('value' in el) try { el.value = 65; } catch {}
        return;
      }

      // Icons, Avatars
      if (tagLower.includes('icon')) {
        el.setAttribute('name', 'star');
        return;
      }
      if (tagLower.includes('avatar')) {
        el.setAttribute('initials', 'LC');
        el.setAttribute('label', name);
        return;
      }

      // Cards, Panels, Accordions
      if (tagLower.includes('card') || tagLower.includes('panel') || tagLower.includes('accordion') || tagLower.includes('item') || tagLower.includes('box')) {
        const p = document.createElement('p');
        p.textContent = 'Content preview for ' + name;
        p.style.margin = '0.5rem';
        p.style.fontSize = '0.85rem';
        el.appendChild(p);
        return;
      }

      // Default slot text for general custom elements
      el.textContent = name;
    }

    async function mountComponents(maxCount = 30) {
      if (!container) return;
      container.innerHTML = '';
      mountedElements = [];

      const tags = getCustomElementTags();
      if (tags.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No custom elements registered by this bundle.</p>';
        return;
      }

      const count = maxCount > 0 ? Math.min(tags.length, maxCount) : tags.length;
      for (let i = 0; i < count; i++) {
        const tag = tags[i];
        const slot = document.createElement('div');
        slot.className = 'component-slot';
        slot.setAttribute('data-tag', tag);

        const header = document.createElement('div');
        header.className = 'component-slot-header';
        header.innerHTML = '<span class="component-slot-tag"><code>&lt;' + escapeHtml(tag) + '&gt;</code></span><span class="component-slot-idx">#' + (i + 1) + '</span>';
        slot.appendChild(header);

        const stage = document.createElement('div');
        stage.className = 'component-stage';

        try {
          const el = document.createElement(tag);
          populateComponent(el, tag, i);
          stage.appendChild(el);
          mountedElements.push(el);
        } catch (mountErr) {
          const errMsg = document.createElement('p');
          errMsg.style.color = 'var(--danger)';
          errMsg.style.fontSize = '0.75rem';
          errMsg.textContent = 'Mount error: ' + mountErr.message;
          stage.appendChild(errMsg);
        }
        slot.appendChild(stage);

        const footer = document.createElement('div');
        footer.className = 'component-slot-footer';
        footer.innerHTML = '<span class="shadow-indicator">Checking...</span><span class="slot-tag-label">' + escapeHtml(tag) + '</span>';
        slot.appendChild(footer);

        container.appendChild(slot);
      }

      // Settle Lit updates and inspect shadow roots
      await Promise.all(
        mountedElements.map(async (el, idx) => {
          if (el && typeof el.updateComplete?.then === 'function') {
            try { await el.updateComplete; } catch {}
          }
          const slot = container.children[idx];
          if (slot) {
            const indicator = slot.querySelector('.shadow-indicator');
            if (indicator) {
              const hasShadow = !!el.shadowRoot;
              indicator.textContent = hasShadow ? 'Shadow DOM' : 'Light DOM';
              indicator.className = 'shadow-indicator ' + (hasShadow ? 'has-shadow' : 'no-shadow');
            }
          }
        })
      );

      if (inputSearch && inputSearch.value) {
        filterCards(inputSearch.value);
      }
    }

    function toggleState() {
      toggleActive = !toggleActive;
      btnToggle.classList.toggle('active', toggleActive);
      for (let i = 0; i < mountedElements.length; i++) {
        const el = mountedElements[i];
        if (!el) continue;
        el.setAttribute('data-active', toggleActive ? 'true' : 'false');
        if ('disabled' in el) {
          try { el.disabled = toggleActive; } catch {}
        }
        if ('open' in el && !el.tagName.toLowerCase().includes('dialog')) {
          try { el.open = !toggleActive; } catch {}
        }
        if ('checked' in el) {
          try { el.checked = !toggleActive; } catch {}
        }
      }
    }

    function toggleHighlight() {
      highlightActive = !highlightActive;
      btnHighlight.classList.toggle('active', highlightActive);
      for (const el of mountedElements) {
        if (el.shadowRoot) {
          if (highlightActive) {
            el.style.outline = '2px dashed var(--accent)';
            el.style.outlineOffset = '4px';
          } else {
            el.style.outline = '';
            el.style.outlineOffset = '';
          }
        }
      }
    }

    function filterCards(query) {
      const q = query.toLowerCase().trim();
      const slots = container.querySelectorAll('.component-slot');
      for (const slot of slots) {
        const tag = slot.getAttribute('data-tag') || '';
        slot.style.display = !q || tag.toLowerCase().includes(q) ? '' : 'none';
      }
    }

    if (btnMountSample) btnMountSample.addEventListener('click', () => mountComponents(30));
    if (btnMountAll) btnMountAll.addEventListener('click', () => mountComponents(0));
    if (btnToggle) btnToggle.addEventListener('click', () => toggleState());
    if (btnHighlight) btnHighlight.addEventListener('click', () => toggleHighlight());
    if (btnClear) btnClear.addEventListener('click', () => {
      if (container) container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">Preview cleared.</p>';
      mountedElements = [];
    });
    if (inputSearch) {
      inputSearch.addEventListener('input', (e) => filterCards(e.target.value));
    }

    // Initial mount on load
    updateTagsUi();
    mountComponents(30);
  </script>
</body>
</html>`;
}

/**
 * Save benchmark build bundle as a self-contained inline HTML artifact for manual validation.
 * @param {Object} options
 * @param {string} options.bundlePath - Absolute path to built bundle.js
 * @param {string} options.suiteName - Human-readable suite name
 * @param {string} options.suiteId - Suite identifier (e.g. 'carbon', 'spectrum')
 * @param {string} options.variant - Build variant ('baseline', tool id, or 'combined')
 * @param {Partial<import('../metrics.js').SizeMetrics>} [options.metrics] - Metrics associated with the bundle
 * @param {string} [options.outDir] - Output directory (defaults to packages/benchmarks/artifacts/<suiteId>)
 * @param {string} [options.filename] - Custom filename (defaults to <variant>.html)
 * @param {Record<string, any>} [options.metadata] - Extra metadata from suiteContext
 * @returns {string | null} Path to written file or null if bundle was not found
 */
export function saveArtifactHtml({ bundlePath, suiteName, suiteId, variant, metrics, outDir, filename, metadata }) {
  if (!bundlePath || !fs.existsSync(bundlePath)) {
    return null;
  }

  const targetDir = outDir || path.join(defaultArtifactsBaseDir, suiteId);
  fs.mkdirSync(targetDir, { recursive: true });

  const targetFilename = filename || `${variant}.html`;
  const filePath = path.join(targetDir, targetFilename);

  const bundleCode = fs.readFileSync(bundlePath, 'utf-8');
  const themeCss = resolveThemeCss(metadata?.packageDir);

  const htmlContent = generateArtifactHtml({
    bundleCode,
    suiteName,
    suiteId,
    variant,
    metrics,
    metadata,
    themeCss,
  });

  fs.writeFileSync(filePath, htmlContent, 'utf-8');
  return filePath;
}

/**
 * Save an SSR Declarative Shadow DOM + Resumable artifact HTML page.
 * @param {Object} options
 * @param {string} options.suiteName
 * @param {string} options.suiteId
 * @param {string[]} options.dsdMarkups
 * @param {string} options.loaderScript
 * @param {Record<string, any>} [options.metrics]
 * @param {string} [options.outDir]
 * @param {string} [options.bundleCode]
 * @param {Record<string, any>} [options.metadata]
 * @returns {string} Path to written HTML file
 */
export function saveResumableArtifactHtml({ suiteName, suiteId, dsdMarkups, loaderScript, metrics = {}, outDir, bundleCode: providedBundleCode, metadata = {} }) {
  const targetDir = outDir || path.join(defaultArtifactsBaseDir, suiteId);
  fs.mkdirSync(targetDir, { recursive: true });

  const filePath = path.join(targetDir, 'resumable-ssr.html');
  const timestamp = new Date().toISOString();

  let bundleCode = providedBundleCode || '';
  if (!bundleCode) {
    const combinedPath = path.join(targetDir, 'combined.html');
    const baselinePath = path.join(targetDir, 'baseline.html');
    const sourceHtmlPath = fs.existsSync(combinedPath) ? combinedPath : fs.existsSync(baselinePath) ? baselinePath : null;
    if (sourceHtmlPath) {
      try {
        const sourceHtml = fs.readFileSync(sourceHtmlPath, 'utf-8');
        const match = sourceHtml.match(/\/\/ --- Embedded bundle execution ---\s*try\s*\{([\s\S]*?)\}\s*catch\s*\(err\)\s*\{/);
        if (match) {
          bundleCode = match[1];
        }
      } catch {}
    }
  }

  const themeCss = resolveThemeCss(metadata?.packageDir || suiteId);
  const standardJs = metrics.standardInitialJsKb || 0;
  const resumableJs = metrics.resumableInitialJsKb || 0;
  const count = metrics.totalComponents || dsdMarkups.length;
  const dsdBytes = metrics.totalDsdBytes || 0;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Resumable SSR artifact: ${escapeHtml(suiteName)}</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0284c7;
      --success: #34d399;
      --warning: #fbbf24;
      --danger: #f87171;
      --stage-bg: #0b1329;
      --stage-dot: #1e293b;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f8fafc;
        --card-bg: #ffffff;
        --border: #e2e8f0;
        --text: #0f172a;
        --text-muted: #64748b;
        --accent: #0284c7;
        --accent-hover: #0369a1;
        --success: #059669;
        --warning: #d97706;
        --danger: #dc2626;
        --stage-bg: #ffffff;
        --stage-dot: #e2e8f0;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 2rem;
    }
    .header { margin-bottom: 2rem; }
    .title-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
    h1 { font-size: 1.5rem; font-weight: 700; }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      font-size: 0.85rem;
      font-weight: 600;
      border-radius: 9999px;
      background: var(--success);
      color: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .subtitle { color: var(--text-muted); font-size: 0.9rem; }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1rem;
    }
    .metric-label { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.25rem; }
    .metric-value { font-size: 1.35rem; font-weight: 700; color: var(--text); }
    .metric-sub { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; }
    .actions-bar {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin-bottom: 1.5rem;
    }
    button {
      background: var(--accent);
      color: #ffffff;
      border: none;
      border-radius: 0.375rem;
      padding: 0.5rem 1rem;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease-in-out;
    }
    button:hover { background: var(--accent-hover); }
    button.secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
    }
    button.secondary:hover { background: var(--border); }
    .section {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    .section-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; }
    .resumable-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1.25rem;
    }
    .resumable-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .resumable-card.is-resumed {
      border-color: var(--accent);
      box-shadow: 0 0 12px rgba(56, 189, 248, 0.2);
    }
    .card-header {
      padding: 0.5rem 0.75rem;
      background: rgba(0, 0, 0, 0.03);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
    }
    .card-header code { color: var(--accent); font-weight: 600; }
    .card-stage {
      padding: 1.5rem 1rem;
      min-height: 100px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--stage-bg);
      background-image: radial-gradient(var(--stage-dot) 1px, transparent 1px);
      background-size: 16px 16px;
      overflow: auto;
    }
    .card-stage > * {
      max-width: 100%;
    }
    .card-footer {
      padding: 0.4rem 0.75rem;
      background: rgba(0, 0, 0, 0.02);
      border-top: 1px solid var(--border);
      font-size: 0.7rem;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .status-pill {
      background: rgba(52, 211, 153, 0.15);
      color: var(--success);
      padding: 0.15rem 0.45rem;
      border-radius: 0.25rem;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.65rem;
      letter-spacing: 0.05em;
    }
    .status-pill.resumed {
      background: rgba(56, 189, 248, 0.2);
      color: var(--accent);
      border: 1px solid var(--accent);
    }
  </style>
  ${themeCss ? `<style id="package-theme-styles">\n${themeCss}\n</style>` : ''}
  ${bundleCode ? `<script id="resumable-bundle-source" type="text/plain">\n${escapeScriptContent(bundleCode)}\n</script>` : ''}
  <script>
    // 1. Live custom element definition tracking
    const resumedTags = new Set();
    const origDefine = customElements.define;
    function markResumed(tagName) {
      if (!tagName) return;
      const lower = tagName.toLowerCase();
      if (resumedTags.has(lower)) return;
      resumedTags.add(lower);

      const count = document.querySelectorAll('.resumable-card.is-resumed').length + 1;
      const statResumed = document.getElementById('stat-resumed');
      if (statResumed) {
        statResumed.textContent = String(count);
      }

      const cards = document.querySelectorAll('.resumable-card');
      for (const card of cards) {
        const cardTag = (card.getAttribute('data-tag') || '').toLowerCase();
        if (cardTag === lower) {
          const pill = card.querySelector('.status-pill');
          if (pill) {
            pill.textContent = '⚡ Resumed';
            pill.className = 'status-pill resumed';
          }
          const sub = card.querySelector('.status-sub');
          if (sub) {
            sub.textContent = 'Hydrated (' + performance.now().toFixed(0) + 'ms)';
          }
          card.classList.add('is-resumed');
        }
      }
    }

    customElements.define = function(name, ctor, opts) {
      const res = origDefine.call(customElements, name, ctor, opts);
      markResumed(name);
      return res;
    };

    // 2. On-demand bundle resolver: loads component definitions via Blob URL when triggered
    let bundleBlobUrl = null;
    function getBundleBlobUrl() {
      if (!bundleBlobUrl) {
        const bundleSourceEl = document.getElementById('resumable-bundle-source');
        if (bundleSourceEl && bundleSourceEl.textContent.trim()) {
          const blob = new Blob([bundleSourceEl.textContent], { type: 'application/javascript' });
          bundleBlobUrl = URL.createObjectURL(blob);
        }
      }
      return bundleBlobUrl || '';
    }

    window.__LIT_RESUMABLE_MANIFEST__ = new Proxy({}, {
      get: (_target, _prop) => getBundleBlobUrl()
    });
  </script>
  <script type="module">
    ${escapeScriptContent(loaderScript)}
  </script>
  <script>
    window.addEventListener('DOMContentLoaded', () => {
      const cards = document.querySelectorAll('.resumable-card');

      // Check if any tags were already registered
      for (const card of cards) {
        const tag = (card.getAttribute('data-tag') || '').toLowerCase();
        if (tag && customElements.get(tag)) {
          markResumed(tag);
        }
      }

      // Allow clicking anywhere on a card to trigger interaction on its host
      for (const card of cards) {
        card.addEventListener('click', (ev) => {
          const host = card.querySelector('[data-resumable]');
          if (!host) return;
          if (!ev.composedPath().includes(host)) {
            const target = host.shadowRoot ? (host.shadowRoot.querySelector('button, input, a, select, textarea, [tabindex], [resumes-on-click]') || host) : host;
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
          }
        });
      }

      window.simulateClick = (idx = 0) => {
        const card = cards[idx];
        if (!card) return;
        const host = card.querySelector('[data-resumable]');
        if (!host) return;
        const target = host.shadowRoot ? (host.shadowRoot.querySelector('button, input, a, select, textarea, [tabindex], [resumes-on-click]') || host) : host;
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
      };

      window.resumeSample = async (count = 10) => {
        for (let i = 0; i < Math.min(count, cards.length); i++) {
          window.simulateClick(i);
          await new Promise(r => setTimeout(r, 60));
        }
      };

      let highlightActive = false;
      window.toggleHighlight = () => {
        highlightActive = !highlightActive;
        for (const card of cards) {
          const host = card.querySelector('[data-resumable]');
          if (host && host.shadowRoot) {
            host.style.outline = highlightActive ? '2px dashed var(--accent)' : '';
            host.style.outlineOffset = '4px';
          }
        }
      };

      document.getElementById('btn-test-click')?.addEventListener('click', () => window.resumeSample(10));
      document.getElementById('btn-resume-all')?.addEventListener('click', () => window.resumeSample(cards.length));
      document.getElementById('btn-highlight-dsd')?.addEventListener('click', () => window.toggleHighlight());
    });
  </script>
</head>
<body class="wa-theme-default wa-light">
  <div class="header">
    <div class="title-row">
      <h1>${escapeHtml(suiteName)}</h1>
      <span class="badge">Resumable SSR (DSD)</span>
    </div>
    <p class="subtitle">Declarative Shadow DOM pre-rendered HTML with zero-JS initial boot — generated at ${timestamp}</p>
  </div>

  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-label">Resumable initial JS</div>
      <div class="metric-value">${resumableJs} KB</div>
      <div class="metric-sub">Only the micro-loader script</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Standard SSR initial JS</div>
      <div class="metric-value">${standardJs} KB</div>
      <div class="metric-sub">Eager hydration bundle</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Initial JS reduction</div>
      <div class="metric-value">${standardJs > 0 ? (((standardJs - resumableJs) / standardJs) * 100).toFixed(1) : 0}%</div>
      <div class="metric-sub">Zero component JS on boot</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Resumed components</div>
      <div class="metric-value"><span id="stat-resumed">0</span> / ${Math.min(30, count)}</div>
      <div class="metric-sub">0 on boot, live on click</div>
    </div>
  </div>

  <div class="section">
    <div class="actions-bar">
      <button id="btn-test-click">⚡ Interactive test: Click sample (10)</button>
      <button id="btn-resume-all" class="secondary">Resume all previewed components</button>
      <button id="btn-highlight-dsd" class="secondary">Highlight Declarative Shadow DOM</button>
    </div>

    <h2 class="section-title">Pre-rendered Declarative Shadow DOM components</h2>
    <div class="resumable-grid">
      ${dsdMarkups
        .slice(0, 30)
        .map((markup, idx) => {
          const matchTag = markup.match(/<([a-z0-9-]+)/i);
          const tag = matchTag ? matchTag[1] : `component-${idx + 1}`;
          return `
        <div class="resumable-card" data-tag="${escapeHtml(tag)}">
          <div class="card-header">
            <code>&lt;${escapeHtml(tag)}&gt;</code>
            <span>#${idx + 1}</span>
          </div>
          <div class="card-stage">
            ${markup}
          </div>
          <div class="card-footer">
            <span class="status-pill">Native DSD</span>
            <span class="status-sub">Zero JS boot</span>
          </div>
        </div>
      `;
        })
        .join('\n')}
    </div>
  </div>
</body>
</html>`;

  fs.writeFileSync(filePath, html, 'utf-8');
  return filePath;
}
