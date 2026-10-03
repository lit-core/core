# Monorepo guidelines for AI agents

Welcome to the `@lit-core` monorepo. This file outlines core architectural principles, development workflows, and non-negotiable writing and coding rules for all AI agents operating in this workspace.

---

## ✍️ Writing and Documentation Casing Rule (Mandatory)

> **IMPORTANT WRITING INSTRUCTION**:
> Whenever you write text or documentation, **do NOT uppercase every single word**.
>
> - **Never use Title Case for headings, titles, table headers, bullet items, descriptions, or summaries.**
>   - ❌ Incorrect: `Detailed Breakdown Of Component Rules`
>   - ❌ Incorrect: `Evaluated Design Systems And Libraries`
>   - ❌ Incorrect: `Shared Constructable Sheets Created`
>   - ❌ Incorrect: `Optimization Tool / Mode`
>   - ✅ Correct: `Detailed breakdown of component rules`
>   - ✅ Correct: `Evaluated design systems and libraries`
>   - ✅ Correct: `Shared constructable sheets created`
>   - ✅ Correct: `Optimization tool or mode`
> - **Always use sentence case** for:
>   - Markdown titles (`#`, `##`, `###`, etc.)
>   - Table headers (`| Library | Rules scanned | Duplicate rules fused |`)
>   - Pull request titles, commit messages, and summaries
>   - Diagram labels and descriptions
>   - Prose, callouts, and notes
>   - UI components, navigation tabs, buttons, section headers, badges, and filters
> - Preserve proper nouns, brand names, acronyms, and code identifiers exactly as they are (e.g. `Lit`, `Vite`, `AST`, `Rollup`, `HTML`, `CSSStyleSheet`, `oxc`, `lightningcss`, `Carbon Web Components`).

---

## 🎨 UI typography, layout, and visual design rules (Mandatory)

> **MANDATORY DESIGN RULE: SCANDINAVIAN MINIMALISM AND BALANCED TYPOGRAPHY**:
> Every frontend application, viewer dashboard, and showcase in this monorepo must adhere to the following UI standards:
>
> 1. **Zero uppercasing anywhere**:
>    - Never use CSS `uppercase` or `tracking-wider` on headings, badges, tabs, or buttons.
>    - Never use Title Case. All UI copy must strictly use **sentence case**.
> 2. **16px root font size and 1rem minimum floor**:
>    - Root HTML must be 16px (`html { font-size: 16px; }`).
>    - **Never go below 1rem (16px) anywhere in the UI.**
>    - Strictly forbid `text-xs` (12px) and `text-sm` (14px). Use `text-base` (1rem, 16px) as the floor for badges, helper text, and secondary labels.
> 3. **Thinner font weights**:
>    - Use `font-light` (300) for secondary copy, neutral values, helper text, and unselected pills.
>    - Use `font-normal` (400) for body copy, table values, and table headers.
>    - Use `font-medium` (500) strictly for section titles and active button/pill states.
>    - Strictly forbid heavy weights (`font-semibold`, `font-bold`).
> 4. **Reuse standard typography variants**:
>    - Page / view title: `text-2xl font-light text-zinc-950 tracking-tight`
>    - Section heading: `text-lg font-medium text-zinc-950 tracking-tight`
>    - Base body & table cell: `text-base font-normal text-zinc-900` or `text-base font-light text-zinc-700`
>    - Filter label, column header & supporting text: `text-base font-light text-zinc-500` (never low-contrast `text-zinc-400`)
>    - Tabular numeric value: `tabular-nums text-base font-light text-zinc-700`
> 5. **Wide container alignment**:
>    - Header and main content must share identical container constraints: `w-full max-w-[1600px] mx-auto px-6 sm:px-10 lg:px-14`.
> 6. **Headings outside surface cards**:
>    - Never trap section headings inside cards or nested boxes. Place headings cleanly on the canvas outside and above the surface cards.
> 7. **Unboxed filter controls**:
>    - Filter and selection controls live directly on the `#fafafb` canvas with fixed-width muted labels (`w-28 text-base font-light text-zinc-500 shrink-0`), not wrapped inside bulky white cards.
> 8. **Combined soft modern shadows and super subtle border definition**:
>    - Strictly forbid heavy 1px gray borders (`border border-zinc-200`, `border-b`, `border-t`).
>    - Elevate cards, surfaces, panels, and tables with soft, diffuse, larger modern shadows paired with a super subtle border ring: `shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5` (transitioning to `shadow-[0_12px_36px_rgb(0,0,0,0.06)]` on hover).
>    - Keep interactive controls flat (`shadow-none`) without heavy shadows. Dropdowns use rich emerald with white text (`bg-emerald-700 hover:bg-emerald-800 text-white`).
>    - When an active or selected outline is needed (e.g. overview cards), use a thick green ring (`ring-[3px] ring-emerald-600`), keeping the card background identical to inactive cards.
> 9. **Balanced grayscales and contrast**:
>    - Clean surface distinction between `#ffffff` cards and `#fafafb` canvas provided by soft shadows.
>    - Maintain legible contrast: use `text-zinc-500` (WCAG AA compliant ~4.6:1 against `#fafafb`) for column headers, secondary labels, and muted text.
> 10. **Component isolation via iframes**:
>    - Third-party Web Components must render in isolated `<iframe>` canvases to strictly prevent global reset stylesheets from leaking into the dashboard.

