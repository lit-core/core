import assert from 'node:assert';
import { transformResumableComponent } from '../../packages/rendering/resumable/lib/compiler/index.js';
import { transformSsrComponent } from '../../packages/rendering/ssr/dist/compiler.js';
import { analyzeLitModule, compileModule } from '../../packages/targets/morph-to-react/src/index.js';

console.log('================================================================');
console.log('EMPIRICAL CHALLENGER TEST SUITE: ssr, resumable, morph-to-react');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function runTest(suite, name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`[PASS] [${suite}] ${name}`);
  } catch (err) {
    failedTests++;
    failures.push({ suite, name, error: err });
    console.error(`[FAIL] [${suite}] ${name}`);
    console.error(`       Error: ${err.message}`);
  }
}

// =============================================================================
// SUITE 1: ssr empirical challenge
// =============================================================================

// 1.1: Local class named LitElement without Lit import is NOT treated as Lit base class
runTest('ssr', '1.1.1: local class named LitElement without Lit import is not treated as Lit base class', () => {
  const code = `
    class LitElement {
      firstUpdated() {
        console.log('base firstUpdated');
      }
    }
    class MyComp extends LitElement {
      firstUpdated() {
        console.log('comp firstUpdated');
      }
    }
  `;
  const res = transformSsrComponent(code, { ssrMode: true });
  // Since there are no Lit imports and no custom element registrations,
  // MyComp must NOT be treated as a custom element and its firstUpdated must NOT be stripped.
  assert(res.code.includes("console.log('comp firstUpdated')"), 'firstUpdated body must remain intact');
  assert.strictEqual(res.discoveredTags.length, 0, 'discoveredTags must be empty');
  assert.strictEqual(res.modified, false, 'modified must be false');
});

runTest('ssr', '1.1.2: ambient/unimported LitElement heritage without Lit import is not treated as Lit base class', () => {
  const code = `
    class AmbientComp extends LitElement {
      firstUpdated() {
        console.log('ambient firstUpdated');
      }
    }
  `;
  const res = transformSsrComponent(code, { ssrMode: true });
  assert(res.code.includes("console.log('ambient firstUpdated')"), 'firstUpdated body must remain intact');
  assert.strictEqual(res.discoveredTags.length, 0, 'discoveredTags must be empty');
  assert.strictEqual(res.modified, false, 'modified must be false');
});

runTest('ssr', '1.1.3: positive control - actual LitElement import DOES strip firstUpdated in ssrMode', () => {
  const code = `
    import { LitElement } from 'lit';
    class RealComp extends LitElement {
      firstUpdated() {
        console.log('should be stripped');
      }
    }
  `;
  const res = transformSsrComponent(code, { ssrMode: true });
  assert(!res.code.includes("console.log('should be stripped')"), 'firstUpdated body must be stripped');
  assert.strictEqual(res.modified, true, 'modified must be true');
});

// 1.2: Aliased LitElement imports
runTest('ssr', '1.2.1: aliased LitElement import extends MyBase is recognized and stripped in ssrMode', () => {
  const code = `
    import { LitElement as MyBase } from 'lit';
    class AliasedComp extends MyBase {
      firstUpdated() {
        console.log('aliased firstUpdated should be stripped');
      }
    }
  `;
  const res = transformSsrComponent(code, { ssrMode: true });
  assert(!res.code.includes("console.log('aliased firstUpdated should be stripped')"), 'firstUpdated must be stripped');
  assert.strictEqual(res.modified, true, 'modified must be true');
});

runTest('ssr', '1.2.2: aliased LitElement import subclass propagation', () => {
  const code = `
    import { LitElement as CoreElement } from 'lit';
    class AbstractBase extends CoreElement {}
    class ConcreteComp extends AbstractBase {
      firstUpdated() {
        console.log('subclass firstUpdated should be stripped');
      }
    }
  `;
  const res = transformSsrComponent(code, { ssrMode: true });
  assert(!res.code.includes("console.log('subclass firstUpdated should be stripped')"), 'firstUpdated in subclass must be stripped');
  assert.strictEqual(res.modified, true, 'modified must be true');
});

