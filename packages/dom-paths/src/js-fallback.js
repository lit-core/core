const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/**
 * Computes structural DOM child paths for dynamic parts in a Lit html tagged template.
 *
 * @param {string[] | TemplateStringsArray} strings The static string pieces of the template
 * @param {object} [options]
 * @param {boolean} [options.normalizeWhitespace=true] Whether to normalize inter-tag formatting whitespace
 * @returns {number[][]} Array of paths from root, one per expression
 */
export function computeDomPathsJs(strings, options = {}) {
  const normalizeWhitespace = options.normalizeWhitespace !== false;
  const numExpressions = strings.length - 1;
  if (numExpressions <= 0) {
    return [];
  }

  const paths = new Array(numExpressions);

  // Stack of open elements: { tag, childCount, path, lastChildWasText, hasNonWhitespaceText }
  const stack = [];
  const root = { childCount: 0, path: [], lastChildWasText: false };

  let currentOpeningElement = null; // { tag, path, isSelfClosing, isVoid }
  let state = 'TEXT'; // 'TEXT' | 'TAG' | 'ATTR_UNQUOTED' | 'ATTR_SINGLE' | 'ATTR_DOUBLE' | 'COMMENT'
  let pendingText = '';

  for (let k = 0; k < strings.length; k++) {
    const s = strings[k];
    let i = 0;

    while (i < s.length) {
      if (state === 'COMMENT') {
        const endComment = s.indexOf('-->', i);
        if (endComment !== -1) {
          i = endComment + 3;
          state = 'TEXT';
        } else {
          i = s.length;
        }
        continue;
      }

      if (state === 'ATTR_DOUBLE') {
        const quoteIdx = s.indexOf('"', i);
        if (quoteIdx !== -1) {
          i = quoteIdx + 1;
          state = 'TAG';
        } else {
          i = s.length;
        }
        continue;
      }

      if (state === 'ATTR_SINGLE') {
        const quoteIdx = s.indexOf("'", i);
        if (quoteIdx !== -1) {
          i = quoteIdx + 1;
          state = 'TAG';
        } else {
          i = s.length;
        }
        continue;
      }

      if (state === 'ATTR_UNQUOTED') {
        while (i < s.length && !/\s|[/>]/.test(s[i])) {
          i++;
        }
        state = 'TAG';
        continue;
      }

      if (state === 'TAG') {
        const ch = s[i];
        if (ch === '"') {
          state = 'ATTR_DOUBLE';
          i++;
        } else if (ch === "'") {
          state = 'ATTR_SINGLE';
          i++;
        } else if (ch === '=' && i + 1 < s.length && !/\s|['"]/.test(s[i + 1])) {
          state = 'ATTR_UNQUOTED';
          i++;
        } else if (ch === '/' && i + 1 < s.length && s[i + 1] === '>') {
          // Self-closing tag <tag />
          if (currentOpeningElement) {
            currentOpeningElement.isSelfClosing = true;
          }
          i += 2;
          state = 'TEXT';
          currentOpeningElement = null;
        } else if (ch === '>') {
          // Tag end
          i++;
          state = 'TEXT';
          if (currentOpeningElement) {
            if (!currentOpeningElement.isVoid && !currentOpeningElement.isSelfClosing) {
              stack.push({
                tag: currentOpeningElement.tag,
                childCount: 0,
                path: currentOpeningElement.path,
                lastChildWasText: false,
              });
            }
            currentOpeningElement = null;
          }
        } else {
          i++;
        }
        continue;
      }

      // state === 'TEXT'
      if (s.startsWith('<!--', i)) {
        flushPendingText();
        state = 'COMMENT';
        i += 4;
        continue;
      }

      if (s.startsWith('</', i)) {
        flushPendingText();
        const closeEnd = s.indexOf('>', i + 2);
        if (closeEnd !== -1) {
          const closeTag = s
            .slice(i + 2, closeEnd)
            .trim()
            .toLowerCase();
          i = closeEnd + 1;
          // Pop matching element or last element from stack
          for (let p = stack.length - 1; p >= 0; p--) {
            if (stack[p].tag === closeTag || p === stack.length - 1) {
              stack.splice(p, 1);
              break;
            }
          }
          const cur = currentContainer();
          cur.lastChildWasText = false;
        } else {
          i = s.length;
        }
        continue;
      }

      if (s[i] === '<') {
        // Tag start
        flushPendingText();
        const match = /^<([a-zA-Z0-9_\-:]+)/.exec(s.slice(i));
        if (match) {
          const rawTag = match[1];
          const lowerTag = rawTag.toLowerCase();
          const cur = currentContainer();
          const elemIndex = cur.childCount;
          const elemPath = cur.path.length > 0 ? [...cur.path, elemIndex] : [elemIndex];

          cur.childCount++;
          cur.lastChildWasText = false;

          const isVoid = VOID_ELEMENTS.has(lowerTag);
          currentOpeningElement = {
            tag: lowerTag,
            path: elemPath,
            isVoid,
            isSelfClosing: false,
          };

          i += match[0].length;
          state = 'TAG';
          continue;
        }
      }

      // Normal text character
      pendingText += s[i];
      i++;
    }

    // Now at expression boundary k (between strings[k] and strings[k+1])
    if (k < numExpressions) {
      if (state === 'TAG' || state === 'ATTR_UNQUOTED' || state === 'ATTR_SINGLE' || state === 'ATTR_DOUBLE') {
        // Expression is in attribute position on currentOpeningElement
        if (currentOpeningElement) {
          paths[k] = [...currentOpeningElement.path];
        } else {
          const cur = currentContainer();
          paths[k] = [...cur.path];
        }
      } else {
        // Expression is in child content position
        flushPendingText();
        const cur = currentContainer();
        const childIndex = cur.childCount;
        const childPath = cur.path.length > 0 ? [...cur.path, childIndex] : [childIndex];
        paths[k] = childPath;

        cur.childCount++;
        cur.lastChildWasText = false;
      }
    }
  }

  return paths;

  function currentContainer() {
    return stack.length > 0 ? stack[stack.length - 1] : root;
  }

  function flushPendingText() {
    if (!pendingText) return;
    const text = pendingText;
    pendingText = '';

    const cur = currentContainer();
    const isPureWhitespace = /^\s*$/.test(text);

    if (normalizeWhitespace && isPureWhitespace) {
      // Inter-element formatting whitespace is ignored
      return;
    }

    if (!cur.lastChildWasText) {
      cur.childCount++;
      cur.lastChildWasText = true;
    }
  }
}

/**
 * Transforms JavaScript / TypeScript source code to inject precomputed structural DOM paths.
 *
 * @param {string} source
 * @param {object} [options]
 * @returns {{ code: string, map: any, componentsCount: number, pathsCount: number, paths: number[][][] }}
 */
export function transformDomPathsJs(source, options = {}) {
  if (!source.includes('html') || !source.includes('`')) {
    return {
      code: source,
      map: null,
      componentsCount: 0,
      pathsCount: 0,
      paths: [],
    };
  }

  // Regex to detect classes
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
      componentsCount: 0,
      pathsCount: 0,
      paths: [],
    };
  }

  const allClassPaths = [];
  let totalPathsCount = 0;
  let transformedComponents = 0;
  const insertions = [];

  for (const cls of classes) {
    const classSrc = source.slice(cls.bodyStart, cls.bodyEnd + 1);

    // Skip if already has static __litPartPaths
    if (classSrc.includes('__litPartPaths')) {
      continue;
    }

    // Locate html tagged templates inside this class
    const htmlTemplates = extractHtmlTemplates(classSrc);
    if (htmlTemplates.length === 0) {
      continue;
    }

    // Use primary template (from render() or the largest/first template)
    let selectedTemplate = htmlTemplates[0];
    const renderTemplate = htmlTemplates.find((t) => t.isRender);
    if (renderTemplate) {
      selectedTemplate = renderTemplate;
    }

    const templatePaths = computeDomPathsJs(selectedTemplate.quasis, options);
    if (templatePaths.length === 0) {
      continue;
    }

    allClassPaths.push(templatePaths);
    totalPathsCount += templatePaths.length;
    transformedComponents++;

    // Format static __litPartPaths descriptor array
    const formattedPaths = templatePaths.map((p, idx) => `    [${p.join(', ')}], // Part ${idx}`).join('\n');

    const staticDescriptor = `\n  static __litPartPaths = [\n${formattedPaths}\n  ];\n`;

    // Insert static descriptor right after class opening brace
    insertions.push({
      pos: cls.bodyStart + 1,
      text: staticDescriptor,
    });
  }

  if (insertions.length === 0) {
    return {
      code: source,
      map: null,
      componentsCount: 0,
      pathsCount: 0,
      paths: [],
    };
  }

  // Sort insertions from end to start
  insertions.sort((a, b) => b.pos - a.pos);
  let newCode = source;
  for (const ins of insertions) {
    newCode = newCode.slice(0, ins.pos) + ins.text + newCode.slice(ins.pos);
  }

  return {
    code: newCode,
    map: null,
    componentsCount: transformedComponents,
    pathsCount: totalPathsCount,
    paths: allClassPaths,
  };
}

