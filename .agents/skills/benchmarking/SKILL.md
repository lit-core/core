---
name: benchmarking
description: >-
  Execute, analyze, and format bundle size and deduplication benchmarks for lit-core.
  Use when running benchmarks across Carbon, Spectrum, Web Awesome, or Material Web,
  comparing optimization impacts, or formatting benchmark markdown reports.
---

# Benchmark execution and reporting guide

This skill guides you through running, analyzing, and formatting benchmarks in `@lit-core/benchmarks`.

## Available suites

- `carbon`: `@carbon/web-components` (IBM Carbon, 99 components)
- `spectrum`: `@spectrum-web-components` (Adobe Spectrum, 52 components)
- `webawesome`: `@awesome.me/webawesome` (73 components)
- `material`: `@material/web` (Google Material Design 3, 28 components)
- `momentum`: `@momentum-design/components` (Cisco Momentum Design, 97 components)
- `all`: Runs all five suites in sequence

## Execution commands

```bash
# Run all benchmark suites with terminal tables
pnpm run benchmark

# Run an individual suite
pnpm run benchmark:webawesome
pnpm run benchmark:momentum
node packages/benchmarks/src/index.js --suite=carbon
node packages/benchmarks/src/index.js --suite=spectrum
node packages/benchmarks/src/index.js --suite=material
node packages/benchmarks/src/index.js --suite=momentum

# Generate clean markdown output
pnpm run benchmark:markdown
```

## Reporting and formatting rules

1. **Avoid repetitive tables**:
   - Present a single **Results summary** table comparing Baseline vs. Optimized (Minified JS, Gzip, Brotli, and delta savings).
   - Present a separate **Deduplication diagnostics** table for AST metrics (rules scanned, duplicate rules fused, shared sheets created, chunks rewritten).
   - Do NOT duplicate rows across multiple nested accordions.
2. **Casing and style**:
   - Always use sentence case for all table headers, section titles, and descriptions. Do not uppercase every word.
   - Omit internal bug fix postmortems or debugging notes from consumer-facing benchmark documentation.