runTest('ssr', '1.2.3: namespace Lit import lit.LitElement is recognized in ssrMode', () => {
  const code = `
    import * as lit from 'lit';
    class NsComp extends lit.LitElement {
      firstUpdated() {
        console.log('namespace firstUpdated should be stripped');
      }
    }
  `;
  const res = transformSsrComponent(code, { ssrMode: true });
  assert(!res.code.includes("console.log('namespace firstUpdated should be stripped')"), 'firstUpdated must be stripped');
  assert.strictEqual(res.modified, true, 'modified must be true');
});

// 1.3: Shadowed customElements.define
runTest('ssr', '1.3.1: locally declared customElements object does not trigger tag discovery or stripping', () => {
  const code = `
    const customElements = {
      define(tag, ctor) {
        console.log('mock define');
      }
    };
    class FakeWidget {
      firstUpdated() {
        console.log('fake widget firstUpdated');
      }
    }
    customElements.define('fake-widget', FakeWidget);
  `;
  const res = transformSsrComponent(code, { ssrMode: true });
  assert.strictEqual(res.discoveredTags.includes('fake-widget'), false, 'fake-widget must NOT be in discoveredTags');
  assert(res.code.includes("console.log('fake widget firstUpdated')"), 'firstUpdated must remain intact');
  assert.strictEqual(res.modified, false, 'modified must be false');
});

runTest('ssr', '1.3.2: shadowed customElements via function parameter does not discover tags', () => {
  const code = `
    function register(customElements) {
      class ParamWidget {
        firstUpdated() {}
      }
      customElements.define('param-widget', ParamWidget);
    }
  `;
  const res = transformSsrComponent(code, { ssrMode: true });
  assert.strictEqual(res.discoveredTags.includes('param-widget'), false, 'param-widget must NOT be in discoveredTags');
  assert.strictEqual(res.modified, false, 'modified must be false');
});

runTest('ssr', '1.3.3: shadowed window.customElements does not discover tags', () => {
  const code = `
    const window = { customElements: { define() {} } };
    window.customElements.define('win-shadowed', class ShadowedClass {});
  `;
  const res = transformSsrComponent(code, { ssrMode: true });
  assert.strictEqual(res.discoveredTags.includes('win-shadowed'), false, 'win-shadowed must NOT be in discoveredTags');
});

runTest('ssr', '1.3.4: positive control - unshadowed global customElements.define registers tag and modifies in ssrMode', () => {
  const code = `
    class RealWidget {
      firstUpdated() {
        console.log('real widget firstUpdated');
      }
    }
    customElements.define('real-widget', RealWidget);
  `;
  const res = transformSsrComponent(code, { ssrMode: true });
  assert(res.discoveredTags.includes('real-widget'), 'real-widget MUST be in discoveredTags');
  assert(!res.code.includes("console.log('real widget firstUpdated')"), 'firstUpdated must be stripped in RealWidget');
  assert.strictEqual(res.modified, true, 'modified must be true');
});

// =============================================================================
// SUITE 2: resumable empirical challenge
// =============================================================================

// 2.1: Non-Lit classes without customElement registrations do not trigger adapter injection
runTest('resumable', '2.1.1: plain utility class does not trigger adapter injection', () => {
  const code = `
    export class Calculator {
      add(a, b) {
        return a + b;
      }
    }
  `;
  const res = transformResumableComponent(code);
  assert.strictEqual(res.transformed, false, 'transformed must be false');
  assert(!res.code.includes('installResumableAdapter'), 'must not inject adapter');
  assert(!res.code.includes('virtual:lit-core/resumable-adapter'), 'must not import adapter module');
});

runTest('resumable', '2.1.2: class with connectedCallback and render but no Lit or CE heritage does not trigger adapter', () => {
  const code = `
    export class ViewPresenter {
      connectedCallback() {
        console.log('presenter connected');
      }
      render() {
        return '<div>view</div>';
      }
    }
  `;
  const res = transformResumableComponent(code);
  assert.strictEqual(res.transformed, false, 'transformed must be false');
  assert(!res.code.includes('installResumableAdapter'), 'must not inject adapter');
});

