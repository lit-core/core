---
name: transform-principles
description: >-
  Core principles and architectural standards for writing AST transforms in Rust and TypeScript.
  Use whenever analyzing, rewriting, or emitting JavaScript, TypeScript, HTML, or CSS code across any package.
---

# Transform principles and architectural vision

This skill defines the architectural mindset and non-negotiable principles for writing code transforms in this monorepo.

Whenever you write or modify transform logic (in Rust or TypeScript), you must adhere to these conceptual principles. Do not look to surrounding legacy code for permission to cut corners; this skill is the authoritative standard.

---

## The input contract: assume minified, bundled, and hostile input

Every transform must operate under the assumption that the input code may be minified, transpiled, bundled, or mangled.

### What survives minification (safe to rely on)
- **Import module specifiers**: Canonical strings like `"lit"`, `"lit/decorators.js"`, `"@lit/reactive-element"`.
- **Imported member names**: What was imported from the specifier (e.g. `property`, `customElement`), resolved to whatever local identifier it was bound to via symbol semantics.
- **Unshadowed standard globals**: `HTMLElement`, `customElements`, `CSSStyleSheet`, `document`, `window`.
- **Public component interface**: Names defined by standard specs or the Lit component contract on classes *proven* to be Lit components (`render`, `styles`).
- **Literal values**: String literals, numbers, booleans (evaluating `!0` and `!1` as boolean equivalents).

### What is erased or mangled (never rely on)
- **Local identifier names**: `import { LitElement as e, html as t } from 'lit'` means components will extend `e` and call `t`, not `LitElement` or `html`.
- **Helper function names**: Transpiled decorators may appear as `__decorate`, `_ts_decorate`, `babelHelpers.decorate`, or inline comma expressions.
- **Syntactic sugar**: `if (a) b()` may be minified to `a && b()`. `true` may become `!0`.
- **Formatting, comments, and whitespace**: Completely removed.
- **Template whitespace and quotes**: Attribute values in HTML templates might lack quotes (`attr=val`), and optional end tags might be omitted.

---

## The eleven core principles

### 1. Assume the input is hostile and minified
- **Do**: rely exclusively on semantic identity, resolved imports, and standard specifications.
- **Don't**: assume code looks like human-written, formatted TypeScript. Never rely on local variable names or default aliases.

### 2. Identify things by meaning, not by spelling
- **Do**: resolve an identifier to its declaration or import via symbol analysis (`oxc_semantic`). If an identifier refers to an import from a known module, it is that entity, regardless of its local name.
- **Don't**: check strings or identifier names directly (e.g. checking if `callee_name == "property"` or `heritage.contains("Element")`). Never do substring searches in source code.

### 3. Structure in, structure out
- **Do**: inspect AST structures and construct new AST structures using AST builders (`AstBuilder`). Treat embedded CSS and HTML as structured payloads managed by dedicated parsers and serialised by code generators.
- **Don't**: synthesize code via string interpolation (`format!`, `push_str`), string concatenation, or template strings. Never re-parse synthesized strings back into AST (`Parser::new`). Re-parsing string-spliced code is string splicing with extra steps.

### 4. Carry over, don't rewrite
- **Do**: take the author's existing AST expressions (event handler functions, default value initializers, reactive expressions) and move them directly into the output AST (`clone_in` into the target arena).
- **Don't**: slice source spans, trim strings (`trim_start_matches("this.")`), or try to reverse-engineer or reconstruct expressions from string text.

### 5. Prove it or leave it alone
- **Do**: transform only when you have positive AST-level proof that the component satisfies all requirements for that transform. If any aspect is unknown, unsupported, or ambiguous (such as dynamic decorator calls, unsupported lifecycle hooks, or unrecognized mixins), cleanly bail out, leave the code intact, and emit a diagnostic. An untouched file is a successful, safe outcome.
- **Don't**: guess intent, make up default values (e.g. assuming an unspecified event is `"click"`), invent fallback markup (e.g. `<slot></slot>`), fabricate fake stubs (e.g. empty `requestUpdate` methods returning false), or quietly ignore options you cannot handle.

### 6. Don't reach outside the component
- **Do**: confine all generated code and side effects strictly to the module or class being compiled.
- **Don't**: patch global prototypes (`HTMLElement.prototype`), add monkey patches to shared runtime objects, or rely on global ambient state to make lowered components function.

### 7. Generated names must not collide by construction
- **Do**: generate identifiers using scope-aware unique identifier utilities (such as traversal context UID generators) or use private class fields (`#field`) after validating existing class members.
- **Don't**: invent fixed prefixes or hardcoded variable names (`__lit_sheet_0`, `__lit_node_1`, `b_1`) assuming they will never collide with user variables or other modules.

### 8. Use real parsers for embedded languages
- **Do**: parse embedded templates (HTML, SVG, CSS) with spec-compliant parsers that follow the exact same parsing rules as modern browser engines.
- **Don't**: write ad hoc tokenizers, slice on delimiters like `find("-->")` or `find('>')`, or use regex search-and-replace to manipulate nested languages.

### 9. Fix the class of bug, not the case in front of you
- **Do**: when a component or benchmark fails, identify the structural AST pattern that was unhandled, formulate the general principle, and ensure the fix works for any component exhibiting that pattern across any codebase.
- **Don't**: introduce special-cased checks, tag whitelists, suite-specific substrings, or heuristics designed solely to make a specific benchmark pass or look favorable.

### 10. Be honest about outcomes
- **Do**: report exact metrics, bailouts, and diagnostics. If removing a fake stub causes a component to bail out to a safer mode and bundle size or speedup decreases, accept that result as an accurate reflection of current compiler capabilities.
- **Don't**: paper over unsupported constructs with synthetic mocks, fake speedup constants, or silent stubbing to inflate benchmark metrics.

### 11. Follow the vision, not the code next to you
- **Do**: treat these eleven principles as the sole authoritative reference. When you see existing code in the repository that violates these principles (e.g. `format!` string synthesis or substring checks), consider it technical debt to be fixed, never a pattern to replicate.
- **Don't**: copy an anti-pattern simply because it already exists in a nearby file.

---

## Pre-flight checklist before finishing any transform task

Before concluding any work on a transform pass, ask yourself:
1. **Minification check**: If every variable and local import alias in the test input was mangled to single letters (`a`, `b`, `c`), would my transform still work?
2. **String splicing check**: Did I use `format!`, `push_str`, or `Parser::new` to create code? If yes, rewrite it using `AstBuilder`.
3. **Substring check**: Did I use `.contains()`, `.find()`, or string slice matching on source code or AST names? If yes, replace it with semantic symbol checking or AST node pattern matching.
4. **Generalization check**: Does my change contain any string, tag name, class name, or heuristic specific to a single component or design system library? If yes, remove it.
5. **Bailout safety**: If the input uses an advanced or unexpected Lit feature, does the transform cleanly leave the component untouched, or does it attempt to patch or guess behavior?
