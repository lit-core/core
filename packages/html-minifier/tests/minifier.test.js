import assert from 'node:assert';
import { collapseLitTemplates, minifyHtmlTemplates, minifyLitTemplates } from '../src/index.js';

console.log('Testing @lit-core/html-minifier native addon...');

// Test 1: Basic HTML whitespace and comment collapsing
{
  const input = `
    import { html } from 'lit';
    export const tpl = html\`
      <div class="test">
        <!-- remove this comment -->
        <span>Hello World</span>
      </div>
    \`;
  `;
  const res = minifyHtmlTemplates(input);
  assert(!res.code.includes('remove this comment'), 'Should strip HTML comments');
  assert(res.code.includes('<div class="test"><span>Hello World</span></div>'), 'Should collapse whitespace between tags');
  assert(res.templatesCount === 1, 'Should record 1 template minified');
  assert(res.bytesSaved > 0, 'Should record bytes saved');
  console.log('  ✔ Basic HTML whitespace and comment collapsing');
}

// Test 2: Dynamic expressions and binding holes preserved completely untouched
{
  const input = `
    import { html } from 'lit';
    export const tpl = (title, items, onClick) => html\`
      <div class="container \${title ? 'active' : 'inactive'}">
        <h1 @click=\${onClick}>\${title}</h1>
        <ul>
          \${items.map((it) => html\`<li id=\${it.id}>\${it.name}</li>\`)}
        </ul>
      </div>
    \`;
  `;
  const res = minifyLitTemplates(input);
  assert(/\${title \? ['"]active['"] : ['"]inactive['"]}/.test(res.code), 'Should leave ternary expression untouched');
  assert(res.code.includes(`@click=\${onClick}`), 'Should leave event binding untouched');
  assert(/\${items\.map\(\(it\) => html`<li id=\${it\.id}>\${it\.name}<\/li>`\)}/.test(res.code), 'Should preserve map closure untouched');
  assert(res.templatesCount >= 1, 'Should count templates');
  console.log('  ✔ Dynamic expressions and binding holes preserved completely untouched');
}

// Test 3: Literal boundaries protection (<pre>, <code>, <textarea>)
{
  const input = `
    import { html } from 'lit';
    export const tpl = html\`
      <article>
        <pre>
          line 1
            indented line 2
        </pre>
        <code>  const x = 42;  </code>
        <textarea>
          some multiline
          raw text
        </textarea>
      </article>
    \`;
  `;
  const res = collapseLitTemplates(input);
  assert(res.code.includes('<pre>\n          line 1\n            indented line 2\n        </pre>'), 'Should preserve pre whitespace');
  assert(res.code.includes('<code>  const x = 42;  </code>'), 'Should preserve code whitespace');
  assert(res.code.includes('<textarea>\n          some multiline\n          raw text\n        </textarea>'), 'Should preserve textarea whitespace');
  console.log('  ✔ Literal boundaries protection (<pre>, <code>, <textarea>)');
}

// Test 4: SVG templates
{
  const input = `
    import { svg } from 'lit';
    export const icon = svg\`
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <!-- Icon paths -->
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    \`;
  `;
  const res = minifyHtmlTemplates(input);
  assert(!res.code.includes('Icon paths'), 'Should strip SVG comments');
  assert(res.code.includes('<circle cx="12" cy="12" r="10"/>'), 'Should collapse self-closing tag whitespace');
  assert(res.code.includes('<path d="M12 6v6l4 2"/>'), 'Should collapse path self-closing tag');
  console.log('  ✔ SVG template minification');
}

// Test 5: Lit property bindings (.prop, ?bool, @event, attr=)
{
  const input = `
    import { html } from 'lit';
    const t = html\`
      <my-element
        .data=\${data}
        ?disabled=\${isDisabled}
        @submit=\${handleSubmit}
        role="button"
      >
        <span>Submit</span>
      </my-element>
    \`;
  `;
  const res = minifyHtmlTemplates(input);
  assert(res.code.includes('.data=${data}'), 'Should preserve property binding');
  assert(res.code.includes('?disabled=${isDisabled}'), 'Should preserve boolean attribute binding');
  assert(res.code.includes('@submit=${handleSubmit}'), 'Should preserve event binding');
  assert(res.code.includes('role="button"'), 'Should preserve regular attribute');
  console.log('  ✔ Lit property bindings (.prop, ?bool, @event, attr=)');
}

// Test 6: Fast pre-check skips parsing non-template files
{
  const input = `
    export const sum = (a, b) => a + b;
    export const message = "no templates here";
  `;
  const res = minifyHtmlTemplates(input);
  assert.strictEqual(res.code, input, 'Should return source unchanged when no html/svg');
  assert.strictEqual(res.templatesCount, 0, 'Should have 0 templates');
  assert.strictEqual(res.bytesSaved, 0, 'Should have 0 bytes saved');
  console.log('  ✔ Fast pre-check skips non-template files');
}

console.log('\nAll 6 html-minifier integration tests passed successfully!\n');