runTest('resumable', '2.1.3: local class named LitElement without Lit import does not trigger adapter', () => {
  const code = `
    class LitElement {}
    export class FakeComponent extends LitElement {
      render() {}
    }
  `;
  const res = transformResumableComponent(code);
  assert.strictEqual(res.transformed, false, 'transformed must be false');
  assert(!res.code.includes('installResumableAdapter'), 'must not inject adapter');
});

runTest('resumable', '2.1.4: shadowed customElements.define does not trigger adapter', () => {
  const code = `
    const customElements = { define() {} };
    class MockElement {}
    customElements.define('mock-el', MockElement);
    export { MockElement };
  `;
  const res = transformResumableComponent(code);
  assert.strictEqual(res.transformed, false, 'transformed must be false');
  assert(!res.code.includes('installResumableAdapter'), 'must not inject adapter');
});

runTest('resumable', '2.1.5: positive control - actual Lit component triggers adapter', () => {
  const code = `
    import { LitElement } from 'lit';
    export class RealComponent extends LitElement {}
  `;
  const res = transformResumableComponent(code);
  assert.strictEqual(res.transformed, true, 'transformed must be true');
  assert(res.code.includes('installResumableAdapter'), 'must inject adapter');
  assert(res.code.includes('virtual:lit-core/resumable-adapter'), 'must import adapter module');
});

runTest('resumable', '2.1.6: positive control - unshadowed customElements.define triggers adapter', () => {
  const code = `
    class NativeCE extends HTMLElement {}
    customElements.define('native-ce', NativeCE);
    export { NativeCE };
  `;
  const res = transformResumableComponent(code);
  assert.strictEqual(res.transformed, true, 'transformed must be true');
  assert(res.code.includes('installResumableAdapter'), 'must inject adapter');
});

// =============================================================================
// SUITE 3: morph-to-react empirical challenge
// =============================================================================

// 3.1: Non-Lit tagged templates are not parsed/lowered as Lit templates
runTest('morph-to-react', '3.1.1: standalone non-Lit html tagged template is untouched', () => {
  const code = `
    const html = (strings, ...values) => strings.join('');
    export const myTemplate = html\`<div class="test">Hello World</div>\`;
  `;
  const res = compileModule(code, { filePath: 'test.ts' });
  assert.strictEqual(res.tier, 'None', 'tier must be None');
  assert.strictEqual(res.componentName, '', 'componentName must be empty');
  assert.strictEqual(res.code.trim(), code.trim(), 'code must remain untouched');
  assert(!res.code.includes('export function'), 'must not generate React function');

  const analysis = analyzeLitModule(code, { filename: 'test.ts' });
  assert.strictEqual(analysis.components.length, 0, 'must find 0 Lit components');
});

runTest('morph-to-react', '3.1.2: non-Lit class with html tagged template render method is untouched', () => {
  const code = `
    const html = (s) => s;
    export class NonLitPresenter {
      render() {
        return html\`<div class="non-lit">Content</div>\`;
      }
    }
  `;
  const res = compileModule(code, { filePath: 'presenter.ts' });
  assert.strictEqual(res.tier, 'None', 'tier must be None');
  assert.strictEqual(res.componentName, '', 'componentName must be empty');
  assert(!res.code.includes('export function NonLitPresenter'), 'must not generate React component');

  const analysis = analyzeLitModule(code, { filename: 'presenter.ts' });
  assert.strictEqual(analysis.components.length, 0, 'must find 0 Lit components');
});

