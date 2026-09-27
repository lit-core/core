export const PURE_ARRAY_METHODS = ['map', 'filter', 'sort', 'slice', 'reduce', 'flatMap'];

export const MUTATING_ARRAY_METHODS = ['push', 'pop', 'shift', 'unshift', 'splice', 'reverse', 'fill', 'copyWithin'];

export const IMPURE_GLOBALS = ['window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'requestAnimationFrame'];

export const DOM_QUERY_METHODS = ['querySelector', 'querySelectorAll', 'getElementById', 'getElementsByClassName', 'getElementsByTagName', 'getElementsByName', 'closest'];

/**
 * Check whether an expression is a pure array method call chain rooted in `this.<prop>`
 * @param {string} expr
 * @returns {{ rootProp: string, dependencies: string[] } | null}
 */
export function analyzeCandidateJs(expr) {
  const trimmed = expr.trim();

  // Must end with a method call or be a call chain
  if (!trimmed.endsWith(')')) {
    return null;
  }

  // Must match one of pure array methods
  const hasPureMethod = PURE_ARRAY_METHODS.some((m) => trimmed.includes(`.${m}(`));
  if (!hasPureMethod) {
    return null;
  }

  // Check for mutating methods
  for (const m of MUTATING_ARRAY_METHODS) {
    const regex = new RegExp(`\\.${m}\\s*\\(`);
    if (regex.test(trimmed)) {
      return null;
    }
  }

  // Check for impure globals
  if (trimmed.includes('Date.now') || trimmed.includes('new Date') || trimmed.includes('Math.random') || trimmed.includes('performance.now') || trimmed.includes('crypto.randomUUID')) {
    return null;
  }

  for (const g of IMPURE_GLOBALS) {
    const regex = new RegExp(`\\b${g}\\b`);
    if (regex.test(trimmed)) {
      return null;
    }
  }

  for (const q of DOM_QUERY_METHODS) {
    const regex = new RegExp(`\\b${q}\\s*\\(`);
    if (regex.test(trimmed)) {
      return null;
    }
  }

  // Check for mutations / assignments
  // Avoid matching arrow functions '=>' or comparisons '===' or '!=='
  const assignmentRegex = /[^!=<>+\-*/%&|^~]=[^=>]/;
  if (assignmentRegex.test(trimmed) || trimmed.includes('++') || trimmed.includes('--') || trimmed.includes('delete ')) {
    return null;
  }

  // Check for arbitrary method calls on this (e.g. this.someAction())
  const thisMethodCallRegex = /this\.([a-zA-Z0-9_$]+)\s*\(/g;
  let methodMatch = thisMethodCallRegex.exec(trimmed);
  while (methodMatch !== null) {
    const calledProp = methodMatch[1];
    // If the method call is on 'this', e.g. this.fn(), it is impure unless it's a known pure method
    if (!PURE_ARRAY_METHODS.includes(calledProp)) {
      return null;
    }
    methodMatch = thisMethodCallRegex.exec(trimmed);
  }

  // Extract all property dependencies on this (e.g. this.items, this.filterText)
  const thisPropRegex = /this\.([a-zA-Z0-9_$]+)/g;
  const dependencies = [];
  let propMatch = thisPropRegex.exec(trimmed);

  while (propMatch !== null) {
    const prop = propMatch[1];
    if (!prop.startsWith('__memo') && !dependencies.includes(prop)) {
      // Ensure it is not a method call on this (already checked, but ensure)
      const afterMatch = trimmed.slice(propMatch.index + propMatch[0].length).trimStart();
      if (!afterMatch.startsWith('(')) {
        dependencies.push(prop);
      }
    }
    propMatch = thisPropRegex.exec(trimmed);
  }

  if (dependencies.length === 0) {
    return null;
  }

  // Root property is the first referenced property on this in the chain
  const rootProp = dependencies[0];

  return {
    rootProp,
    dependencies,
  };
}

/**
 * General-purpose JavaScript AST transform fallback for memoize.
 * Wraps pure array transformations in Lit render() with property-guarded cache slots.
 *
 * @param {string} source
 * @param {import('./index.d.ts').MemoizeOptions} [_options]
 * @returns {import('./index.d.ts').MemoizeResult}
 */
export function transformMemoizeJs(source, _options = {}) {
  // Fast check: must contain render and at least one array method
  if (
    !source.includes('render') ||
    (!source.includes('map') && !source.includes('filter') && !source.includes('sort') && !source.includes('slice') && !source.includes('reduce') && !source.includes('flatMap'))
  ) {
    return {
      code: source,
      map: null,
      memoizedCount: 0,
      componentsCount: 0,
    };
  }

  // Locate class definitions
  const classRegex = /(?:export\s+(?:default\s+)?)?class\s+([A-Za-z0-9_$]+)?(?:\s+extends\s+[A-Za-z0-9_$.]+)?\s*\{/g;
  let match = classRegex.exec(source);
  const classes = [];

  while (match !== null) {
    const classStart = match.index;
    const bodyStart = match.index + match[0].length - 1; // position of '{'

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
      memoizedCount: 0,
      componentsCount: 0,
    };
  }

  const replacements = [];
  let totalMemoizedCount = 0;
  let componentsCount = 0;

  for (const cls of classes) {
    const classSrc = source.slice(cls.bodyStart, cls.bodyEnd + 1);

    // Locate render() method in class body
    const renderRegex = /\brender\s*\([^)]*\)\s*\{/g;
    const renderMatch = renderRegex.exec(classSrc);
    if (!renderMatch) {
      continue;
    }

    const renderBodyStartInClass = renderMatch.index + renderMatch[0].length - 1;

    let rDepth = 0;
    let rInString = null;
    let renderBodyEndInClass = -1;

    for (let i = renderBodyStartInClass; i < classSrc.length; i++) {
      const ch = classSrc[i];
      const prev = classSrc[i - 1];

      if (rInString) {
        if (ch === rInString && prev !== '\\') {
          rInString = null;
        }
      } else if (ch === '"' || ch === "'" || ch === '`') {
        rInString = ch;
      } else if (ch === '{') {
        rDepth++;
      } else if (ch === '}') {
        rDepth--;
        if (rDepth === 0) {
          renderBodyEndInClass = i;
          break;
        }
      }
    }

    if (renderBodyEndInClass === -1) {
      continue;
    }

    const renderBodyAbsStart = cls.bodyStart + renderBodyStartInClass + 1;
    const renderBodyAbsEnd = cls.bodyStart + renderBodyEndInClass;
    const renderBodySrc = source.slice(renderBodyAbsStart, renderBodyAbsEnd);

    const usedSlots = new Set();
    let counter = 0;
    let classMemoizedCount = 0;

    // 1. Scan for variable declarations inside render()
    // e.g. const list = this.items.map(...);
    const varDeclRegex = /\b(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*/g;
    let varMatch = varDeclRegex.exec(renderBodySrc);

    while (varMatch !== null) {
      const currentMatch = varMatch;
      varMatch = varDeclRegex.exec(renderBodySrc);

      const varName = currentMatch[1];
      const varStartInBody = currentMatch.index;
      const exprStartInBody = currentMatch.index + currentMatch[0].length;

      // Find the end of this statement (';' or newline before next statement)
      let sDepth = 0;
      let sInStr = null;
      let stmtEndInBody = -1;

      for (let j = exprStartInBody; j < renderBodySrc.length; j++) {
        const c = renderBodySrc[j];
        const p = renderBodySrc[j - 1];

        if (sInStr) {
          if (c === sInStr && p !== '\\') sInStr = null;
        } else if (c === '"' || c === "'" || c === '`') {
          sInStr = c;
        } else if (c === '(' || c === '{' || c === '[') {
          sDepth++;
        } else if (c === ')' || c === '}' || c === ']') {
          sDepth--;
        } else if (c === ';' && sDepth === 0) {
          stmtEndInBody = j + 1;
          break;
        } else if (c === '\n' && sDepth === 0) {
          stmtEndInBody = j;
          break;
        }
      }

      if (stmtEndInBody === -1) continue;

      let exprStr = renderBodySrc.slice(exprStartInBody, stmtEndInBody).trim();
      if (exprStr.endsWith(';')) {
        exprStr = exprStr.slice(0, -1).trim();
      }

      const cand = analyzeCandidateJs(exprStr);
      if (cand) {
        const baseProp = cand.rootProp;
        const valSlot = usedSlots.has(baseProp) ? `${baseProp}_${counter}` : baseProp;
        usedSlots.add(valSlot);
        counter++;

        const absStmtStart = renderBodyAbsStart + varStartInBody;
        const absStmtEnd = renderBodyAbsStart + stmtEndInBody;

        // Determine line indentation
        const before = source.slice(0, absStmtStart);
        const lineStart = before.lastIndexOf('\n') + 1;
        const indentMatch = before.slice(lineStart).match(/^[ \t]*/);
        const indent = indentMatch ? indentMatch[0] : '    ';

        const guardStr = cand.dependencies.map((dep) => `this.__memo_${dep}_ref === this.${dep}`).join(' && ');

        const savesStr = cand.dependencies.map((dep) => `${indent}  this.__memo_${dep}_ref = this.${dep};`).join('\n');

        const block =
          `${indent}let ${varName};\n` +
          `${indent}if (${guardStr}) {\n` +
          `${indent}  ${varName} = this.__memo_${valSlot}_val;\n` +
          `${indent}} else {\n` +
          `${savesStr}\n` +
          `${indent}  ${varName} = this.__memo_${valSlot}_val = ${exprStr};\n` +
          `${indent}}`;

        replacements.push({
          start: absStmtStart,
          end: absStmtEnd,
          text: block,
        });

        classMemoizedCount++;
      }
    }

    // 2. Scan for direct return statements returning candidate pipelines
    // e.g. return this.items.filter(...).map(...);
    const returnRegex = /\breturn\s+/g;
    let retMatch = returnRegex.exec(renderBodySrc);
    while (retMatch !== null) {
      const currentMatch = retMatch;
      retMatch = returnRegex.exec(renderBodySrc);

      const retStartInBody = currentMatch.index;
      const exprStartInBody = currentMatch.index + currentMatch[0].length;
      const afterReturn = renderBodySrc.slice(exprStartInBody).trimStart();
      if (afterReturn.startsWith('html`') || afterReturn.startsWith('svg`')) {
        continue;
      }

      // Find the end of return statement
      let rDepth = 0;
      let rInStr = null;
      let retEndInBody = -1;

      for (let j = exprStartInBody; j < renderBodySrc.length; j++) {
        const c = renderBodySrc[j];
        const p = renderBodySrc[j - 1];

        if (rInStr) {
          if (c === rInStr && p !== '\\') rInStr = null;
        } else if (c === '"' || c === "'" || c === '`') {
          rInStr = c;
        } else if (c === '(' || c === '{' || c === '[') {
          rDepth++;
        } else if (c === ')' || c === '}' || c === ']') {
          if (rDepth === 0) {
            retEndInBody = j;
            break;
          }
          rDepth--;
        } else if (c === ';' && rDepth === 0) {
          retEndInBody = j;
          break;
        }
      }

      if (retEndInBody === -1) {
        retEndInBody = renderBodySrc.length;
      }

      const exprStr = renderBodySrc.slice(exprStartInBody, retEndInBody).trim();
      const cand = analyzeCandidateJs(exprStr);
      if (cand) {
        const baseProp = cand.rootProp;
        const valSlot = usedSlots.has(baseProp) ? `${baseProp}_${counter}` : baseProp;
        usedSlots.add(valSlot);

        const varName = usedSlots.has(`_memo_${baseProp}`) ? `_memoized_${baseProp}_${counter}` : `_memoized_${baseProp}`;
        usedSlots.add(`_memo_${baseProp}`);
        counter++;

        const absStmtStart = renderBodyAbsStart + retStartInBody;
        const absExprStart = renderBodyAbsStart + exprStartInBody;
        const absExprEnd = renderBodyAbsStart + retEndInBody;

        const before = source.slice(0, absStmtStart);
        const lineStart = before.lastIndexOf('\n') + 1;
        const indentMatch = before.slice(lineStart).match(/^[ \t]*/);
        const indent = indentMatch ? indentMatch[0] : '    ';

        const guardStr = cand.dependencies.map((dep) => `this.__memo_${dep}_ref === this.${dep}`).join(' && ');

        const savesStr = cand.dependencies.map((dep) => `${indent}  this.__memo_${dep}_ref = this.${dep};`).join('\n');

        const block =
          `${indent}let ${varName};\n` +
          `${indent}if (${guardStr}) {\n` +
          `${indent}  ${varName} = this.__memo_${valSlot}_val;\n` +
          `${indent}} else {\n` +
          `${savesStr}\n` +
          `${indent}  ${varName} = this.__memo_${valSlot}_val = ${exprStr};\n` +
          `${indent}}\n`;

        replacements.push({
          start: absStmtStart,
          end: absStmtStart,
          text: block,
        });

        replacements.push({
          start: absExprStart,
          end: absExprEnd,
          text: varName,
        });

        classMemoizedCount++;
      }
    }

    // 3. Scan for tagged template expressions inside render()
    // e.g. html`... ${this.items.map(...)} ...`
    const templateTagRegex = /\b(?:html|svg)\s*`/g;
    let tMatch = templateTagRegex.exec(renderBodySrc);

    while (tMatch !== null) {
      const currentMatch = tMatch;
      tMatch = templateTagRegex.exec(renderBodySrc);

      const templateStartInBody = currentMatch.index;
      const quasiStartInBody = currentMatch.index + currentMatch[0].length;

      // Find closing backtick for this template
      const tDepth = 0;
      let _tEndInBody = -1;
      const inlineCandidates = [];

      for (let j = quasiStartInBody; j < renderBodySrc.length; j++) {
        const c = renderBodySrc[j];
        const p = renderBodySrc[j - 1];

        if (c === '`' && p !== '\\' && tDepth === 0) {
          _tEndInBody = j + 1;
          break;
        } else if (c === '$' && renderBodySrc[j + 1] === '{') {
          // Found interpolation start
          const exprStart = j + 2;
          let braceDepth = 1;
          let exprInStr = null;
          let exprEnd = -1;

          for (let k = exprStart; k < renderBodySrc.length; k++) {
            const ec = renderBodySrc[k];
            const ep = renderBodySrc[k - 1];

            if (exprInStr) {
              if (ec === exprInStr && ep !== '\\') exprInStr = null;
            } else if (ec === '"' || ec === "'" || ec === '`') {
              exprInStr = ec;
            } else if (ec === '{') {
              braceDepth++;
            } else if (ec === '}') {
              braceDepth--;
              if (braceDepth === 0) {
                exprEnd = k;
                break;
              }
            }
          }

          if (exprEnd !== -1) {
            const exprContent = renderBodySrc.slice(exprStart, exprEnd).trim();
            const cand = analyzeCandidateJs(exprContent);

            if (cand) {
              const baseProp = cand.rootProp;
              const valSlot = usedSlots.has(baseProp) ? `${baseProp}_${counter}` : baseProp;
              usedSlots.add(valSlot);

              const varName = usedSlots.has(`_memo_${baseProp}`) ? `_memoized_${baseProp}_${counter}` : `_memoized_${baseProp}`;
              usedSlots.add(`_memo_${baseProp}`);
              counter++;

              inlineCandidates.push({
                exprStartInBody: exprStart,
                exprEndInBody: exprEnd,
                exprContent,
                rootProp: cand.rootProp,
                varName,
                valSlot,
                dependencies: cand.dependencies,
              });
            }

            j = exprEnd; // advance loop past interpolation
          }
        }
      }

      if (inlineCandidates.length > 0) {
        // Find statement start enclosing this template (e.g. 'return' or beginning of statement)
        const beforeTpl = renderBodySrc.slice(0, templateStartInBody);
        let stmtStartInBody = 0;
        const lastReturn = beforeTpl.lastIndexOf('return ');
        const lastSemi = beforeTpl.lastIndexOf(';');
        const lastBrace = beforeTpl.lastIndexOf('{');

        if (lastReturn !== -1 && lastReturn > lastSemi && lastReturn > lastBrace) {
          stmtStartInBody = lastReturn;
        } else if (lastSemi !== -1 && lastSemi > lastBrace) {
          // First non-whitespace after semicolon
          const afterSemi = beforeTpl.slice(lastSemi + 1);
          const nonWsMatch = afterSemi.match(/\S/);
          if (nonWsMatch && nonWsMatch.index !== undefined) {
            stmtStartInBody = lastSemi + 1 + nonWsMatch.index;
          } else {
            stmtStartInBody = templateStartInBody;
          }
        } else {
          stmtStartInBody = templateStartInBody;
        }

        const absStmtStart = renderBodyAbsStart + stmtStartInBody;

        // Determine line indentation
        const before = source.slice(0, absStmtStart);
        const lineStart = before.lastIndexOf('\n') + 1;
        const indentMatch = before.slice(lineStart).match(/^[ \t]*/);
        const indent = indentMatch ? indentMatch[0] : '    ';

        const blocks = [];

        for (const item of inlineCandidates) {
          const guardStr = item.dependencies.map((dep) => `this.__memo_${dep}_ref === this.${dep}`).join(' && ');

          const savesStr = item.dependencies.map((dep) => `${indent}  this.__memo_${dep}_ref = this.${dep};`).join('\n');

          const block =
            `${indent}let ${item.varName};\n` +
            `${indent}if (${guardStr}) {\n` +
            `${indent}  ${item.varName} = this.__memo_${item.valSlot}_val;\n` +
            `${indent}} else {\n` +
            `${savesStr}\n` +
            `${indent}  ${item.varName} = this.__memo_${item.valSlot}_val = ${item.exprContent};\n` +
            `${indent}}`;

          blocks.push(block);

          // Replace template interpolation with memoized variable
          const absExprStart = renderBodyAbsStart + item.exprStartInBody;
          const absExprEnd = renderBodyAbsStart + item.exprEndInBody;

          replacements.push({
            start: absExprStart,
            end: absExprEnd,
            text: item.varName,
          });

          classMemoizedCount++;
        }

        // Insert memo blocks before the statement
        replacements.push({
          start: absStmtStart,
          end: absStmtStart,
          text: `${blocks.join('\n')}\n`,
        });
      }
    }

    if (classMemoizedCount > 0) {
      totalMemoizedCount += classMemoizedCount;
      componentsCount++;
    }
  }

  if (replacements.length === 0) {
    return {
      code: source,
      map: null,
      memoizedCount: 0,
      componentsCount: 0,
    };
  }

  // Sort replacements descending by start position to safely apply string slices
  replacements.sort((a, b) => b.start - a.start);

  let rewritten = source;
  for (const { start, end, text } of replacements) {
    rewritten = rewritten.slice(0, start) + text + rewritten.slice(end);
  }

  return {
    code: rewritten,
    map: null,
    memoizedCount: totalMemoizedCount,
    componentsCount,
  };
}