## 🌐 General-purpose architecture rule (Never hardcode library-specific heuristics)

> **MANDATORY DESIGN RULE: STRICTLY GENERAL PURPOSE**:
> Every compiler pass, AST visitor, parser, clustering algorithm, transform, lowering logic, and bundler plugin in this monorepo must be **100% general-purpose**.
>
> - **NEVER EVER hardcode library-specific, component-suite-specific, or vendor-specific hacks into core tools.**
>   - ❌ **Strictly forbidden**:
>     - Hardcoding component suite class names, IDs, or substrings (e.g. `iconContainer`, `indicator`, `badge`, `chevron`, `focus-ring`) to trigger, bias, or filter AST extraction.
>     - Restricting element, tag, attribute, or style extraction to whitelists designed to make specific benchmarks or libraries pass or look favorable.
>     - Hardcoding non-standard external library decorator wrappers (e.g. `carbonElement`) into core decorator lowering or regex detection rather than parsing standard Lit decorators (`@customElement`, `@property`, `@state`, etc.).
>     - Hardcoding arbitrary package-specific paths, component namespaces, or vendor conventions into general-purpose transforms.
    - Synthesizing client scripts or loader code via string interpolation templates (e.g. `format!`) or naive path fallbacks (e.g. `'/components/' + tag + '.js'`) rather than AST-driven injection and bundler manifests.
    - Requiring downstream consumers to install, import, or initialize manual runtime packages or client loader modules.
>   - ✅ **Required general-purpose design**:
>     - Rely exclusively on official Web Component, DOM, HTML, CSS, JavaScript, and Lit language specifications.
>     - Static fragment deduplication must inspect any valid HTML, SVG, or custom element subtree structurally and hierarchically based on syntax and configurable length/frequency thresholds, never class name or tag whitelists.
>     - Benchmarking harnesses measure real-world performance against third-party design systems objectively without the core compiler containing any special-cased logic for those libraries.

---

## 🏛️ Architecture and Vision

`@lit-core` is an ahead-of-time (AOT) compiler and bundler optimization toolchain for Lit and Web Component applications.

### Core problem
Web Components encapsulate styles inside Shadow DOM. Traditional CSS atomization (utility classes like Tailwind) fails inside Shadow DOM because encapsulation prevents utility classes from piercing shadow boundaries without template modification. This forces component libraries to either duplicate large blocks of theme/reset styles across every component or incur runtime stylesheet injection costs.