/**
 * Extracts Lit html tagged template literals and their quasis from class source.
 */
function extractHtmlTemplates(classSrc) {
  const templates = [];
  const tagRegex = /(?:render\s*\([^)]*\)\s*\{[\s\S]*?)?\bhtml\s*`/g;
  let match = tagRegex.exec(classSrc);

  while (match !== null) {
    const templateStart = match.index + match[0].length - 1; // backtick index
    const isRender = match[0].startsWith('render');

    // Parse template literal with expression interpolation
    const quasis = [];
    let curQuasi = '';
    let i = templateStart + 1;
    let depth = 0;
    let inExpr = false;

    while (i < classSrc.length) {
      const ch = classSrc[i];
      const prev = classSrc[i - 1];

      if (!inExpr) {
        if (ch === '`' && prev !== '\\') {
          // Template end
          quasis.push(curQuasi);
          break;
        } else if (ch === '$' && i + 1 < classSrc.length && classSrc[i + 1] === '{') {
          // Expression start
          quasis.push(curQuasi);
          curQuasi = '';
          inExpr = true;
          depth = 1;
          i += 2;
          continue;
        } else {
          curQuasi += ch;
        }
      } else {
        // Inside ${...}
        if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            inExpr = false;
          }
        }
      }
      i++;
    }

    if (quasis.length > 1) {
      templates.push({
        isRender,
        quasis,
      });
    }

    match = tagRegex.exec(classSrc);
  }

  return templates;
}
