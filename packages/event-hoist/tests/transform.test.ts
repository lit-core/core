import { describe, expect, it } from 'vitest';
import { transformEventHoist } from '../src/index.js';

describe('event-hoist transform', () => {
  const fn = transformEventHoist;
  it('hoists method bindings like @click=${this._handleClick}', () => {
    const input = `
export class MyButton extends LitElement {
  render() {
    return html\`<button @click=\${this._handleClick}>Click me</button>\`;
  }
}
`;
    const res = fn(input);
    expect(res.hoistedEventsCount).toBe(1);
    expect(res.events).toEqual(['click']);
    expect(res.componentsCount).toBe(1);

    expect(res.code).toContain('data-lh-click="${this.__lhAction(this._handleClick)}"');
    expect(res.code).toContain('this.__lhActions = [];');
    expect(res.code).toMatch(/root\.addEventListener\(['"]click['"],\s*\(e\)\s*=>\s*this\.__lhDispatch\(['"]click['"],\s*e\)\)/);
    expect(res.code).toContain('__lhDispatch(eventName, event)');
    expect(res.code).toContain('__lhAction(handler)');
  });

  it('hoists inline closures like @click=${(e) => this._handleClick(e, id)}', () => {
    const input = `
export class TableView extends LitElement {
  render() {
    return html\`
      <ul>
        \${this.items.map((item, id) => html\`
          <li>
            <button @click=\${(e) => this._handleClick(e, id)}>Row \${id}</button>
          </li>
        \`)}
      </ul>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.hoistedEventsCount).toBe(1);
    expect(res.events).toEqual(['click']);
    expect(res.code).toContain('data-lh-click="${this.__lhAction((e) => this._handleClick(e, id))}"');
  });

  it('preserves non-bubbling events like @focus, @blur, @scroll', () => {
    const input = `
export class InputField extends LitElement {
  render() {
    return html\`
      <div>
        <button @click=\${this._onClick}>Click</button>
        <input @focus=\${this._onFocus} @blur=\${this._onBlur} @scroll=\${this._onScroll} />
      </div>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.hoistedEventsCount).toBe(1);
    expect(res.events).toEqual(['click']);
    expect(res.code).toContain('data-lh-click="${this.__lhAction(this._onClick)}"');
    expect(res.code).toContain('@focus=${this._onFocus}');
    expect(res.code).toContain('@blur=${this._onBlur}');
    expect(res.code).toContain('@scroll=${this._onScroll}');
    expect(res.code).not.toContain("root.addEventListener('focus'");
    expect(res.code).not.toContain("root.addEventListener('blur'");
  });

  it('preserves events with custom options like eventOptions({ capture: true })', () => {
    const input = `
export class CustomOptElem extends LitElement {
  render() {
    return html\`
      <div>
        <button @click=\${this._onClick}>Standard click</button>
        <button @click=\${eventOptions({ capture: true })(this._onCapturedClick)}>Capture click</button>
        <div @touchstart=\${eventOptions({ passive: true })(this._onTouch)}>Touch</div>
      </div>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.hoistedEventsCount).toBe(1);
    expect(res.events).toEqual(['click']);
    expect(res.code).toContain('data-lh-click="${this.__lhAction(this._onClick)}"');
    expect(res.code).toContain('@click=${eventOptions({ capture: true })(this._onCapturedClick)}');
    expect(res.code).toContain('@touchstart=${eventOptions({ passive: true })(this._onTouch)}');
  });

  it('hoists multiple bubbling events on elements', () => {
    const input = `
export class MultiEventElem extends LitElement {
  render() {
    return html\`
      <input
        @input=\${this._onInput}
        @change=\${this._onChange}
        @keydown=\${this._onKeydown}
      />
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.hoistedEventsCount).toBe(3);
    expect(res.events.sort()).toEqual(['change', 'input', 'keydown']);
    expect(res.code).toMatch(/root\.addEventListener\(['"]change['"]/);
    expect(res.code).toMatch(/root\.addEventListener\(['"]input['"]/);
    expect(res.code).toMatch(/root\.addEventListener\(['"]keydown['"]/);
  });

  it('handles quoted attribute expressions', () => {
    const input = `
export class QuotedAttrElem extends LitElement {
  render() {
    return html\`
      <button @click="\${this._onDoubleQuoted}">Double</button>
      <button @click='\${this._onSingleQuoted}'>Single</button>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.hoistedEventsCount).toBe(2);
    expect(res.code).toContain('data-lh-click="${this.__lhAction(this._onDoubleQuoted)}"');
    expect(res.code).toContain("data-lh-click='${this.__lhAction(this._onSingleQuoted)}'");
  });

  it('integrates with existing connectedCallback and firstUpdated methods', () => {
    const input = `
export class LifecycleElem extends LitElement {
  connectedCallback() {
    super.connectedCallback();
    this.setupListeners();
  }

  firstUpdated(props) {
    super.firstUpdated(props);
    this.focus();
  }

  render() {
    return html\`<button @click=\${this._onClick}>Btn</button>\`;
  }
}
`;
    const res = fn(input);
    expect(res.code).toMatch(/connectedCallback\(\)\s*\{\s*this\.__initLitEventHoist\(\);/);
    expect(res.code).toMatch(/firstUpdated\(props\)\s*\{\s*this\.__initLitEventHoist\(\);/);
    expect(res.code).not.toMatch(/super\.connectedCallback\?\.[\s\S]*super\.connectedCallback\?\./);
  });

  it('does not monkey patch event.stopPropagation or mutate Event prototype', () => {
    const input = `
export class CleanEventElem extends LitElement {
  render() {
    return html\`<button @click=\${this._onClick}>Click</button>\`;
  }
}
`;
    const res = fn(input);
    expect(res.code).not.toContain('origStop');
    expect(res.code).not.toContain('event.stopPropagation =');
    expect(res.code).toContain('if (event.cancelBubble)');
  });

  it('ignores classes not inheriting from LitElement or ReactiveElement', () => {
    const input = `
export class RegularClass extends NonLitBase {
  render() {
    return html\`<button @click=\${this._onClick}>Click</button>\`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(0);
    expect(res.hoistedEventsCount).toBe(0);
  });

  it('handles aliased Lit imports semantically', () => {
    const input = `
import { LitElement as BaseEl, html as litHtml, eventOptions as litOpt } from 'lit';
export class AliasedElem extends BaseEl {
  render() {
    return litHtml\`
      <button @click=\${this._onClick}>Standard</button>
      <button @click=\${litOpt({ capture: true })(this._onCapture)}>Capture</button>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.hoistedEventsCount).toBe(1);
    expect(res.events).toEqual(['click']);
    expect(res.code).toContain('data-lh-click=');
    expect(res.code).toContain('@click=${litOpt({ capture: true })(this._onCapture)}');
  });
});

describe('runtime dispatcher and event propagation logic', () => {
  it('executes delegated handler with correct context and stops on cancelBubble', () => {
    const input = `
import { LitElement, html } from 'lit';
export class DelegatedButtonComponent extends LitElement {
  render() {
    return html\`
      <div @click=\${this.onDiv}>
        <button @click=\${this.onBtn}>Click</button>
      </div>
    \`;
  }
}
`;
    const res = transformEventHoist(input);
    expect(res.componentsCount).toBe(1);
    expect(res.hoistedEventsCount).toBe(2);
    expect(res.events).toEqual(['click']);

    class FakeLitElement {
      shadowRoot = {
        listeners: {} as Record<string, (...args: any[]) => any>,
        addEventListener(evt: string, fn: (...args: any[]) => any) {
          this.listeners[evt] = fn;
        },
      };
      connectedCallback() {}
    }

    const html = (_strings: TemplateStringsArray, ...values: unknown[]) => values;
    const cleanCode = res.code.replace(/import\s*\{[^}]*\}\s*from\s*["\x27][^"\x27]+["\x27];?/g, '').replace(/export\s+/g, '');
    const factory = new Function(
      'LitElement',
      'html',
      `
      ${cleanCode}
      return DelegatedButtonComponent;
    `,
    );
    const DelegatedButtonComponent = factory(FakeLitElement, html) as any;

    const comp = new DelegatedButtonComponent();
    comp.connectedCallback();

    const calls: string[] = [];
    comp.onBtn = function (this: any, e: any) {
      calls.push('btn');
      e.stopPropagation();
    };
    comp.onDiv = function (this: any, _e: any) {
      calls.push('div');
    };

    comp.render();

    const divActionId = comp.__lhActions.indexOf(comp.onDiv);
    const btnActionId = comp.__lhActions.indexOf(comp.onBtn);

    const btnNode = {
      nodeType: 1,
      getAttribute: (attr: string) => (attr === 'data-lh-click' ? String(btnActionId) : null),
      hasAttribute: (attr: string) => attr === 'data-lh-click',
      getRootNode: () => comp.shadowRoot,
    };

    const divNode = {
      nodeType: 1,
      getAttribute: (attr: string) => (attr === 'data-lh-click' ? String(divActionId) : null),
      hasAttribute: (attr: string) => attr === 'data-lh-click',
      getRootNode: () => comp.shadowRoot,
    };

    const mockEvent = {
      target: btnNode,
      cancelBubble: false,
      stopPropagation() {
        this.cancelBubble = true;
      },
      composedPath() {
        return [btnNode, divNode, comp.shadowRoot];
      },
    };

    comp.shadowRoot.listeners.click(mockEvent);

    // Child button stopped propagation, so parent div handler should NOT be called
    expect(calls).toEqual(['btn']);
  });

  it('preserves shadow DOM boundaries by ignoring elements with different root node', () => {
    const input = `
import { LitElement, html } from 'lit';
export class HostBoundaryComponent extends LitElement {
  render() {
    return html\`
      <div @click=\${this.onHostClick}>Host content</div>
    \`;
  }
}
`;
    const res = transformEventHoist(input);
    expect(res.componentsCount).toBe(1);
    expect(res.hoistedEventsCount).toBe(1);

    class FakeLitElement {
      shadowRoot = {
        listeners: {} as Record<string, (...args: any[]) => any>,
        addEventListener(evt: string, fn: (...args: any[]) => any) {
          this.listeners[evt] = fn;
        },
      };
      connectedCallback() {}
    }

    const html = (_strings: TemplateStringsArray, ...values: unknown[]) => values;
    const cleanCode = res.code.replace(/import\s*\{[^}]*\}\s*from\s*["\x27][^"\x27]+["\x27];?/g, '').replace(/export\s+/g, '');
    const factory = new Function(
      'LitElement',
      'html',
      `
      ${cleanCode}
      return HostBoundaryComponent;
    `,
    );
    const HostBoundaryComponent = factory(FakeLitElement, html) as any;

    const host = new HostBoundaryComponent();
    host.connectedCallback();

    const calls: string[] = [];
    host.onHostClick = () => calls.push('host');
    host.render();

    const hostActionId = host.__lhActions.indexOf(host.onHostClick);

    const innerShadowRoot = {};
    const innerChildNode = {
      nodeType: 1,
      getAttribute: (_attr: string) => '0', // same id in child's template
      hasAttribute: (attr: string) => attr === 'data-lh-click',
      getRootNode: () => innerShadowRoot, // Belongs to inner shadow DOM!
    };

    const hostNode = {
      nodeType: 1,
      getAttribute: (attr: string) => (attr === 'data-lh-click' ? String(hostActionId) : null),
      hasAttribute: (attr: string) => attr === 'data-lh-click',
      getRootNode: () => host.shadowRoot,
    };

    const mockEvent = {
      target: innerChildNode,
      composedPath() {
        return [innerChildNode, hostNode, host.shadowRoot];
      },
    };

    host.shadowRoot.listeners.click(mockEvent);

    // Host only executed its own node, ignoring inner shadow child's data-lh-click!
    expect(calls).toEqual(['host']);
  });

  it('delegates events in Light DOM components where root is this', () => {
    const input = `
import { LitElement, html } from 'lit';
export class LightDomComponent extends LitElement {
  createRenderRoot() {
    return this;
  }
  render() {
    return html\`
      <button @click=\${this.onBtnClick}>Click me</button>
    \`;
  }
}
`;
    const res = transformEventHoist(input);
    expect(res.componentsCount).toBe(1);
    expect(res.hoistedEventsCount).toBe(1);

    class FakeLitElement {
      nodeType = 1; // HTMLElement
      shadowRoot = undefined;
      listeners: Record<string, (...args: any[]) => any> = {};
      addEventListener(evt: string, fn: (...args: any[]) => any) {
        this.listeners[evt] = fn;
      }
      contains(node: any) {
        return node === this || node._parent === this;
      }
      connectedCallback() {}
    }

    const html = (_strings: TemplateStringsArray, ...values: unknown[]) => values;
    const cleanCode = res.code.replace(/import\s*\{[^}]*\}\s*from\s*["\x27][^"\x27]+["\x27];?/g, '').replace(/export\s+/g, '');
    const factory = new Function(
      'LitElement',
      'html',
      `
      ${cleanCode}
      return LightDomComponent;
    `,
    );
    const LightDomComponent = factory(FakeLitElement, html) as any;

    const comp = new LightDomComponent();
    comp.connectedCallback();

    const calls: string[] = [];
    comp.onBtnClick = () => calls.push('clicked');
    comp.render();

    const actionId = comp.__lhActions.indexOf(comp.onBtnClick);

    const doc = {};
    const btnNode = {
      nodeType: 1,
      _parent: comp,
      getAttribute: (attr: string) => (attr === 'data-lh-click' ? String(actionId) : null),
      hasAttribute: (attr: string) => attr === 'data-lh-click',
      getRootNode: () => doc, // In Light DOM, getRootNode returns document!
    };

    const mockEvent = {
      target: btnNode,
      composedPath() {
        return [btnNode, comp];
      },
    };

    comp.listeners.click(mockEvent);
    expect(calls).toEqual(['clicked']);
  });
});
