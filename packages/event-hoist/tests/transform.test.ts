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
});

describe('runtime dispatcher and event propagation logic', () => {
  it('executes delegated handler with correct context and stops on cancelBubble', () => {
    // Create component instance mock with injected dispatcher methods
    const calls: string[] = [];

    class TestComponent {
      shadowRoot = {
        listeners: {} as Record<string, (...args: any[]) => any>,
        addEventListener(evt: string, fn: (...args: any[]) => any) {
          this.listeners[evt] = fn;
        },
      };
      __lhActions: ((...args: any[]) => any)[] = [];
      __lhInitialized = false;

      __initLitEventHoist() {
        if (this.__lhInitialized) return;
        this.__lhInitialized = true;
        const root: any = this.shadowRoot || this;
        root.addEventListener('click', (e: any) => this.__lhDispatch('click', e));
      }

      __lhAction(handler: (...args: any[]) => any) {
        if (!this.__lhActions) this.__lhActions = [];
        const id = this.__lhActions.length;
        this.__lhActions.push(handler);
        return id;
      }

      __lhDispatch(eventName: string, event: any) {
        const attr = `data-lh-${eventName}`;
        const root = this.shadowRoot || this;
        let stopped = false;
        const origStop = event.stopPropagation;
        if (origStop) {
          event.stopPropagation = function (...args: any[]) {
            stopped = true;
            return origStop.apply(this, args);
          };
        }
        const path = event.composedPath ? event.composedPath() : [];
        if (path.length > 0) {
          for (const node of path) {
            if (node === root) break;
            if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute(attr)) {
              if (node.getRootNode && node.getRootNode() !== root) {
                continue;
              }
              const actionId = Number(node.getAttribute(attr));
              const handler = this.__lhActions?.[actionId];
              if (typeof handler === 'function') {
                handler.call(this, event);
              }
              if (event.cancelBubble || stopped) break;
            }
          }
        } else {
          let target = event.target;
          while (target && target !== root && target.nodeType === 1) {
            if (target.hasAttribute(attr)) {
              if (!target.getRootNode || target.getRootNode() === root) {
                const actionId = Number(target.getAttribute(attr));
                const handler = this.__lhActions?.[actionId];
                if (typeof handler === 'function') {
                  handler.call(this, event);
                }
                if (event.cancelBubble || stopped) break;
              }
            }
            target = target.parentElement;
          }
        }
      }
    }

    const comp = new TestComponent();
    comp.__initLitEventHoist();

    const btnHandler = function (this: any, e: any) {
      calls.push('btn');
      e.stopPropagation();
    };
    const divHandler = function (this: any, _e: any) {
      calls.push('div');
    };

    const btnId = comp.__lhAction(btnHandler);
    const divId = comp.__lhAction(divHandler);

    const btnNode = {
      nodeType: 1,
      getAttribute: (attr: string) => (attr === 'data-lh-click' ? String(btnId) : null),
      hasAttribute: (attr: string) => attr === 'data-lh-click',
      getRootNode: () => comp.shadowRoot,
    };

    const divNode = {
      nodeType: 1,
      getAttribute: (attr: string) => (attr === 'data-lh-click' ? String(divId) : null),
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
    const calls: string[] = [];

    class HostComponent {
      shadowRoot = {
        listeners: {} as Record<string, (...args: any[]) => any>,
        addEventListener(evt: string, fn: (...args: any[]) => any) {
          this.listeners[evt] = fn;
        },
      };
      __lhActions: ((...args: any[]) => any)[] = [];
      __lhInitialized = false;

      __initLitEventHoist() {
        const root: any = this.shadowRoot || this;
        root.addEventListener('click', (e: any) => this.__lhDispatch('click', e));
      }

      __lhAction(handler: (...args: any[]) => any) {
        if (!this.__lhActions) this.__lhActions = [];
        const id = this.__lhActions.length;
        this.__lhActions.push(handler);
        return id;
      }

      __lhDispatch(eventName: string, event: any) {
        const attr = `data-lh-${eventName}`;
        const root = this.shadowRoot || this;
        const path = event.composedPath ? event.composedPath() : [];
        for (const node of path) {
          if (node === root) break;
          if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute(attr)) {
            if (node.getRootNode && node.getRootNode() !== root) {
              continue;
            }
            const actionId = Number(node.getAttribute(attr));
            const handler = this.__lhActions?.[actionId];
            if (typeof handler === 'function') {
              handler.call(this, event);
            }
          }
        }
      }
    }

    const host = new HostComponent();
    host.__initLitEventHoist();

    const hostActionId = host.__lhAction(() => calls.push('host'));

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
});
