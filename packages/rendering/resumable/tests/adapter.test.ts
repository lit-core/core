import './setup.js';
import { html, LitElement } from 'lit';
import { describe, expect, it } from 'vitest';
import { createIsolateEnvironment, renderToString } from '../../ssr/src/index.js';
import { restoreComponentState, withResumable } from '../src/client/adapter.js';
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

  it('restores state from data-lit-state attribute and cleans host attribute', () => {
    const host = document.createElement('div');
    host.setAttribute('data-lit-state', '{"count":42,"label":"Dashboard"}');
    document.body.appendChild(host);

    const state = restoreComponentState(host);
    expect(state).toEqual({ count: 42, label: 'Dashboard' });
    expect((host as any).count).toBe(42);
    expect((host as any).label).toBe('Dashboard');

    // Host attribute must be removed after restoration
    expect(host.hasAttribute('data-lit-state')).toBe(false);

    host.remove();
  });

  it('preserves existing Declarative Shadow DOM nodes with zero recreation on upgrade', async () => {
    const tagName = 'resumable-card-widget';
    const env = createIsolateEnvironment();

    class ServerResumableCardWidget extends env.HTMLElement {
      static properties = {
        count: { type: Number },
        title: { type: String },
      };

      count = 10;
      title = 'Server Title';

      handleClick() {}

      render() {
        return html`
          <div class="card-body">
            <span class="title">${this.title}</span>
            <button id="action-btn" @click=${this.handleClick}>Click Me</button>
          </div>
        `;
      }
    }

    env.customElements.define(tagName, ServerResumableCardWidget);

    const dsdMarkup = renderToString(html`<resumable-card-widget></resumable-card-widget>`, {
      customElements: env.customElements,
      resumable: true,
    });

    expect(dsdMarkup).toContain('data-lit-state=');
    expect(dsdMarkup).not.toContain('<script type="lit/state">');

    const container = document.createElement('div');
    container.innerHTML = dsdMarkup;
    document.body.appendChild(container);

    const host = container.firstElementChild as HTMLElement;
    expect(host).not.toBeNull();

    // Attach shadow root in mock DOM where template shadowrootmode is not automatically parsed
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
            <button id="action-btn" @click=${this.handleClick}>Click Me</button>
          </div>
        `;
      }
    }

    customElements.define(tagName, ResumableCardWidget);

    if (typeof (host as any).update === 'function') {
      (host as any).update(new Map());
    }

    // 1. Verify property state restored from data-lit-state
    expect((host as any).count).toBe(10);
    expect((host as any).title).toBe('Server Title');

    // 2. Exact reference equality of DOM nodes (zero DOM recreation)
    const btnAfterUpgrade = host.shadowRoot?.querySelector('#action-btn');
    const titleAfterUpgrade = host.shadowRoot?.querySelector('.title');

    expect(btnAfterUpgrade).toBe(btnBeforeUpgrade);
    expect(titleAfterUpgrade).toBe(titleBeforeUpgrade);

    // 3. Verify event handler bound via hydrateTemplateRoot executes
    btnAfterUpgrade?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(actionTriggered).toBe(true);

    // 4. Verify subsequent reactive updates mutate text in place without replacing nodes
    (host as any).title = 'Updated Title';
    if (typeof (host as any).update === 'function') {
      (host as any).update(new Map([['title', 'Server Title']]));
    }
    expect(host.shadowRoot?.querySelector('.title')).toBe(titleBeforeUpgrade);
    expect(host.shadowRoot?.querySelector('.title')?.textContent).toBe('Updated Title');

    container.remove();
  });

  it('serializes template event listeners into resumes-on-* attributes for DSD', () => {
    const fn1 = () => {};
    const fn2 = () => {};

    const template = html`
      <div class="container">
        <button @click=${fn1} class="primary">Submit</button>
        <input @input=${fn2} type="text" />
        <p>Static description</p>
      </div>
    `;

    const output = renderToString(template, { resumable: true });

    expect(output).toContain('resumes-on-click');
    expect(output).toContain('resumes-on-input');
    expect(output).not.toContain('@click');
    expect(output).not.toContain('@input');
    expect(output).toContain('Static description');
  });

  it('injects virtual:lit-core/resumable-adapter import into custom element source via OXC AST transform', async () => {
    const { transformResumableComponent } = await import('../src/compiler/index.js');
    const source = `import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('my-counter')
export class MyCounter extends LitElement {
  render() {
    return html\`<button>Count</button>\`;
  }
}
`;

    const res = transformResumableComponent(source, {
      filename: 'my-counter.ts',
      virtualModule: 'virtual:lit-core/resumable-adapter',
    });

    expect(res.transformed).toBe(true);
    expect(res.code).toContain('virtual:lit-core/resumable-adapter');
    expect(res.code).toContain('installResumableAdapter');
    expect(res.code).toContain('installResumableAdapter();');
    expect(res.code).toContain('class MyCounter extends LitElement');

    // Should not re-transform if already injected
    const secondPass = transformResumableComponent(res.code, { filename: 'my-counter.ts' });
    expect(secondPass.transformed).toBe(false);
  });
});
