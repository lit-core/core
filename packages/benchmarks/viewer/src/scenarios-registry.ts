import { ALL_CANONICAL_COMPONENTS, type ComponentItem } from './canonical-registry.js';
import type { ManifestData, ScenarioMetadata } from './types.js';

export const DEFAULT_SCENARIOS: ScenarioMetadata[] = [
  {
    id: 'data-grid',
    name: 'Data grid',
    description: 'High-density data grid rendering 100 rows with real component cells testing TreeWalker bypass, dependency bitmasking, and micro-runtime compilation',
    relevantFeatures: ['dom-paths', 'dirty-mask', 'native'],
    componentConcepts: ['checkbox', 'badge', 'button', 'icon-button'],
  },
  {
    id: 'interactive-form',
    name: 'Interactive form',
    description: 'Dense multi-section interactive settings form with real controls testing event listener hoisting and deferred proxy registration',
    relevantFeatures: ['event-hoist', 'elem-proxy'],
    componentConcepts: ['text-input', 'checkbox', 'switch', 'radio', 'select', 'button'],
  },
  {
    id: 'ssr-dashboard',
    name: 'SSR dashboard',
    description: 'Server-rendered dashboard with Declarative Shadow DOM components testing zero-JS resumption and AOT template compilation',
    relevantFeatures: ['resumable', 'html-aot'],
    componentConcepts: ['card', 'badge', 'progress-bar', 'button', 'tabs'],
  },
  {
    id: 'dynamic-feed',
    name: 'Dynamic feed',
    description: 'Dynamic reactive feed with repeated collection items testing directive lowering, expression memoization, and static HTML clustering',
    relevantFeatures: ['directives', 'memoize', 'html-fuse'],
    componentConcepts: ['card', 'badge', 'icon', 'button', 'chips', 'divider'],
  },
  {
    id: 'selective-app',
    name: 'Selective application',
    description: 'Enterprise application importing design system components with selective usage testing Custom Element tag shaking and dead code elimination',
    relevantFeatures: ['tag-shake'],
    componentConcepts: ['button', 'badge', 'card'],
  },
  {
    id: 'bundle',
    name: 'Multi-component bundle',
    description: 'Enterprise application importing 20 canonical components across routes testing cross-component CSS AST deduplication and decorator lowering',
    relevantFeatures: ['css-fuse', 'props-lower', 'css-minifier', 'html-minifier', 'all', 'baseline'],
    componentConcepts: [
      'button',
      'checkbox',
      'radio',
      'switch',
      'text-input',
      'select',
      'dialog',
      'badge',
      'tabs',
      'progress-bar',
      'spinner',
      'slider',
      'menu',
      'divider',
      'icon',
      'icon-button',
      'card',
      'elevation',
      'list',
      'chips',
    ],
  },
];

export function getManifestScenarios(manifest?: ManifestData | null): ScenarioMetadata[] {
  if (manifest?.scenarios && manifest.scenarios.length > 0) {
    return manifest.scenarios;
  }
  return DEFAULT_SCENARIOS;
}

export function getScenarioForFeature(featureId: string, manifest?: ManifestData | null): ScenarioMetadata | undefined {
  const scenarios = getManifestScenarios(manifest);
  if (featureId === 'all' || featureId === 'baseline') {
    return scenarios.find((s) => s.id === 'bundle');
  }
  return scenarios.find((s) => s.relevantFeatures.includes(featureId));
}

export function getScenariosForComponent(conceptId: string, manifest?: ManifestData | null): ScenarioMetadata[] {
  const scenarios = getManifestScenarios(manifest);
  return scenarios.filter((s) => s.componentConcepts.includes(conceptId));
}

export function getScenarioComponents(scenarioId: string, libraryId: string = 'all', manifest?: ManifestData | null): ComponentItem[] {
  const scenarios = getManifestScenarios(manifest);
  const scenario = scenarios.find((s) => s.id === scenarioId) || scenarios[0];
  const conceptSet = new Set(scenario.componentConcepts);

  return ALL_CANONICAL_COMPONENTS.filter((comp) => {
    if (!conceptSet.has(comp.concept)) return false;
    if (libraryId !== 'all' && comp.library !== libraryId) return false;
    return true;
  });
}
