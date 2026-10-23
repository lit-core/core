import { resolveScenarioComponents } from '../harness/scenario-base.js';

/**
 * Dynamic feed scenario definition.
 * Simulates a content feed rendering collections of cards with directives (repeat, classMap, styleMap).
 * Evaluates directives (directive lowering), memoize (expression memoization), and html-fuse (HTML/SVG clustering).
 */
export const dynamicFeedScenario = {
  id: 'dynamic-feed',
  name: 'Dynamic feed',
  description: 'Dynamic reactive feed with repeated collection items testing directive lowering, expression memoization, and static HTML clustering',
  relevantFeatures: ['directives', 'memoize', 'html-fuse'],
  componentConcepts: ['card', 'badge', 'icon', 'button', 'chips', 'divider'],

  /**
   * Generate entry script importing real components from the suite.
   * @param {import('../../types.js').SuiteContext} suiteContext
   * @returns {string}
   */
  generateEntry(suiteContext) {
    const comps = resolveScenarioComponents(suiteContext.id, this.componentConcepts);
    const imports = comps.map((c) => c.importStatement).join('\n');
    const cardTag = comps.find((c) => c.concept === 'card')?.tag || 'div';
    const badgeTag = comps.find((c) => c.concept === 'badge')?.tag || 'span';
    const iconTag = comps.find((c) => c.concept === 'icon')?.tag || 'span';
    const buttonTag = comps.find((c) => c.concept === 'button')?.tag || 'button';
    const chipsTag = comps.find((c) => c.concept === 'chips')?.tag || 'div';
    const dividerTag = comps.find((c) => c.concept === 'divider')?.tag || 'hr';

    return `
import { html, LitElement, render } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
${imports}

const ITEM_COUNT = 25;
const FEED_TAGS = [
  'lit', 'web-components', 'compiler', 'aot', 'performance',
  'shadow-dom', 'streaming', 'resumable', 'design-system', 'telemetry',
  'enterprise', 'reactivity',
];

function createFeedItems() {
  const items = [];
  for (let i = 0; i < ITEM_COUNT; i++) {
    items.push({
      id: 'item-' + i,
      title: 'Publication dispatch #' + i,
      timestamp: (i * 12) + 'm ago',
      category: i % 2 === 0 ? 'Engineering' : 'Architecture',
      pinned: i % 5 === 0,
      likes: i * 3,
      tags: FEED_TAGS,
    });
  }
  return items;
}

class BenchmarkFeedCardMeta extends LitElement {
  static properties = {
    itemId: { type: String },
    category: { type: String },
    pinned: { type: Boolean },
    compact: { type: Boolean },
    pulseTick: { type: Number },
    tags: { type: Array },
    metrics: { type: Array },
  };

  constructor() {
    super();
    this.itemId = '';
    this.category = 'Engineering';
    this.pinned = false;
    this.compact = false;
    this.pulseTick = 0;
    this.tags = FEED_TAGS;
    this.metrics = FEED_TAGS;
  }

  render() {
    const sortedTags = [...this.tags]
      .filter(t => t.length > 2 && t !== this.category.toLowerCase())
      .map(t => t.toUpperCase() + ':' + this.category)
      .sort((a, b) => a.localeCompare(b));

    const tagDigest = [...this.metrics]
      .filter(t => t.includes('e') || t.includes('a'))
      .map(t => '[' + t + ']')
      .reduce((acc, v) => (acc ? acc + ' ' + v : v), '');

    let layoutPass = 0;
    let verifiedBadge;
    let encryptionBadge;
    let complianceBadge;
    let regionBadge;
    let slaBadge;
    if (this.compact) {
      layoutPass += 1;
      verifiedBadge = html\`<div class="dispatch-verified-badge" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:rgb(5, 150, 105);"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="0.8"/><path d="M11.5 5.5L7 10L4.5 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" stroke-width="0.8"/></svg><span class="badge-title">Verified</span><span class="badge-sub">stream</span><span class="badge-tag">ok</span></div>\`;
      encryptionBadge = html\`<div class="dispatch-encryption-badge" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:rgb(82, 82, 91);"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="10.5" r="1" fill="currentColor"/><path d="M8 11.5v1.5" stroke="currentColor" stroke-width="1.2"/></svg><span class="badge-title">TLS 1.3</span><span class="badge-sub">signed</span><span class="badge-tag">mTLS</span></div>\`;
      complianceBadge = html\`<div class="dispatch-compliance-badge" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:rgb(82, 82, 91);"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3l2 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="8" r="1" fill="currentColor"/><path d="M4 2l2 1M12 2l-2 1" stroke="currentColor" stroke-width="1"/></svg><span class="badge-title">Audit</span><span class="badge-sub">synced</span><span class="badge-tag">SOC2</span></div>\`;
      regionBadge = html\`<div class="dispatch-region-badge" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:rgb(82, 82, 91);"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><ellipse cx="8" cy="8" rx="3" ry="6" stroke="currentColor" stroke-width="1"/><path d="M2 8h12M3 5h10M3 11h10" stroke="currentColor" stroke-width="0.8"/></svg><span class="badge-title">Global</span><span class="badge-sub">edge</span><span class="badge-tag">anycast</span></div>\`;
      slaBadge = html\`<div class="dispatch-sla-badge" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:rgb(5, 150, 105);"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 12l3-4 3 2 4-6 2 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="5" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="10" r="1" fill="currentColor"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg><span class="badge-title">99.99%</span><span class="badge-sub">uptime</span><span class="badge-tag">tier-1</span></div>\`;
    } else {
      layoutPass += 2;
      verifiedBadge = html\`<div class="dispatch-verified-badge" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:rgb(5, 150, 105);"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="0.8"/><path d="M11.5 5.5L7 10L4.5 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" stroke-width="0.8"/></svg><span class="badge-title">Verified</span><span class="badge-sub">stream</span><span class="badge-tag">ok</span></div>\`;
      encryptionBadge = html\`<div class="dispatch-encryption-badge" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:rgb(82, 82, 91);"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="10.5" r="1" fill="currentColor"/><path d="M8 11.5v1.5" stroke="currentColor" stroke-width="1.2"/></svg><span class="badge-title">TLS 1.3</span><span class="badge-sub">signed</span><span class="badge-tag">mTLS</span></div>\`;
      complianceBadge = html\`<div class="dispatch-compliance-badge" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:rgb(82, 82, 91);"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3l2 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="8" r="1" fill="currentColor"/><path d="M4 2l2 1M12 2l-2 1" stroke="currentColor" stroke-width="1"/></svg><span class="badge-title">Audit</span><span class="badge-sub">synced</span><span class="badge-tag">SOC2</span></div>\`;
      regionBadge = html\`<div class="dispatch-region-badge" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:rgb(82, 82, 91);"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><ellipse cx="8" cy="8" rx="3" ry="6" stroke="currentColor" stroke-width="1"/><path d="M2 8h12M3 5h10M3 11h10" stroke="currentColor" stroke-width="0.8"/></svg><span class="badge-title">Global</span><span class="badge-sub">edge</span><span class="badge-tag">anycast</span></div>\`;
      slaBadge = html\`<div class="dispatch-sla-badge" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:rgb(5, 150, 105);"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 12l3-4 3 2 4-6 2 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="5" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="10" r="1" fill="currentColor"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg><span class="badge-title">99.99%</span><span class="badge-sub">uptime</span><span class="badge-tag">tier-1</span></div>\`;
    }
    void layoutPass;

    return html\`
      <div
        class=\${classMap({
          'card-meta-bar': true,
          'is-pinned': this.pinned,
          'is-compact': this.compact,
        })}
        style=\${styleMap({
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: this.compact ? '4px' : '6px',
        })}
        data-item=\${ifDefined(this.itemId || undefined)}
      >
        <span
          class=\${classMap({
            'meta-tags': true,
            'meta-compact': this.compact,
          })}
          style=\${styleMap({
            color: this.pinned ? 'rgb(5, 150, 105)' : 'rgb(82, 82, 91)',
            fontSize: '11px',
          })}
        >\${sortedTags.slice(0, 3).join(' • ')} (\${tagDigest.length}) #\${this.pulseTick}</span>
        <div
          class=\${classMap({
            'meta-badge-cluster-primary': true,
            'cluster-compact': this.compact,
          })}
          style=\${styleMap({
            display: 'inline-flex',
            gap: this.compact ? '2px' : '4px',
          })}
          data-category=\${ifDefined(this.category || undefined)}
        >
          \${verifiedBadge}
          \${encryptionBadge}
        </div>
      </div>
    \`;
  }
}

if (!customElements.get('benchmark-feed-card-meta')) {
  customElements.define('benchmark-feed-card-meta', BenchmarkFeedCardMeta);
}

class BenchmarkFeedView extends LitElement {
  static properties = {
    items: { type: Array },
    filterTag: { type: String },
    pulseTick: { type: Number },
    compact: { type: Boolean },
  };

  constructor() {
    super();
    this.items = [];
    this.filterTag = 'lit';
    this.pulseTick = 0;
    this.compact = false;
  }

  createRenderRoot() {
    return this;
  }

  render() {
    const sorted = [...this.items]
      .filter(item => item.tags.includes(this.filterTag) && item.title.toLowerCase().includes('dispatch'))
      .sort((a, b) => b.likes - a.likes || a.title.localeCompare(b.title));

    return html\`
      <div class="dynamic-feed-root" data-tick=\${this.pulseTick} style="display:flex; flex-direction:column; gap:12px;">
        <header class="feed-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3>Activity feed (\${sorted.length})</h3>
          <${chipsTag}></${chipsTag}>
        </header>

        <div class="feed-items-list" style="display:flex; flex-direction:column; gap:12px;">
          \${repeat(
            sorted,
            item => item.id,
            item => html\`
              <${cardTag}
                class=\${classMap({
                  'feed-card': true,
                  'is-pinned': item.pinned,
                  'is-featured': item.likes > 30,
                  'is-compact': this.compact,
                })}
                style=\${styleMap({
                  padding: this.compact ? '8px' : '12px',
                  borderLeft: item.pinned ? '3px solid rgb(5, 150, 105)' : '1px solid rgb(228, 228, 231)',
                })}
              >
                <div class="feed-item-header" style="display:flex; justify-content:space-between; align-items:center;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <${iconTag}></${iconTag}>
                    <span class="feed-title" style="font-weight:500;">\${item.title}</span>
                  </div>
                  <${badgeTag} type=\${item.pinned ? 'success' : 'neutral'}>\${item.category}</${badgeTag}>
                </div>

                <p class="feed-description" style="color:rgb(113, 113, 122); font-size:14px; margin:8px 0;">
                  Live streaming telemetry dispatch for item \${item.id}.
                </p>

                <benchmark-feed-card-meta
                  .itemId=\${item.id}
                  .category=\${item.category}
                  .pinned=\${item.pinned}
                  .compact=\${this.compact}
                  .pulseTick=\${this.pulseTick}
                  .tags=\${item.tags}
                  .metrics=\${item.tags}
                ></benchmark-feed-card-meta>

                <div class="feed-item-footer" style="display:flex; justify-content:space-between; align-items:center;">
                  <span class="feed-timestamp" style="font-size:12px; color:rgb(161, 161, 170);">\${item.timestamp}</span>
                  <${buttonTag} size="sm" aria-label=\${ifDefined(item.pinned ? 'Unpin' : undefined)}>
                    Like (\${item.likes})
                  </${buttonTag}>
                </div>
                <${dividerTag}></${dividerTag}>
              </${cardTag}>
            \`
          )}
        </div>
      </div>
    \`;
  }
}

if (!customElements.get('benchmark-feed-view')) {
  customElements.define('benchmark-feed-view', BenchmarkFeedView);
}

let feedItems = createFeedItems();
let currentTick = 0;
let cachedFeedView = null;
let cachedCardMetas = [];

function renderFeed(container, items, tick = 0) {
  render(
    html\`<benchmark-feed-view .items=\${items} .pulseTick=\${tick} .compact=\${tick % 2 === 1}></benchmark-feed-view>\`,
    container
  );
}

window.__scenario = {
  id: 'dynamic-feed',
  name: 'Dynamic feed',
  async mount(container) {
    feedItems = createFeedItems();
    currentTick = 0;
    renderFeed(container, feedItems, currentTick);
    cachedFeedView = container.querySelector('benchmark-feed-view');
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
    cachedCardMetas = Array.from(container.querySelectorAll('benchmark-feed-card-meta'));
    await Promise.all(cachedCardMetas.map(el => el.updateComplete || Promise.resolve()));
  },
  async update(container) {
    currentTick++;
    renderFeed(container, feedItems, currentTick);
    if (cachedFeedView && cachedFeedView.updateComplete) {
      await cachedFeedView.updateComplete;
    }
    await Promise.all(cachedCardMetas.map(el => el.updateComplete || Promise.resolve()));
  },
  getMetrics(container) {
    return {
      totalItems: ITEM_COUNT,
      directivesUsed: ['repeat', 'classMap', 'styleMap', 'ifDefined'],
      renderedCards: container.querySelectorAll('.feed-card').length,
    };
  }
};
`;
  },
};
