/**
 * Available optimization features for the component showcase.
 * @type {Array<{ id: string, name: string, description: string }>}
 */
export const FEATURES = [
  { id: 'baseline', name: 'Baseline (standard Vite)', description: 'Unmodified Lit templates and stylesheets with standard Vite bundler' },
  { id: 'css-fuse', name: 'css-fuse', description: 'Cross-component CSS AST deduplication into shared constructable sheets' },
  { id: 'props-lower', name: 'props-lower', description: 'Ahead-of-time Lit property and state decorator lowering via OXC' },
  { id: 'html-aot', name: 'html-aot', description: 'Ahead-of-time Lit template compilation eliminating runtime prepare phase' },
  { id: 'event-hoist', name: 'event-hoist', description: 'Ahead-of-time ShadowRoot event delegation compiler pass' },
  { id: 'dom-paths', name: 'dom-paths', description: 'Ahead-of-time structural DOM path compiler eliminating TreeWalker traversal' },
  { id: 'dirty-mask', name: 'dirty-mask', description: 'Ahead-of-time reactive property-to-part dependency bitmasking' },
  { id: 'memoize', name: 'memoize', description: 'Ahead-of-time reactive expression auto-memoization compiler pass' },
  { id: 'elem-proxy', name: 'elem-proxy', description: 'Deferred Custom Element proxy stubs for lazy class evaluation' },
  { id: 'resumable', name: 'resumable', description: 'Zero-JavaScript SSR and interaction-driven runtime resumption' },
  { id: 'native', name: 'native', description: 'Ahead-of-time vanilla Web Component and micro-runtime compilation' },
  { id: 'css-minifier', name: 'css-minifier', description: 'Native Lightning CSS minifier for embedded Lit css template literals' },
  { id: 'html-minifier', name: 'html-minifier', description: 'Native OXC AST minifier for embedded Lit html template literals' },
  { id: 'html-fuse', name: 'html-fuse', description: 'Cross-component static HTML and SVG fragment clustering' },
  { id: 'all', name: 'All optimizations combined', description: 'Full lit-core ahead-of-time compiler suite enabled together' },
];
