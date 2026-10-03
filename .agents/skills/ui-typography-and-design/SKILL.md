---
name: ui-typography-and-design
description: >-
  Enforce Scandinavian minimalism, strict sentence-case typography, 16px root font size,
  minimum 1rem text sizes, lighter font weights, balanced spacing, and flat borderless design
  across all frontend apps, dashboards, viewers, and showcase applications in this monorepo.
---

# UI typography and visual design system

This skill establishes visual design and typography standards across all frontend applications, viewers, and dashboards in the `@lit-core` monorepo (including `@lit-core/benchmarks/viewer` and `@lit-core/showcase`).

---

## Mandatory typography rules

### 1. Strictly no uppercasing anywhere
- **Never use CSS `uppercase` or `tracking-wider` on headings, badges, or buttons.**
- **Never use Title Case in titles, labels, column headers, or button text.**
  - ❌ Incorrect: `DETAILED BREAKDOWN`, `Detailed Breakdown`, `GZIP SAVINGS (%)`
  - ✅ Correct: `Detailed breakdown`, `Gzip savings (%)`
- Always use **sentence case** for:
  - Page titles and section headings
  - Navigation tabs and buttons
  - Filter labels and pill options
  - Table column headers and cell labels
  - Badges, status tags, and metadata descriptors
- Preserve proper nouns and code identifiers as-is (`Lit`, `Vite`, `Carbon Web Components`, `CSSStyleSheet`).

### 2. 16px root size and minimum 1rem font size
- **Root font size**: Always define `html { font-size: 16px; }`.
- **Minimum 1rem font size**: **Never go below 1rem (16px) anywhere in the UI.**
  - ❌ **Strictly forbidden**: `text-xs` (12px), `text-sm` (14px).
  - ✅ **Required**: Use `text-base` (1rem, 16px) as the absolute floor for all UI text, including badges, helper captions, secondary labels, table headers, table cells, and button copy.

### 3. Font weights on the thinner side
- Prioritize light and normal weights to maintain an airy, understated aesthetic:
  - `font-light` (300): Secondary labels, helper text, neutral table values, unselected pills, and supporting descriptions.
  - `font-normal` (400): Standard body copy, primary table values, and table column headers.
  - `font-medium` (500): Reserved strictly for section titles and active button/pill states.
  - ❌ **Strictly forbidden**: Heavy font weights like `font-semibold` (600) and `font-bold` (700).

### 4. Reuse standard typography variants
Do not invent arbitrary font size or tracking combinations. Strictly reuse these standardized variants:
- **Page / view title**: `text-2xl font-light text-zinc-950 tracking-tight`
- **Section heading**: `text-lg font-medium text-zinc-950 tracking-tight`
- **Body and primary cell**: `text-base font-normal text-zinc-900` or `text-base font-light text-zinc-700`
- **Filter label and column header**: `text-base font-light text-zinc-500` (never washed-out `text-zinc-400` which fails contrast)
- **Supporting metadata label**: `text-base font-light text-zinc-500`
- **Tabular numeric value**: `tabular-nums text-base font-light text-zinc-700`

---

## Layout and architectural balance

### 1. Wide container alignment
- Both the application header and the main content below must share the exact same container constraints so alignments are perfectly flush:
  - `w-full max-w-[1600px] mx-auto px-6 sm:px-10 lg:px-14`

### 2. Headings live outside and above cards
- **Never enclose section headings awkwardly inside cards or nested boxes.**
- Headings must sit cleanly on the canvas outside and above the surface cards:
  ```tsx
  <div className="flex flex-col gap-3">
    <h2 className="text-lg font-medium text-zinc-950 tracking-tight px-1">
      Cross-library optimization matrix
    </h2>
    <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden border-none">
      {/* Table or surface content */}
    </div>
  </div>
  ```

### 3. Unboxed filter and selection rows
- Do not enclose filter bars in bulky white cards.
- Place filter controls directly onto the canvas (`#fafafb`) with fixed-width muted labels on the left:
  ```tsx
  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
    <span className="w-28 text-base font-light text-zinc-500 shrink-0">Category</span>
    <div className="flex flex-wrap items-center gap-2">
      {/* Pills */}
    </div>
  </div>
  ```

---

## Visual aesthetic: Scandinavian minimalism

1. **Combined soft modern shadows and super subtle border definition**:
   - Elevate cards, surfaces, panels, tables, popovers, and drawer containers with soft, diffuse modern shadows paired with a super subtle border ring:
     - `shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5` (transitioning to `hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)]` on interactive surfaces).
   - This creates an airy, hyper-modern elevated feel with clean edge definition against the pure white canvas without visual clutter.
   - Strictly forbid heavy 1px gray borders (`border border-zinc-200`, `border-b`, `border-t`).
2. **Flat interactive controls without shadows**:
   - Keep dropdown buttons, pills, and filter triggers flat (`shadow-none`). Avoid shadows on interactive dropdown buttons.
   - Dropdown trigger buttons: rich emerald green with crisp white text (`bg-emerald-700 hover:bg-emerald-800 text-white shadow-none`).
3. **Thick green border for active or selected card states**:
   - When an active, focused, or selected state requires a visual outline (such as selected overview cards), use a thick green ring:
     - `ring-[3px] ring-emerald-600`
   - Keep the card background identical to inactive cards (`bg-white hover:bg-zinc-50/60`). Never shift the active card background to gray.
4. **Balanced grayscales and crisp contrast**:
   - Canvas: `#fafafb` (`bg-[#fafafb]`).
   - Surfaces: `#ffffff` (`bg-white`).
   - Primary text: `text-zinc-950` or `text-zinc-900`.
   - Secondary text: `text-zinc-700` or `text-zinc-600`.
   - Labels and headers: `text-zinc-500` (ensures compliant WCAG AA ~4.6:1 contrast against `#fafafb` without washing out).
   - Inactive pills: `bg-white text-zinc-600 hover:text-zinc-950 font-light shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] border-none`.
   - Active pills: `bg-zinc-900 text-white font-medium shadow-[0_2px_8px_rgba(0,0,0,0.12)] border-none`.
5. **Rounded geometry**:
   - Use `rounded-xl` for pills, inputs, and buttons.
   - Use `rounded-2xl` for content cards and surface containers.
6. **Zero AI slop and unnecessary bloat**:
   - Remove redundant action buttons (e.g. "Reload data", "Clear cache").
   - Eliminate raw JSON dumps or debug tabs from consumer-facing views.
   - Keep interfaces focused, purposeful, and quiet.
7. **Component style isolation via iframes**:
   - When previewing foreign or third-party Web Components (such as Carbon, Spectrum, Material), always render the component canvas inside an isolated `<iframe>`.
   - Never import third-party global reset stylesheets (e.g. `@carbon/styles`) into the host dashboard application.
