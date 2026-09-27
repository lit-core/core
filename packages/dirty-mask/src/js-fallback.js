const SAFE_GLOBALS = new Set(['undefined', 'NaN', 'Infinity', 'null', 'true', 'false', 'Math', 'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'Date', 'Intl', 'RegExp']);

/**
 * Extracts balanced template expression `${...}` ranges inside a template literal.
 * @param {string} templateStr
 * @param {number} templateStartOffset
 */
function extractInterpolations(templateStr, templateStartOffset) {
  const interpolations = [];
  let i = 0;

  while (i < templateStr.length) {
    if (templateStr[i] === '$' && templateStr[i + 1] === '{') {
      const exprStart = i + 2;
      let depth = 1;
      let j = exprStart;
      let inString = null;

      while (j < templateStr.length && depth > 0) {
        const ch = templateStr[j];
        const prev = templateStr[j - 1];

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
            break;
          }
        }
        j++;
      }

      if (depth === 0) {
        const expr = templateStr.slice(exprStart, j);
        interpolations.push({
          start: templateStartOffset + exprStart,
          end: templateStartOffset + j,
          expr,
        });
        i = j + 1;
        continue;
      }
    }
    i++;
  }

  return interpolations;
}

/**
 * General-purpose JavaScript AST dependency analyzer for template expressions.
 * @param {string} expr
 * @param {Map<string, number>} reactiveProps
 * @returns {number}
 */