### Solution and mechanism
1. **Compile-time CSS AST deduplication (`css-fuse`)**:
   - Parses component styles at the AST level using `oxc` and `lightningcss`.
   - Identifies identical declaration blocks and rules across components.
   - Extracts shared rules into hash-addressed virtual modules (`virtual:css-fuse/*`) exporting Lit `css` tagged template strings.
   - In the browser, shared sheets instantiate a single `CSSStyleSheet` object shared across components in memory.
2. **AOT Lit decorator lowering (`props-lower`)**:
   - Native Rust transform lowering `@property()` and `@state()` decorators into standard static `properties` definitions ahead of time, eliminating runtime decorator polyfills and reflection.
3. **Native template and style minification (`css-minifier`, `html-minifier`)**:
   - High-speed Rust-based minification for Lit `css` and `html` template literals.
4. **Ahead-of-time Lit template compilation (`html-aot`)**:
   - Compiles Lit `html` tagged templates ahead of time into static `CompiledTemplateResult` descriptors with pre-computed part indices, eliminating runtime HTML parsing and template preparation.
5. **Unified bundler plugin (`vite-plugin`)**:
   - Integrates deduplication, lowering, and minification into Vite and Rollup pipelines with fine-grained HMR and chunk scoping.
6. **Empirical benchmarking harness (`benchmarks`)**:
   - Validates real-world bundle size reductions and runtime render latency across major production Lit design systems (Carbon, Spectrum, Web Awesome, Material Web, Cisco Momentum).

---

## 📦 Package overview

| Package | Path | Tech stack | Purpose |
| :--- | :--- | :--- | :--- |
| `@lit-core/css-fuse` | `packages/css-fuse` | Rust (`oxc`, `lightningcss`), NAPI-RS | Cross-component CSS deduplication into shared constructable sheets |
| `@lit-core/html-fuse` | `packages/html-fuse` | Rust (`oxc`), NAPI-RS | Cross-component static HTML and SVG fragment clustering |
| `@lit-core/props-lower` | `packages/props-lower` | Rust (`oxc`), NAPI-RS | AOT Lit decorator and property lowering |
| `@lit-core/event-hoist` | `packages/event-hoist` | Rust (`oxc`), NAPI-RS | Ahead-of-time ShadowRoot event delegation |
| `@lit-core/dom-paths` | `packages/dom-paths` | Rust (`oxc`), NAPI-RS | Ahead-of-time structural DOM path compiler eliminating TreeWalker mounting traversal |
| `@lit-core/dirty-mask` | `packages/dirty-mask` | Rust (`oxc`), NAPI-RS | Ahead-of-time property-to-part dependency bitmasking |
| `@lit-core/memoize` | `packages/memoize` | Rust (`oxc`), NAPI-RS | Ahead-of-time reactive expression auto-memoization |
| `@lit-core/elem-proxy` | `packages/elem-proxy` | Rust (`oxc`), NAPI-RS | AOT Custom Element proxy stubs for deferred registration |
| `@lit-core/css-minifier` | `packages/css-minifier` | Rust (`lightningcss`), NAPI-RS | High-speed CSS template literal minifier |
| `@lit-core/html-minifier` | `packages/html-minifier` | Rust (`oxc`), NAPI-RS | High-speed HTML template literal minifier |
| `@lit-core/html-aot` | `packages/html-aot` | TypeScript, `parse5`, `lit-html` | Ahead-of-time Lit template compilation eliminating runtime prepare phase |
| `@lit-core/resumable` | `packages/resumable` | TypeScript, Lit | Zero-JavaScript SSR and interaction-driven runtime resumption |
| `@lit-core/native` | `packages/native` | Rust (`oxc`), NAPI-RS | AOT vanilla Web Component and micro-runtime compiler |
| `@lit-core/vite-plugin` | `packages/vite-plugin` | TypeScript, Vite / Rollup | Bundler plugin unifying all `@lit-core` optimizations |
| `@lit-core/webpack-plugin` | `packages/webpack-plugin` | TypeScript, Webpack | Bundler plugin unifying all `@lit-core` optimizations for Webpack |
| `@lit-core/benchmarks` | `packages/benchmarks` | Node.js, Vite | Multi-library bundle size and deduplication benchmark harness |
| `@lit-core/showcase` | `packages/showcase` | TypeScript, Vite | Multi-framework component visualization showcase with isolated compiler passes |
| `@lit-core/tests` | `packages/tests` | TypeScript, Vitest, Playwright | Real component multi-framework Playwright test suite |

