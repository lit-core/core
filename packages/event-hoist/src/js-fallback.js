export const SAFE_BUBBLING_EVENTS = [
  'click',
  'dblclick',
  'contextmenu',
  'input',
  'change',
  'submit',
  'reset',
  'keydown',
  'keyup',
  'keypress',
  'pointerdown',
  'pointerup',
  'pointercancel',
  'mousedown',
  'mouseup',
  'touchstart',
  'touchend',
  'touchcancel',
];

/**
 * General-purpose JavaScript AST transform fallback for event-hoist.
 * Hoists bubbling child element event listeners to a single delegated listener on ShadowRoot.
 *
 * @param {string} source
 * @param {import('./index.d.ts').EventHoistOptions} [options]
 * @returns {import('./index.d.ts').EventHoistResult}
 */
export function transformEventHoistJs(source, options = {}) {
  if (!source.includes('html') || !source.includes('@')) {
    return {
      code: source,
      map: null,
      hoistedEventsCount: 0,
      events: [],
      componentsCount: 0,
    };
  }

  const safeEventSet = new Set(options.events || SAFE_BUBBLING_EVENTS);

  // Match class definitions in the source
  // We locate class boundaries and html tagged templates within them
  const classRegex = /(?:export\s+(?:default\s+)?)?class\s+([A-Za-z0-9_$]+)?(?:\s+extends\s+[A-Za-z0-9_$.]+)?\s*\{/g;
  let match = classRegex.exec(source);
  const classes = [];

  while (match !== null) {
    const classStart = match.index;
    const bodyStart = match.index + match[0].length - 1; // position of '{'

    // Find matching closing '}' for this class body
    let depth = 0;
    let inString = null;
    let bodyEnd = -1;

    for (let i = bodyStart; i < source.length; i++) {
      const ch = source[i];
      const prev = source[i - 1];

      if (inString) {
        if (ch === inString && prev !== '\\') {
          inString = null;
        }
      } else if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          bodyEnd = i;
          break;
        }
      }
    }

    if (bodyEnd !== -1) {
      classes.push({
        className: match[1] || 'AnonymousComponent',
        classStart,
        bodyStart,
        bodyEnd,
      });
    }

    match = classRegex.exec(source);
  }

  if (classes.length === 0) {
    return {
      code: source,
      map: null,
      hoistedEventsCount: 0,
      events: [],
      componentsCount: 0,
    };
  }

  const replacements = [];
  let totalHoistedCount = 0;
  const allEvents = new Set();
  let transformedComponents = 0;

  for (const cls of classes) {
    const classSrc = source.slice(cls.bodyStart, cls.bodyEnd + 1);

    const classHoistedEvents = new Set();
    let classHoistedCount = 0;

    // Find attribute event bindings: @([a-zA-Z0-9_-]+)=(['"]?)\$\{ anywhere in templates in this class
    const eventAttrRegex = /@([a-zA-Z0-9_-]+)=(['"]?)\$\{/g;
    let evtMatch = eventAttrRegex.exec(classSrc);

    while (evtMatch !== null) {
      const eventName = evtMatch[1];
      const quote = evtMatch[2]; // '' or '"' or "'"
      const matchStart = evtMatch.index;
      const exprStartInClass = evtMatch.index + evtMatch[0].length;

      if (!safeEventSet.has(eventName)) {
        evtMatch = eventAttrRegex.exec(classSrc);
        continue;
      }

      // Find matching closing '}' for this expression ${...}
      let exprDepth = 1;
      let exprInStr = null;
      let exprEndInClass = -1;

      for (let j = exprStartInClass; j < classSrc.length; j++) {
        const c = classSrc[j];
        const p = classSrc[j - 1];

        if (exprInStr) {
          if (c === exprInStr && p !== '\\') {
            exprInStr = null;
          }
        } else if (c === '"' || c === "'" || c === '`') {
          exprInStr = c;
        } else if (c === '{') {
          exprDepth++;
        } else if (c === '}') {
          exprDepth--;
          if (exprDepth === 0) {
            exprEndInClass = j;
            break;
          }
        }
      }

      if (exprEndInClass === -1) {
        evtMatch = eventAttrRegex.exec(classSrc);
        continue;
      }

      const exprContent = classSrc.slice(exprStartInClass, exprEndInClass);

      // Check for eventOptions, capture:, passive:, once:
      if (exprContent.includes('eventOptions') || exprContent.includes('capture:') || exprContent.includes('passive:') || exprContent.includes('once:')) {
        evtMatch = eventAttrRegex.exec(classSrc);
        continue;
      }

      // Replacement before expression: @<event>=${ -> data-lh-<event>="${this.__lhAction(
      const absAttrStart = cls.bodyStart + matchStart;
      const absExprStart = cls.bodyStart + exprStartInClass;

      const beforeRepl = quote === "'" ? `data-lh-${eventName}='\${this.__lhAction(` : `data-lh-${eventName}="\${this.__lhAction(`;

      replacements.push({
        start: absAttrStart,
        end: absExprStart,
        text: beforeRepl,
      });

      // Replacement after expression: } -> )}"
      const absExprEnd = cls.bodyStart + exprEndInClass;
      let absCloseEnd = absExprEnd + 1; // past '}'

      if (quote && classSrc[exprEndInClass + 1] === quote) {
        absCloseEnd += 1; // past quote
      }

      const afterRepl = quote === "'" ? ")}'" : ')}"';

      replacements.push({
        start: absExprEnd,
        end: absCloseEnd,
        text: afterRepl,
      });

      classHoistedEvents.add(eventName);
      classHoistedCount++;

      evtMatch = eventAttrRegex.exec(classSrc);
    }

    if (classHoistedCount === 0) {
      continue;
    }

    transformedComponents++;
    totalHoistedCount += classHoistedCount;
    for (const evt of classHoistedEvents) {
      allEvents.add(evt);
    }

    // Detect existing lifecycle methods in this class
    const hasRender = /\brender\s*\([^)]*\)\s*\{/.test(classSrc);
    const hasConnected = /\bconnectedCallback\s*\([^)]*\)\s*\{/.test(classSrc);
    const hasFirstUpdated = /\bfirstUpdated\s*\([^)]*\)\s*\{/.test(classSrc);
    const hasWillUpdate = /\bwillUpdate\s*\([^)]*\)\s*\{/.test(classSrc);

    // Inject resets and hook calls into existing methods
    if (hasRender) {
      const renderMatch = /\brender\s*\([^)]*\)\s*\{/.exec(classSrc);
      if (renderMatch) {
        const renderBodyStart = cls.bodyStart + renderMatch.index + renderMatch[0].length;
        replacements.push({
          start: renderBodyStart,
          end: renderBodyStart,
          text: '\n    this.__lhActions = [];',
        });
      }
    }

    if (hasConnected) {
      const connMatch = /\bconnectedCallback\s*\([^)]*\)\s*\{/.exec(classSrc);
      if (connMatch) {
        const connBodyStart = cls.bodyStart + connMatch.index + connMatch[0].length;
        replacements.push({
          start: connBodyStart,
          end: connBodyStart,
          text: '\n    this.__initLitEventHoist();',
        });
      }
    }

    if (hasFirstUpdated) {
      const firstMatch = /\bfirstUpdated\s*\([^)]*\)\s*\{/.exec(classSrc);
      if (firstMatch) {
        const firstBodyStart = cls.bodyStart + firstMatch.index + firstMatch[0].length;
        replacements.push({
          start: firstBodyStart,
          end: firstBodyStart,
          text: '\n    this.__initLitEventHoist();',
        });
      }
    }

    if (hasWillUpdate) {
      const willMatch = /\bwillUpdate\s*\([^)]*\)\s*\{/.exec(classSrc);
      if (willMatch) {
        const willBodyStart = cls.bodyStart + willMatch.index + willMatch[0].length;
        replacements.push({
          start: willBodyStart,
          end: willBodyStart,
          text: '\n    this.__lhActions = [];',
        });
      }
    }

    // Synthesize dispatcher and delegated listener methods before class closing brace
    let injected = '';

    if (!hasConnected) {
      injected += `
  connectedCallback() {
    super.connectedCallback?.();
    this.__initLitEventHoist();
  }
`;
    }

    if (!hasFirstUpdated) {
      injected += `
  firstUpdated(changedProperties) {
    super.firstUpdated?.(changedProperties);
    this.__initLitEventHoist();
  }
`;
    }

    if (!hasWillUpdate) {
      injected += `
  willUpdate(changedProperties) {
    this.__lhActions = [];
    super.willUpdate?.(changedProperties);
  }
`;
    }

    const sortedClassEvents = Array.from(classHoistedEvents).sort();

    injected += `
  __lhActions = [];
  __lhInitialized = false;

  __initLitEventHoist() {
    if (this.__lhInitialized) return;
    this.__lhInitialized = true;
    const root = this.shadowRoot || this;
`;

    for (const evt of sortedClassEvents) {
      injected += `    root.addEventListener('${evt}', (e) => this.__lhDispatch('${evt}', e));\n`;
    }

    injected += `  }

  __lhDispatch(eventName, event) {
    const attr = \`data-lh-\${eventName}\`;
    const root = this.shadowRoot || this;
    let stopped = false;
    const origStop = event.stopPropagation;
    if (origStop) {
      event.stopPropagation = function() {
        stopped = true;
        return origStop.apply(this, arguments);
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
          const handler = this.__lhActions && this.__lhActions[actionId];
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
            const handler = this.__lhActions && this.__lhActions[actionId];
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

  __lhAction(handler) {
    if (!this.__lhActions) this.__lhActions = [];
    const id = this.__lhActions.length;
    this.__lhActions.push(handler);
    return id;
  }
`;

    replacements.push({
      start: cls.bodyEnd,
      end: cls.bodyEnd,
      text: injected,
    });
  }

  if (replacements.length === 0) {
    return {
      code: source,
      map: null,
      hoistedEventsCount: 0,
      events: [],
      componentsCount: 0,
    };
  }

  // Sort replacements descending by start position
  replacements.sort((a, b) => b.start - a.start);

  let rewritten = source;
  for (const repl of replacements) {
    rewritten = rewritten.slice(0, repl.start) + repl.text + rewritten.slice(repl.end);
  }

  return {
    code: rewritten,
    map: null,
    hoistedEventsCount: totalHoistedCount,
    events: Array.from(allEvents).sort(),
    componentsCount: transformedComponents,
  };
}
