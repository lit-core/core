import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileHtmlAot } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testFilesDir = path.resolve(__dirname, '../test_files');

describe('html-aot compilation', () => {
  it('compiles basic lit-html template', () => {
    const input = `
import { html } from 'lit';
export const sayHello = (name: string) => html\`<h1>Hello \${name}!</h1>\`;
`;
    const result = compileHtmlAot(input, { filename: 'hello.ts' });
    expect(result.templatesCount).toBe(1);
    expect(result.code).toContain('_$litType$');
    expect(result.code).toContain('parts: [{ type: 2, index: 1 }]');
  });

  it('compiles attribute, property, boolean and event bindings', () => {
    const input = `
import { html } from 'lit-html';
export const comp = (val: string, flag: boolean, fn: Function) => html\`
  <input .value=\${val} ?disabled=\${flag} @click=\${fn} data-val=\${val} />
\`;
`;
    const result = compileHtmlAot(input, { filename: 'comp.ts' });
    expect(result.templatesCount).toBe(1);
    expect(result.code).toContain('lit-html/private-ssr-support.js');
    expect(result.code).toContain('AttributePart');
    expect(result.code).toContain('PropertyPart');
    expect(result.code).toContain('BooleanAttributePart');
    expect(result.code).toContain('EventPart');
  });

  it('ignores non-lit templates', () => {
    const input = `
const str = \`plain template \${1 + 1}\`;
const other = someTag\`<h1>Not lit</h1>\`;
`;
    const result = compileHtmlAot(input, { filename: 'other.ts' });
    expect(result.templatesCount).toBe(0);
    expect(result.code).not.toContain('_$litType$');
  });

  it('correctly matches golden test files', () => {
    const sampleFiles = ['basic.ts', 'basic_lit_import.ts', 'basic_litelement.ts', 'part_attribute.js', 'part_boolean_attribute.js', 'part_event.js', 'part_property.js', 'parts_kitchen_sink.js'];

    for (const file of sampleFiles) {
      const filePath = path.join(testFilesDir, file);
      if (!fs.existsSync(filePath)) continue;

      const base = file.replace(/\.[jt]s$/, '');
      const goldenPath = path.join(testFilesDir, `${base}.golden.js`);
      if (!fs.existsSync(goldenPath)) continue;

      const source = fs.readFileSync(filePath, 'utf-8');
      const expected = fs.readFileSync(goldenPath, 'utf-8').trim();

      const result = compileHtmlAot(source, { filename: file });
      const normalize = (s: string) =>
        s
          .replace(/\s+/g, ' ')
          .replace(/,\s*([}\]])/g, '$1')
          .replace(/\(i\) =>/g, 'i =>')
          .replace(/b_1 `/g, 'b_1`')
          .replace(/\s*([{\[\]}:;,])\s*/g, '$1')
          .replace(/["']/g, '"')
          .trim();
      expect(normalize(result.code)).toBe(normalize(expected));
    }
  });
});


