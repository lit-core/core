import './setup.js';
import { html, LitElement } from 'lit';
import { describe, expect, it } from 'vitest';
import { restoreComponentState, withResumable } from '../src/client/adapter.js';
import { renderToDsd } from '../src/server/dsd-renderer.js';
import { extractComponentState, serializeComponentState } from '../src/server/state-serializer.js';

describe('hydration-free client adapter and state hydration', () => {
  it('extracts and serializes reactive properties accurately', () => {
    class MockUserProfile extends LitElement {
      static properties = {
        userId: { type: Number },
        role: { type: String },
        active: { type: Boolean },
        permissions: { type: Array },
      };

      userId = 104;
      role = 'editor';
      active = false;
      permissions = ['read', 'write'];
      _internalSecret = 'should-not-serialize';
    }

    const instance = new MockUserProfile();
    const state = extractComponentState(instance);

    expect(state).toEqual({
      userId: 104,
      role: 'editor',
      active: false,
      permissions: ['read', 'write'],
    });

    const json = serializeComponentState(instance);
    expect(json).toBe('{"userId":104,"role":"editor","active":false,"permissions":["read","write"]}');
  });

  it('restores state from <script type="lit/state"> and cleans DOM', () => {
    const host = document.createElement('div');
    host.innerHTML = `<script type="lit/state">{"count":42,"label":"Dashboard"}</script>`;
    document.body.appendChild(host);

    const state = restoreComponentState(host);
    expect(state).toEqual({ count: 42, label: 'Dashboard' });
    expect((host as any).count).toBe(42);
    expect((host as any).label).toBe('Dashboard');

    // Script element must be removed
    const remainingScript = host.querySelector('script');
    expect(remainingScript).toBeNull();

    host.remove();
  });

  it('preserves existing Declarative Shadow DOM nodes with zero recreation on upgrade', async () => {
    const tagName = 'resumable-card-widget';

    // Simulate Declarative Shadow DOM rendered on server
    const dsdMarkup = renderToDsd({
      tagName,
      shadowHtml: `
        <div class="card-body">
          <span class="title">Original Title</span>
          <button id="action-btn" data-action="handleClick">Click Me</button>
        </div>
      `,
      state: { count: 10, title: 'Server Title' },
    });

    const container = document.createElement('div');
    container.innerHTML = dsdMarkup;
    document.body.appendChild(container);

    const host = container.firstElementChild as HTMLElement;
    expect(host).not.toBeNull();

    // Attach shadow root if in standard JSDOM where template shadowrootmode isn't automatically parsed
    if (!host.shadowRoot) {
      const template = host.querySelector('template[shadowrootmode="open"]') as HTMLTemplateElement;
      if (template) {
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.appendChild(template.content.cloneNode(true));
        template.remove();
      }
    }

    // Capture DOM node reference before upgrade
    const btnBeforeUpgrade = host.shadowRoot?.querySelector('#action-btn');
    const titleBeforeUpgrade = host.shadowRoot?.querySelector('.title');
    expect(btnBeforeUpgrade).not.toBeNull();
    expect(titleBeforeUpgrade).not.toBeNull();

    // Define Lit component with resumable adapter
    let actionTriggered = false;

    class ResumableCardWidget extends withResumable(LitElement) {
      static properties = {
        count: { type: Number },
        title: { type: String },
      };

      count = 0;
      title = '';

      handleClick() {
        actionTriggered = true;
      }

      render() {
        return html`
          <div class="card-body">
            <span class="title">${this.title}</span>
            <button id="action-btn" data-action="handleClick">Click Me</button>
          </div>
        `;
      }
    }

    customElements.define(tagName, ResumableCardWidget);

    if (typeof (host as any).update === 'function') {
      (host as any).update(new Map());
    }

    // 1. Verify property state restored from <script type="lit/state">
    expect((host as any).count).toBe(10);

    // 2. CRITICAL INVARIANT: Exact reference equality of DOM nodes (ZERO DOM recreation)
    const btnAfterUpgrade = host.shadowRoot?.querySelector('#action-btn');
    const titleAfterUpgrade = host.shadowRoot?.querySelector('.title');

    expect(btnAfterUpgrade).toBe(btnBeforeUpgrade);
    expect(titleAfterUpgrade).toBe(titleBeforeUpgrade);

    // 3. Verify event handler executes
    btnAfterUpgrade?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(actionTriggered).toBe(true);

    container.remove();
  });
});
