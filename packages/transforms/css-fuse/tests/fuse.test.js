import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze, auditScoping, fuse } from '../src/index.js';

console.log('Testing @lit-core/css-fuse native module and AST deduplication pipeline...');

// Test 1: NAPI binding exports
assert.strictEqual(typeof fuse, 'function', 'fuse must be an exported function');
assert.strictEqual(typeof analyze, 'function', 'analyze must be an exported function');
assert.strictEqual(typeof auditScoping, 'function', 'auditScoping must be an exported function');

// Test 2: Real multi-component CSS deduplication
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'css-fuse-test-'));

try {
  const compAPath = path.join(tmpDir, 'comp-a.js');
  const compBPath = path.join(tmpDir, 'comp-b.js');
  const nonLitPath = path.join(tmpDir, 'unrelated.js');

  const compACode = `import { LitElement, html, css } from 'lit';

export class CompA extends LitElement {
  static styles = css\`
    :host {
      display: block;
      box-sizing: border-box;
    }
    .btn {
      color: red;
    }
  \`;
  render() {
    return html\`<div>A</div>\`;
  }
}
`;

  const compBCode = `import { LitElement, html, css } from 'lit';

export class CompB extends LitElement {
  static styles = css\`
    :host {
      display: block;
      box-sizing: border-box;
    }
    .card {
      padding: 16px;
    }
  \`;
  render() {
    return html\`<div>B</div>\`;
  }
}
`;

  // An unrelated file using global unimported css tag that should cleanly bail out
  const nonLitCode = `const localStyles = css\`
  :host {
    display: block;
    box-sizing: border-box;
  }
\`;
`;

  fs.writeFileSync(compAPath, compACode, 'utf8');
  fs.writeFileSync(compBPath, compBCode, 'utf8');
  fs.writeFileSync(nonLitPath, nonLitCode, 'utf8');

  const result = fuse({
    files: [compAPath, compBPath, nonLitPath],
    threshold: 2,
    write: false,
    virtualImports: true,
  });

  // Verify extraction and deduplication metrics
  assert.ok(result, 'fuse result must be returned');
  assert.strictEqual(result.stats.filesScanned, 3, 'three files should be scanned');
  assert.strictEqual(result.stats.stylesExtracted, 2, 'only files with canonical Lit imports should have styles extracted');
  assert.ok(result.stats.rulesDeduped >= 1, 'at least one duplicate rule should be deduplicated');
  assert.ok(result.fusedSheets.length >= 1, 'at least one fused constructable sheet must be created');

  // Verify fused sheet AST generation
  const fusedSheet = result.fusedSheets[0];
  assert.ok(fusedSheet.code.includes("import { css } from 'lit'"), 'fused sheet must import css from lit');
  assert.ok(fusedSheet.code.includes('export const'), 'fused sheet must export the constructable stylesheet');
  assert.ok(fusedSheet.code.includes(':host'), 'fused sheet must contain the shared rule selector');

  // Verify component rewriting
  assert.strictEqual(result.rewrittenFiles.length, 2, 'both Lit components should be rewritten');
  for (const rewritten of result.rewrittenFiles) {
    assert.ok(rewritten.transformedCode.includes('virtual:css-fuse'), 'rewritten component must import virtual fused sheet');
    assert.ok(rewritten.transformedCode.includes('static styles = ['), 'static styles must be transformed into an array preserving cascade order');
  }

  // Verify analyze mode dry-run
  const analyzeResult = analyze({
    files: [compAPath, compBPath],
    threshold: 2,
  });

  assert.ok(analyzeResult.stats.rulesDeduped >= 1, 'analyze mode must report deduplicated rules');

  console.log('✓ All @lit-core/css-fuse integration and AST deduplication checks passed.');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// Test 3: Dynamic expression bailout verification
{
  const tmpDirInterp = fs.mkdtempSync(path.join(os.tmpdir(), 'css-fuse-interp-test-'));
  try {
    const fileDyn = path.join(tmpDirInterp, 'comp-dyn.js');
    const fileStatic = path.join(tmpDirInterp, 'comp-static.js');

    const codeDyn = `import { LitElement, css } from 'lit';
const themeColor = 'blue';
export class CompDyn extends LitElement {
  static styles = css\`
    :host {
      display: block;
    }
    .btn {
      color: \${themeColor};
    }
  \`;
}
`;
    const codeStatic = `import { LitElement, css } from 'lit';
export class CompStatic extends LitElement {
  static styles = css\`
    :host {
      display: block;
    }
  \`;
}
`;

    fs.writeFileSync(fileDyn, codeDyn, 'utf8');
    fs.writeFileSync(fileStatic, codeStatic, 'utf8');

    const res = fuse({
      files: [fileDyn, fileStatic],
      threshold: 2,
      write: false,
      virtualImports: true,
    });

    assert.strictEqual(res.stats.stylesExtracted, 1, 'only fully static styles must be extracted');
    assert.strictEqual(res.rewrittenFiles.length, 0, 'no rewriting when threshold is not met');
    console.log('✓ Dynamic expression bailout verified.');
  } finally {
    fs.rmSync(tmpDirInterp, { recursive: true, force: true });
  }
}
