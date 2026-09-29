import assert from 'node:assert';
import { minifyEmbeddedCss, minifyTemplateCss } from '../src/index.js';

console.log('Testing @lit-core/css-minifier native addon...');

// Test 1: Simple Lit CSS template minification
{
  const input = `
    import { LitElement, css } from 'lit';

    export class MyButton extends LitElement {
      static styles = css\`
        :host {
          display: block;
          color: rgb(255, 0, 0);
          margin: 0px 0px 0px 0px;
        }
      \`;
    }
  `;
  const res = minifyEmbeddedCss(input);
  assert(res.minifiedTemplates > 0, 'Should count minified templates');
  assert(res.bytesSaved > 0, 'Should track bytes saved');
  assert(res.code.includes(':host{'), 'Should strip whitespace');
  assert(res.code.includes('color:red') || res.code.includes('color:#f00'), 'Should minify color format');
  assert(res.code.includes('margin:0'), 'Should minify redundant 0px units');
  console.log('  ✔ Simple Lit CSS template minification');
}

// Test 2: Uncompressed calc() and duplicate property merging
{
  const input = `
    import { css } from 'lit';
    const styles = css\`
      .box {
        width: calc(100px + 50px);
        padding: 10px;
        padding: 20px;
      }
    \`;
  `;
  const res = minifyEmbeddedCss(input);
  assert(res.minifiedTemplates > 0);
  assert(res.code.includes('150px'), 'Should simplify calc()');
  assert(!res.code.includes('10px'), 'Should eliminate overridden duplicate properties');
  console.log('  ✔ calc() evaluation and duplicate property merging');
}

// Test 3: Aliased import
{
  const input = `
    import { css as customCss } from 'lit';
    const styles = customCss\`
      :host {
        background-color: rgba(255, 255, 255, 1);
      }
    \`;
  `;
  const res = minifyEmbeddedCss(input);
  assert(res.minifiedTemplates > 0);
  assert(res.code.includes('#fff') || res.code.includes('white'), 'Should minify color');
  console.log('  ✔ Aliased css import support');
}

// Test 4: Member expression LitElement.css / lit.css
{
  const input = `
    import * as lit from 'lit';
    const styles = lit.css\`
      :host {
        display: flex;
        flex-direction: row;
      }
    \`;
  `;
  const res = minifyEmbeddedCss(input);
  assert(res.minifiedTemplates > 0);
  assert(res.code.includes('display:flex') && res.code.includes('flex-direction:row'));
  console.log('  ✔ Static member expression tag support (lit.css)');
}

// Test 5: Interpolation preservation
{
  const input = `
    import { css } from 'lit';
    const styles = css\`
      :host {
        display: block;
      }
      \${sharedStyles}
      .child {
        color: rgb(0, 0, 0);
      }
    \`;
  `;
  const res = minifyEmbeddedCss(input);
  assert(res.minifiedTemplates > 0);
  assert(res.code.includes('${sharedStyles}'), 'Should preserve interpolations');
  assert(res.code.includes('.child{color:#000}'), 'Should minify valid quasi blocks');
  console.log('  ✔ Template interpolation preservation');
}

// Test 6: Non-css template literals untouched
{
  const input = `
    import { html } from 'lit';
    const template = html\`
      <div class="test">
        <span>Hello</span>
      </div>
    \`;
  `;
  const res = minifyEmbeddedCss(input);
  assert.strictEqual(res.minifiedTemplates, 0);
  assert.strictEqual(res.bytesSaved, 0);
  console.log('  ✔ Non-css templates untouched');
}

// Test 7: Sourcemap generation
{
  const input = `
    import { css } from 'lit';
    const s = css\`:host { color: rgb(255, 0, 0); }\`;
  `;
  const res = minifyEmbeddedCss(input, {
    sourcemap: true,
    filename: 'test.ts',
  });
  assert(res.map, 'Should generate sourcemap when requested');
  const parsedMap = JSON.parse(res.map);
  assert(parsedMap.mappings, 'Sourcemap should contain mappings');
  console.log('  ✔ Sourcemap generation');
}

// Test 8: Export alias minifyTemplateCss
{
  const input = `
    import { css } from 'lit';
    const s = css\`:host { color: #ffffff; }\`;
  `;
  const res = minifyTemplateCss(input);
  assert(res.minifiedTemplates > 0);
  assert(res.code.includes('#fff'));
  console.log('  ✔ Alias minifyTemplateCss works identically');
}

// Test 9: External package import alias (@spectrum-web-components/base)
{
  const input = `
    import { css as o } from '@spectrum-web-components/base';
    const styles = o\`
      :host {
        color: rgb(0, 128, 255);
      }
    \`;
  `;
  const res = minifyEmbeddedCss(input);
  assert(res.minifiedTemplates > 0);
  assert(res.code.includes(':host{color:#0080ff}'));
  console.log('  ✔ External package import alias');
}

// Test 10: CallExpression css([...])
{
  const input = `
    import { css } from 'lit';
    var default_styles = css([
      ":host { color: rgb(255, 0, 0); margin: 0px; }",
      ".item { padding: 10px 10px; }"
    ]);
  `;
  const res = minifyEmbeddedCss(input);
  assert(res.minifiedTemplates > 0);
  assert(res.code.includes(':host{color:red;margin:0}') || res.code.includes(':host{color:#f00;margin:0}'));
  assert(res.code.includes('.item{padding:10px}'));
  console.log('  ✔ CallExpression css(["..."]) minification');
}

console.log('\nAll 10 integration tests passed successfully!\n');