function computePartMaskJs(expr, reactiveProps) {
  const trimmed = expr.trim();
  if (trimmed.startsWith('(this.__litDirtyMask &')) {
    return 0; // Already wrapped
  }

  // Check for potential side effects or function calls:
  // e.g. function calls `foo()`, assignments `=`, `++`, `--`
  // Note: match function call `identifier(` or `this.foo(`
  const callRegex = /[a-zA-Z0-9_$)]\s*\(/;
  if (callRegex.test(trimmed)) {
    return -1;
  }

  // Check for assignment or update operators
  if (/(=|\+\+|--)/.test(trimmed) && !/(===|!==|<=|>=|=>)/.test(trimmed)) {
    return -1;
  }

  // Scan all identifiers and member expressions
  // Match `this.<prop>` or standalone identifiers
  const thisPropRegex = /this\.([a-zA-Z0-9_$]+)/g;
  let accessedBits = 0;
  let hasUnknown = false;
  let match;

  const foundThisProps = [];
  while ((match = thisPropRegex.exec(trimmed)) !== null) {
    foundThisProps.push({ prop: match[1], index: match.index });
  }

  for (const { prop } of foundThisProps) {
    if (reactiveProps.has(prop)) {
      const bitIndex = reactiveProps.get(prop);
      if (bitIndex < 30) {
        accessedBits |= 1 << bitIndex;
      } else {
        hasUnknown = true;
      }
    } else {
      // Accessed a non-reactive field or method on this!
      hasUnknown = true;
      break;
    }
  }

  if (hasUnknown) {
    return -1;
  }

  // Check for standalone identifiers that might be external variables
  // Replace string literals and `this.<prop>` first
  const sanitized = trimmed
    .replace(/(["'])(?:\\.|[^\\])*?\1/g, '')
    .replace(/this\.[a-zA-Z0-9_$]+/g, '')
    .replace(/\b(true|false|null|undefined)\b/g, '');

  const identRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
  while ((match = identRegex.exec(sanitized)) !== null) {
    const ident = match[1];
    if (!SAFE_GLOBALS.has(ident)) {
      // Non-reactive external variable reference
      hasUnknown = true;
      break;
    }
  }

  if (hasUnknown || accessedBits === 0) {
    return -1;
  }

  return accessedBits;
}

/**
 * Pure JavaScript general-purpose AST transform fallback for @lit-core/dirty-mask.
 *
 * @param {string} source
 * @param {import('./index.d.ts').DirtyMaskOptions} [_options]
 * @returns {import('./index.d.ts').DirtyMaskResult}
 */
export function transformDirtyMaskJs(source, _options = {}) {
  if (!source.includes('html') && !source.includes('svg')) {
    return {
      code: source,
      map: null,
      componentsCount: 0,
      maskedPartsCount: 0,
      propertiesCount: 0,
    };
  }

  const classRegex = /(?:export\s+(?:default\s+)?)?class\s+([A-Za-z0-9_$]+)?(?:\s+extends\s+[A-Za-z0-9_$.]+)?\s*\{/g;
  let match = classRegex.exec(source);
  const classes = [];

  while (match !== null) {
    const classStart = match.index;
    const bodyStart = match.index + match[0].length - 1;

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
      componentsCount: 0,
      maskedPartsCount: 0,
      propertiesCount: 0,
    };
  }

  const replacements = [];
  let totalComponentsCount = 0;
  let totalMaskedPartsCount = 0;
  let totalPropertiesCount = 0;

  for (const cls of classes) {
    const classBody = source.slice(cls.bodyStart, cls.bodyEnd + 1);

    // Collect reactive properties
    const reactiveProps = new Map();
    const sortedProps = [];

    const addProp = (name) => {
      if (!reactiveProps.has(name)) {
        const idx = sortedProps.length;
        reactiveProps.set(name, idx);
        sortedProps.push({ name, idx });
      }
    };

    // 1. Decorator: @property(...) propName or @property propName
    const propDecRegex = /@property(?:\([^)]*\))?\s*(?:declare\s+)?(?:accessor\s+)?([A-Za-z0-9_$]+)/g;
    let m;
    while ((m = propDecRegex.exec(classBody)) !== null) {
      addProp(m[1]);
    }

    // 2. Decorator: @state(...) propName or @state propName
    const stateDecRegex = /@state(?:\([^)]*\))?\s*(?:declare\s+)?(?:accessor\s+)?([A-Za-z0-9_$]+)/g;
    while ((m = stateDecRegex.exec(classBody)) !== null) {
      addProp(m[1]);
    }

    // 3. Static properties = { ... }
    const staticPropsRegex = /static\s+properties\s*=\s*\{/;
    const staticMatch = staticPropsRegex.exec(classBody);
    if (staticMatch) {
      const objStart = staticMatch.index + staticMatch[0].length - 1;
      let depth = 0;
      let inStr = null;
      let currentKey = '';
      let capturingKey = true;

      for (let i = objStart; i < classBody.length; i++) {
        const ch = classBody[i];
        const prev = classBody[i - 1];

        if (inStr) {
          if (ch === inStr && prev !== '\\') inStr = null;
        } else if (ch === '"' || ch === "'" || ch === '`') {
          inStr = ch;
        } else if (ch === '{') {
          depth++;
          if (depth === 1) capturingKey = true;
          else capturingKey = false;
        } else if (ch === '}') {
          depth--;
          if (depth === 1) capturingKey = true;
          if (depth === 0) break;
        } else if (depth === 1) {
          if (ch === ':') {
            const trimmedKey = currentKey.trim();
            if (/^[A-Za-z0-9_$]+$/.test(trimmedKey)) {
              addProp(trimmedKey);
            }
            currentKey = '';
            capturingKey = false;
          } else if (ch === ',') {
            currentKey = '';
            capturingKey = true;
          } else if (capturingKey) {
            currentKey += ch;
          }
        }
      }
    }

    // 4. Static get properties() { return { ... }; }
    const staticGetPropsRegex = /static\s+get\s+properties\s*\(\)\s*\{\s*return\s*\{/;
    const staticGetMatch = staticGetPropsRegex.exec(classBody);
    if (staticGetMatch) {
      const objStart = staticGetMatch.index + staticGetMatch[0].length - 1;
      let depth = 0;
      let inStr = null;
      let currentKey = '';
      let capturingKey = true;

      for (let i = objStart; i < classBody.length; i++) {
        const ch = classBody[i];
        const prev = classBody[i - 1];

        if (inStr) {
          if (ch === inStr && prev !== '\\') inStr = null;
        } else if (ch === '"' || ch === "'" || ch === '`') {
          inStr = ch;
        } else if (ch === '{') {
          depth++;
          if (depth === 1) capturingKey = true;
          else capturingKey = false;
        } else if (ch === '}') {
          depth--;
          if (depth === 1) capturingKey = true;
          if (depth === 0) break;
        } else if (depth === 1) {
          if (ch === ':') {
            const trimmedKey = currentKey.trim();
            if (/^[A-Za-z0-9_$]+$/.test(trimmedKey)) {
              addProp(trimmedKey);
            }
            currentKey = '';
            capturingKey = false;
          } else if (ch === ',') {
            currentKey = '';
            capturingKey = true;
          } else if (capturingKey) {
            currentKey += ch;
          }
        }
      }
    }

    if (reactiveProps.size === 0) {
      continue;
    }

    // Locate render() method in classBody
    const renderRegex = /\brender\s*\([^)]*\)\s*\{/;
    const renderMatch = renderRegex.exec(classBody);
    if (!renderMatch) {
      continue;
    }

    const renderMethodStart = cls.bodyStart + renderMatch.index;
    const renderBodyStart = renderMethodStart + renderMatch[0].length - 1;

    // Find end of render method
    let depth = 0;
    let inString = null;
    let renderBodyEnd = -1;

    for (let i = renderBodyStart; i < source.length; i++) {
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
          renderBodyEnd = i;
          break;
        }
      }
    }

    if (renderBodyEnd === -1) {
      continue;
    }

    const renderSrc = source.slice(renderBodyStart, renderBodyEnd + 1);

    // Find html`...` or svg`...` templates in renderSrc
    const templateTagRegex = /(?:html|svg)\s*`/g;
    let tMatch;
    let classMaskedParts = 0;

    while ((tMatch = templateTagRegex.exec(renderSrc)) !== null) {
      const backtickPos = renderBodyStart + tMatch.index + tMatch[0].length - 1;

      // Find matching closing backtick (ignoring ${...} blocks)
      let tDepth = 0;
      let tEnd = -1;
      for (let j = backtickPos + 1; j < renderBodyEnd; j++) {
        const c = source[j];
        const p = source[j - 1];

        if (tDepth > 0) {
          if (c === '}') {
            tDepth--;
          } else if (c === '{') {
            tDepth++;
          }
        } else if (c === '$' && source[j + 1] === '{') {
          tDepth++;
          j++;
        } else if (c === '`' && p !== '\\') {
          tEnd = j;
          break;
        }
      }

      if (tEnd === -1) continue;

      const templateContent = source.slice(backtickPos + 1, tEnd);
      const interpolations = extractInterpolations(templateContent, backtickPos + 1);

      for (const interp of interpolations) {
        if (interp.expr.trim().startsWith('(this.__litDirtyMask &')) {
          continue;
        }

        const mask = computePartMaskJs(interp.expr, reactiveProps);
        const repl = `(this.__litDirtyMask & ${mask}) ? (${interp.expr}) : noChange`;
        replacements.push({
          start: interp.start,
          end: interp.end,
          text: repl,
        });
        classMaskedParts++;
      }
    }

    if (classMaskedParts === 0) {
      continue;
    }

    totalComponentsCount++;
    totalMaskedPartsCount += classMaskedParts;
    totalPropertiesCount += reactiveProps.size;

    // Check for existing update() method in classBody
    const updateRegex = /\bupdate\s*\(([^)]*)\)\s*\{/;
    const updateMatch = updateRegex.exec(classBody);

    let maskCalcs = '';
    for (const { name, idx } of sortedProps) {
      const bit = 1 << idx;
      maskCalcs += `      if (changedProperties.has('${name}')) mask |= ${bit};\n`;
    }

    if (updateMatch) {
      const updateMethodStart = cls.bodyStart + updateMatch.index;
      const updateBodyStart = updateMethodStart + updateMatch[0].length - 1;
      const updateRest = source.slice(updateBodyStart);

      if (!updateRest.includes('this.__litDirtyMask')) {
        const updateInjection = `\n    let mask = 0;\n    if (this.hasUpdated) {\n${maskCalcs}    } else {\n      mask = -1;\n    }\n    this.__litDirtyMask = mask;\n`;
        replacements.push({
          start: updateBodyStart + 1,
          end: updateBodyStart + 1,
          text: updateInjection,
        });
      }
    } else {
      const synthesizedUpdate = `\n  update(changedProperties) {\n    let mask = 0;\n    if (this.hasUpdated) {\n${maskCalcs}    } else {\n      mask = -1;\n    }\n    this.__litDirtyMask = mask;\n    super.update(changedProperties);\n  }\n`;
      replacements.push({
        start: cls.bodyEnd,
        end: cls.bodyEnd,
        text: synthesizedUpdate,
      });
    }
  }

  if (totalComponentsCount === 0 || replacements.length === 0) {
    return {
      code: source,
      map: null,
      componentsCount: 0,
      maskedPartsCount: 0,
      propertiesCount: 0,
    };
  }

  // Ensure import { noChange } from 'lit';
  const hasNoChange = /\bimport\b[^;]*\bnoChange\b/.test(source);
  if (!hasNoChange) {
    const litNamedImportMatch = /import\s*\{([^}]*)\}\s*from\s*['"](?:lit|lit-html)['"]/.exec(source);
    if (litNamedImportMatch) {
      const bracePos = source.indexOf('{', litNamedImportMatch.index);
      replacements.push({
        start: bracePos + 1,
        end: bracePos + 1,
        text: ' noChange,',
      });
    } else {
      replacements.push({
        start: 0,
        end: 0,
        text: "import { noChange } from 'lit';\n",
      });
    }
  }

  // Apply replacements descending by start position
  replacements.sort((a, b) => b.start - a.start);

  let rewritten = source;
  for (const { start, end, text } of replacements) {
    if (start <= end && end <= rewritten.length) {
      rewritten = rewritten.slice(0, start) + text + rewritten.slice(end);
    }
  }

  return {
    code: rewritten,
    map: null,
    componentsCount: totalComponentsCount,
    maskedPartsCount: totalMaskedPartsCount,
    propertiesCount: totalPropertiesCount,
  };
}