---

## 🛠️ Development and build workflows

- **Package manager**: `pnpm` (version >= 10, monorepo managed via `pnpm-workspace.yaml`).
- **Monorepo build orchestration**: `turbo run build`.
- **Rust NAPI modules**:
  - Rust packages contain native `.node` bindings.
  - Whenever you modify Rust code in packages with native crates (such as `css-fuse`, `props-lower`, `native`, `elem-proxy`, `dirty-mask`, `dom-paths`, `event-hoist`, `memoize`, `css-minifier`, or `html-minifier`), run `cargo build --release` (or the package's build script) to update the `.node` binary before executing JS tests or benchmarks.
- **Code formatting and linting**:
  - JavaScript / TypeScript: `pnpm run format` (powered by Biome).
  - Rust: `cargo fmt` and `cargo clippy`.
- **Testing**:
  - Run package-specific tests or `pnpm test` (powered by Vitest).
  - Use Vitest and Playwright to test DOM rendering, AOT compiler transforms, and browser runtime performance instead of low-level Rust unit tests.

---

## 🔒 Invariants and safety constraints

1. **Cascade and specificity preservation**:
   - Shared constructable stylesheets must always be prepended before component local overrides in `static styles = [sharedSheet, localOverrides]`.
   - Never modify selector specificity or mangle selector order.
2. **Module graph alignment**:
   - Shared stylesheets must respect Rollup chunk boundaries to prevent lazy-loaded component styles from leaking into entry chunks.
3. **Net savings threshold**:
   - Clustering in `css-fuse` must enforce a net-savings threshold so virtual module import overhead never exceeds CSS bytes saved.
4. **General-purpose neutrality**:
   - All compiler logic, AST visitors, and extraction passes must remain strictly general-purpose with zero library-specific hardcoding, class checks, or aliases.
5. **Runtime verification with Playwright and Vitest**:
   - Always verify template compilation, DOM hydration, and real render performance using Vitest and Playwright.
6. **Documentation brevity**:
   - Keep markdown concise, high-signal, and easy to read.
   - Avoid repetitive tables and redundant prose.
   - Follow the sentence case instruction strictly.
7. **AST codegen invariant (strictly no string splicing)**:
   - Never use string manipulation (`replace_range`, `insert_str`, manual brace counting, regex search/replace, `.find('{')`, raw slice span math) to synthesize or rewrite JavaScript, TypeScript, or CSS AST structures.
   - Always parse code with `oxc_parser`, perform structural transforms on the AST using `oxc_allocator` / `AstBuilder` / `oxc_traverse`, and emit valid output using `oxc_codegen`.
   - String splicing breaks on multiline imports, inline comments, string literals with brackets or braces, and multi-component files. AST transformation is deterministic and preserves syntax validity.
8. **Zero consumer runtime overhead and automated bundler injection**:
   - Downstream consumers must never be required to manually import, wire up, or configure runtime microloaders, client adapters, or orchestration scripts.
   - All runtime execution hooks (such as resumable event delegation, custom element chunk loaders, or hydration adapters) must be synthesized ahead of time via `oxc` AST compilation and automatically injected by bundler plugins (`@lit-core/webpack-plugin`, `@lit-core/vite-plugin`).
   - Consumers write standard Lit components and only add the bundler plugin. Zero additional runtime dependencies, zero manual imports, and zero configuration boilerplate.
   - Strictly prohibit opinionated path conventions (such as naive `/components/*` fallback assumptions). Manifests and chunk URLs must be resolved dynamically by the bundler plugin across any codebase.



