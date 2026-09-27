import fs from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

let nativeBinding = null;

const currentPlatform = platform();
const currentArch = arch();

// Try loading platform-specific native addon
try {
  if (currentPlatform === 'darwin') {
    if (currentArch === 'arm64') {
      nativeBinding = require('../elem-proxy.darwin-arm64.node');
    } else {
      nativeBinding = require('../elem-proxy.darwin-x64.node');
    }
  } else if (currentPlatform === 'linux') {
    if (currentArch === 'x64') {
      nativeBinding = require('../elem-proxy.linux-x64-gnu.node');
    }
  }
} catch (_err) {
  // If platform-specific binary is not found, check target/release dylib or local node file
  try {
    const localNode = path.resolve(import.meta.dirname, '../elem-proxy.darwin-arm64.node');
    if (fs.existsSync(localNode)) {
      nativeBinding = require(localNode);
    } else {
      const dylib = path.resolve(import.meta.dirname, '../target/release/libelem_proxy.dylib');
      if (fs.existsSync(dylib)) {
        nativeBinding = require(dylib);
      }
    }
  } catch {}
}

export function transformElemProxy(source, options = {}) {
  if (nativeBinding && typeof nativeBinding.transformElemProxy === 'function') {
    try {
      return nativeBinding.transformElemProxy(source, options);
    } catch (_err) {
      // Fall through to JS fallback
    }
  }

  // Pure JavaScript general-purpose fallback parser & transform
  return transformElemProxyJs(source, options);
}

/**
 * General-purpose JavaScript AST transform fallback for elem-proxy.
 * Identifies @customElement and customElements.define, collects @property/@state/static properties,
 * and emits the lightweight proxy registration stub with deferred implementation getter.
 */