runTest('morph-to-react', '3.1.3: Lit class with shadowed non-Lit html function does not lower template', () => {
  const code = `
    import { LitElement } from 'lit';
    const html = (s) => s;
    export class ShadowedTemplateComp extends LitElement {
      render() {
        return html\`<div class="shadowed">Shadowed Tag</div>\`;
      }
    }
  `;
  const analysis = analyzeLitModule(code, { filename: 'shadowed.ts' });
  assert.strictEqual(analysis.components.length, 1, 'finds Lit component via heritage');
  // Since html is shadowed, template IR extraction must NOT recognize html as Lit template!
  assert(!analysis.components[0].template, 'template IR must be empty/undefined');
  // compileModule must refuse to lower non-Lit template
  assert.throws(() => {
    compileModule(code, { filePath: 'shadowed.ts' });
  }, /Component has no template IR in render()/);
});

// 3.2: Aliased html as h tagged templates
runTest('morph-to-react', '3.2.1: aliased import { html as h } is recognized and lowered to React JSX', () => {
  const code = `
    import { LitElement, html as h } from 'lit';
    export class AliasedComp extends LitElement {
      render() {
        return h\`<button class="primary-btn" type="button"><span>Click me</span></button>\`;
      }
    }
  `;
  const analysis = analyzeLitModule(code, { filename: 'aliased.ts' });
  assert.strictEqual(analysis.components.length, 1, 'must find 1 Lit component');
  assert.notStrictEqual(analysis.components[0].template, null, 'template IR must be extracted');

  const res = compileModule(code, { filePath: 'aliased.ts' });
  assert.strictEqual(res.tier, 'Tier0Pure', 'must classify as Tier0Pure');
  assert.strictEqual(res.componentName, 'AliasedComp', 'componentName must be AliasedComp');
  assert(res.code.includes('export function AliasedComp('), 'must emit functional React component');
  assert(res.code.includes('className="primary-btn"'), 'must convert class to className');
  assert(res.code.includes('<span>Click me</span>'), 'must emit JSX span');
});

runTest('morph-to-react', '3.2.2: aliased base class and aliased html tag simultaneously', () => {
  const code = `
    import { LitElement as BaseElement, html as litHtml } from 'lit';
    export class DoubleAliasedCard extends BaseElement {
      render() {
        return litHtml\`<div class="card"><h2 class="card-title">Card Header</h2></div>\`;
      }
    }
  `;
  const res = compileModule(code, { filePath: 'card.ts' });
  assert.strictEqual(res.tier, 'Tier0Pure', 'must classify as Tier0Pure');
  assert.strictEqual(res.componentName, 'DoubleAliasedCard', 'componentName must be DoubleAliasedCard');
  assert(res.code.includes('export function DoubleAliasedCard('), 'must emit functional React component');
  assert(res.code.includes('className="card"'), 'must convert class to className');
  assert(res.code.includes('className="card-title"'), 'must convert card-title');
});

runTest('morph-to-react', '3.2.3: namespace import lit.html and lit.LitElement lowered to React JSX', () => {
  const code = `
    import * as lit from 'lit';
    export class NamespaceComp extends lit.LitElement {
      render() {
        return lit.html\`<section class="ns-sec"><p>Namespace Tag</p></section>\`;
      }
    }
  `;
  const res = compileModule(code, { filePath: 'namespace.ts' });
  assert.strictEqual(res.tier, 'Tier0Pure', 'must classify as Tier0Pure');
  assert.strictEqual(res.componentName, 'NamespaceComp', 'componentName must be NamespaceComp');
  assert(res.code.includes('export function NamespaceComp('), 'must emit functional React component');
  assert(res.code.includes('className="ns-sec"'), 'must convert class to className');
});

// =============================================================================
// SUMMARY
// =============================================================================
console.log('\n================================================================');
console.log(`TEST SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
console.log('================================================================');

if (failedTests > 0) {
  console.error('\nFAILED TESTS DETAILS:');
  for (const f of failures) {
    console.error(`- [${f.suite}] ${f.name}`);
    console.error(`  ${f.error.stack || f.error.message}`);
  }
  process.exit(1);
} else {
  console.log('\nALL EMPIRICAL CHALLENGES PASSED SUCCESSFULLY!\n');
  process.exit(0);
}
