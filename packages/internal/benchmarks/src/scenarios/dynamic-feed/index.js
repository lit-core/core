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
import { html, render } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
${imports}

const ITEM_COUNT = 50;
function createFeedItems() {
  const items = [];
  for (let i = 0; i < ITEM_COUNT; i++) {
    items.push({
      id: 'item-' + i,
      title: 'Publication dispatch #' + i,
      timestamp: (i * 12) + 'm ago',
      category: i % 2 === 0 ? 'Engineering' : 'Architecture',
      pinned: i % 10 === 0,
      likes: i * 3,
      tags: ['lit', 'web-components', 'compiler'],
    });
  }
  return items;
}

let feedItems = createFeedItems();

function renderFeed(container, items) {
  // Pure computed transformation exercised during render (targets memoize)
  const sorted = [...items].sort((a, b) => b.likes - a.likes);

  const template = html\`
    <div class="dynamic-feed-root" style="display:flex; flex-direction:column; gap:12px;">
      <header class="feed-header" style="display:flex; justify-content:space-between; align-items:center;">
        <h3>Activity feed</h3>
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
                'is-featured': item.likes > 50,
              })}
              style=\${styleMap({
                padding: '12px',
                borderLeft: item.pinned ? '3px solid #059669' : '1px solid #e4e4e7',
              })}
            >
              <div class="feed-item-header" style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <${iconTag}></${iconTag}>
                  <span class="feed-title" style="font-weight:500;">\${item.title}</span>
                </div>
                <${badgeTag} type=\${item.pinned ? 'success' : 'neutral'}>\${item.category}</${badgeTag}>
              </div>

              <p class="feed-description" style="color:#71717a; font-size:14px; margin:8px 0;">
                Live streaming telemetry dispatch for item \${item.id}.
              </p>

              <div class="feed-item-footer" style="display:flex; justify-content:space-between; align-items:center;">
                <span class="feed-timestamp" style="font-size:12px; color:#a1a1aa;">\${item.timestamp}</span>
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
  render(template, container);
}

window.__scenario = {
  id: 'dynamic-feed',
  name: 'Dynamic feed',
  async mount(container) {
    feedItems = createFeedItems();
    renderFeed(container, feedItems);
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
  },
  async update(container) {
    // Modify item state and re-render collection
    for (let i = 0; i < feedItems.length; i += 2) {
      feedItems[i].likes += 10;
      feedItems[i].pinned = !feedItems[i].pinned;
    }
    renderFeed(container, [...feedItems]);
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
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