export function transformElemProxyJs(source, options = {}) {
  // Check if file contains custom elements
  const hasCustomElementDec = /@customElement\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/.test(source);
  const hasCeDefine = /customElements\.define\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([a-zA-Z0-9_$]+)\s*\)/.test(source);

  if (!hasCustomElementDec && !hasCeDefine) {
    return {
      code: source,
      map: null,
      proxiedElementsCount: 0,
      elements: [],
    };
  }

  const elements = [];
  let code = source;

  // Pattern 1: @customElement('tag-name') [export] class ClassName extends ... { ... }
  const classRegex = /(?:@customElement\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*)?(export\s+default\s+|export\s+)?class\s+([a-zA-Z0-9_$]+)(?:\s+extends\s+([^{]+))?\s*\{([\s\S]*?)\n\}/g;

  // Collect customElements.define statements: tag -> className
  const defineMap = new Map();
  const defineRegex = /customElements\.define\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([a-zA-Z0-9_$]+)\s*\);?/g;
  for (const defineMatch of source.matchAll(defineRegex)) {
    defineMap.set(defineMatch[2], { tag: defineMatch[1], fullMatch: defineMatch[0] });
  }

  const matches = [];

  for (const match of source.matchAll(classRegex)) {
    const fullClassMatch = match[0];
    const decTag = match[1];
    const exportPrefix = match[2] || '';
    const className = match[3];
    const extendsClause = match[4] || '';
    const classBody = match[5];

    let tagName = decTag;
    if (!tagName && defineMap.has(className)) {
      tagName = defineMap.get(className).tag;
    }

    if (!tagName) continue;

    matches.push({
      fullMatch: fullClassMatch,
      tagName,
      className,
      exportPrefix,
      extendsClause,
      classBody,
      index: match.index,
    });
  }

  if (matches.length === 0) {
    return {
      code: source,
      map: null,
      proxiedElementsCount: 0,
      elements: [],
    };
  }

  for (const m of matches) {
    // Extract properties & observed attributes from classBody
    const properties = new Set();
    const observedAttributes = new Set();

    // 1. @property(...) propName
    const propDecRegex = /@property\s*\(([^)]*)\)\s*(?:(?:public|private|protected|readonly)\s+)?([a-zA-Z0-9_$]+)/g;
    for (const propMatch of m.classBody.matchAll(propDecRegex)) {
      const opts = propMatch[1];
      const pName = propMatch[2];
      properties.add(pName);

      if (/attribute\s*:\s*false/.test(opts) || /state\s*:\s*true/.test(opts)) {
        // no attribute
      } else {
        const attrMatch = /attribute\s*:\s*['"`]([^'"`]+)['"`]/.exec(opts);
        if (attrMatch) {
          observedAttributes.add(attrMatch[1]);
        } else {
          observedAttributes.add(pName.toLowerCase());
        }
      }
    }

    // 2. @state(...) propName
    const stateDecRegex = /@state\s*\([^)]*\)\s*(?:(?:public|private|protected|readonly)\s+)?([a-zA-Z0-9_$]+)/g;
    for (const stateMatch of m.classBody.matchAll(stateDecRegex)) {
      properties.add(stateMatch[1]);
    }

    // 3. static properties = { ... }
    const staticPropsMatch = /static\s+properties\s*=\s*\{([\s\S]*?)\};/.exec(m.classBody);
    if (staticPropsMatch) {
      const inner = staticPropsMatch[1];
      const entryRegex = /([a-zA-Z0-9_$]+)\s*:\s*\{([^}]*)\}/g;
      for (const entryMatch of inner.matchAll(entryRegex)) {
        const pName = entryMatch[1];
        const pOpts = entryMatch[2];
        properties.add(pName);

        if (/attribute\s*:\s*false/.test(pOpts) || /state\s*:\s*true/.test(pOpts)) {
          // no attribute
        } else {
          const attrMatch = /attribute\s*:\s*['"`]([^'"`]+)['"`]/.exec(pOpts);
          if (attrMatch) {
            observedAttributes.add(attrMatch[1]);
          } else {
            observedAttributes.add(pName.toLowerCase());
          }
        }
      }
    }

    // 4. static get observedAttributes() { return [...]; }
    const staticObsMatch = /static\s+get\s+observedAttributes\s*\(\)\s*\{[\s\S]*?return\s*\[([^\]]*)\];?\s*\}/.exec(m.classBody);
    if (staticObsMatch) {
      const arr = staticObsMatch[1];
      const itemRegex = /['"`]([^'"`]+)['"`]/g;
      let itemMatch;
      while ((itemMatch = itemRegex.exec(arr)) !== null) {
        observedAttributes.add(itemMatch[1]);
      }
    }

    const propsList = Array.from(properties).sort();
    const attrsList = Array.from(observedAttributes).sort();

    elements.push({
      tagName: m.tagName,
      className: m.className,
      properties: propsList,
      observedAttributes: attrsList,
    });

    // Strip @customElement decorator from class body inside closure
    const classSourceClean = m.fullMatch
      .replace(/@customElement\s*\(\s*['"`][^'"`]+['"`]\s*\)\s*/, '')
      .replace(/^export\s+default\s+/, '')
      .replace(/^export\s+/, '');

    const proxyName = `${m.className}Proxy`;
    const getterName = `__getImpl_${m.className}`;
    const implVar = `__impl_${m.className}`;
    const propsVar = `__props_${m.className}`;

    const observedAttrsJson = JSON.stringify(attrsList);
    const propertiesJson = JSON.stringify(propsList);

    const exportStmt = m.exportPrefix.includes('default') ? `export default ${proxyName};\n` : m.exportPrefix.includes('export') ? `export { ${proxyName} as ${m.className} };\n` : '';

    const replacement = `let ${implVar} = null;
function ${getterName}() {
  if (!${implVar}) {
    ${classSourceClean}
    ${implVar} = ${m.className};
  }
  return ${implVar};
}
class ${proxyName} extends HTMLElement {
  static get observedAttributes() {
    return ${observedAttrsJson};
  }
  static [Symbol.hasInstance](instance) {
    const Impl = ${getterName}();
    return (Impl && instance instanceof Impl) || super[Symbol.hasInstance](instance);
  }
  static getImplementation() {
    return ${getterName}();
  }
  constructor() {
    super();
    this.__upgraded = false;
    this.__attrBuffer = null;
  }
  attributeChangedCallback(name, oldValue, newValue) {
    if (this.__upgraded) {
      if (typeof super.attributeChangedCallback === 'function') {
        super.attributeChangedCallback(name, oldValue, newValue);
      }
    } else {
      if (!this.__attrBuffer) this.__attrBuffer = new Map();
      this.__attrBuffer.set(name, newValue);
    }
  }
  connectedCallback() {
    this.__upgrade();
  }
  __upgrade() {
    if (this.__upgraded) return this;
    this.__upgraded = true;
    const RealClass = ${getterName}();
    if (!RealClass) return this;
    if (typeof RealClass.finalize === 'function') {
      RealClass.finalize();
    }
    Object.setPrototypeOf(this, RealClass.prototype);
    if (RealClass.elementStyles && !this.shadowRoot && typeof this.attachShadow === 'function') {
      const root = this.attachShadow(RealClass.shadowRootOptions || { mode: 'open' });
      if (Array.isArray(RealClass.elementStyles)) {
        root.adoptedStyleSheets = RealClass.elementStyles.map((s) => s?.styleSheet || s).filter(Boolean);
      } else if (RealClass.elementStyles?.styleSheet) {
        root.adoptedStyleSheets = [RealClass.elementStyles.styleSheet];
      }
    }
    if (!this.renderOptions) {
      this.renderOptions = { host: this };
    }
    if (typeof this._$Ev === 'function') {
      this._$Ev();
    } else if (typeof RealClass.prototype._$Ev === 'function') {
      RealClass.prototype._$Ev.call(this);
    }
    if (this.__attrBuffer) {
      for (const [k, v] of this.__attrBuffer) {
        if (typeof this.attributeChangedCallback === 'function') {
          this.attributeChangedCallback(k, null, v);
        }
      }
      this.__attrBuffer = null;
    }
    if (typeof RealClass.prototype.connectedCallback === 'function') {
      RealClass.prototype.connectedCallback.call(this);
    }
    return this;
  }
}
const ${propsVar} = ${propertiesJson};
for (const __p of ${propsVar}) {
  Object.defineProperty(${proxyName}.prototype, __p, {
    get() {
      this.__upgrade();
      return this[__p];
    },
    set(__v) {
      this.__upgrade();
      this[__p] = __v;
    },
    configurable: true,
    enumerable: true
  });
}
customElements.define('${m.tagName}', ${proxyName});
${exportStmt}`;

    code = code.replace(m.fullMatch, replacement);

    // If there was an external customElements.define, remove it
    if (defineMap.has(m.className)) {
      code = code.replace(defineMap.get(m.className).fullMatch, '');
    }
  }

  return {
    code,
    map: null,
    proxiedElementsCount: elements.length,
    elements,
  };
}
