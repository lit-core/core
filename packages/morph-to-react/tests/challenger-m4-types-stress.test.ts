import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { compileModule } from '../src/index.js';

/**
 * Validates a generated .d.ts string using TypeScript's own compiler APIs:
 * 1. ts.createSourceFile verifies syntactic grammar and structure.
 * 2. ts.createProgram verifies semantic type resolution with zero diagnostics.
 */
function verifyDtsSyntaxAndSemantics(dtsContent: string, extraDeclarations = '') {
  // 1. Syntactic check via ts.createSourceFile
  const sourceFile = ts.createSourceFile('test-component.d.ts', dtsContent, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  expect(sourceFile).toBeDefined();
  const parseDiagnostics = (sourceFile as any).parseDiagnostics || [];
  expect(parseDiagnostics).toHaveLength(0);

  // 2. Semantic check via ts.createProgram
  const options: ts.CompilerOptions = {
    noEmit: true,
    skipLibCheck: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    strict: true,
  };
  const host = ts.createCompilerHost(options);
  const origGetSourceFile = host.getSourceFile;
  host.getSourceFile = (fileName, languageVersion) => {
    if (fileName === 'test-component.d.ts') {
      const fullSource = extraDeclarations ? `${extraDeclarations}\n${dtsContent}` : dtsContent;
      return ts.createSourceFile(fileName, fullSource, languageVersion, true, ts.ScriptKind.TS);
    }
    return origGetSourceFile(fileName, languageVersion);
  };

  const program = ts.createProgram(['test-component.d.ts'], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    const errorMessages = errors.map((e) => {
      const msg = typeof e.messageText === 'string' ? e.messageText : e.messageText.messageText;
      return `TS${e.code}: ${msg}`;
    });
    expect.fail(`TypeScript semantic diagnostics reported errors:\n${errorMessages.join('\n')}`);
  }
}

describe('milestone 4 challenger: empirical typescript .d.ts and event typing stress tests', () => {
  // =========================================================================
  // Feature 69: TypeScript .d.ts declaration generation
  // =========================================================================

  describe('feature 69: typescript .d.ts generation', () => {
    it('generates accurate declarations for primitive properties with explicit TS annotations', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        export class PrimitiveComp extends LitElement {
          @property() title: string = 'Default Title';
          @property() count: number = 42;
          @property() active: boolean = true;

          render() {
            return html\`<div>\${this.title} (\${this.count}) \${this.active ? 'active' : ''}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'primitive.ts', emitDts: true });
      expect(res.dts).toBeDefined();
      const dts = res.dts ?? '';

      // Check imports
      expect(dts).toContain('import type * as React from "react";');
      expect(dts).toContain('import type { MorphHost } from "@lit-core/morph-to-react/runtime";');

      // Check Props interface
      expect(dts).toContain('export interface PrimitiveCompProps extends React.HTMLAttributes<HTMLElement>');
      expect(dts).toContain('title?: string;');
      expect(dts).toContain('count?: number;');
      expect(dts).toContain('active?: boolean;');
      expect(dts).toContain('children?: React.ReactNode;');

      // Check Host class
      expect(dts).toContain('export declare class PrimitiveCompHost extends MorphHost');
      expect(dts).toContain('title: string;');
      expect(dts).toContain('count: number;');
      expect(dts).toContain('active: boolean;');

      // Check ForwardRef component
      expect(dts).toContain('export declare const PrimitiveComp: React.ForwardRefExoticComponent<React.PropsWithoutRef<PrimitiveCompProps> & React.RefAttributes<PrimitiveCompHost>>;');

      verifyDtsSyntaxAndSemantics(dts);
    });

    it('maps Lit property types (String, Number, Boolean, Array, Object) without TS annotations', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        export class LitTypeComp extends LitElement {
          @property({ type: String }) strVal = 'hello';
          @property({ type: Number }) numVal = 100;
          @property({ type: Boolean }) boolVal = false;
          @property({ type: Array }) arrVal = [];
          @property({ type: Object }) objVal = {};

          render() {
            return html\`<div>\${this.strVal}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'lit-types.ts', emitDts: true });
      expect(res.dts).toBeDefined();
      const dts = res.dts ?? '';

      expect(dts).toContain('strVal?: string;');
      expect(dts).toContain('numVal?: number;');
      expect(dts).toContain('boolVal?: boolean;');
      expect(dts).toContain('arrVal?: any[];');
      expect(dts).toContain('objVal?: object;');

      expect(dts).toContain('strVal: string;');
      expect(dts).toContain('numVal: number;');
      expect(dts).toContain('boolVal: boolean;');
      expect(dts).toContain('arrVal: any[];');
      expect(dts).toContain('objVal: object;');

      verifyDtsSyntaxAndSemantics(dts);
    });

    it('preserves complex TS types: union types, arrays, object records, and optionals', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        export class ComplexTypesComp extends LitElement {
          @property() size?: 'small' | 'medium' | 'large';
          @property() tags: string[] = ['a', 'b'];
          @property() options: Record<string, number> = {};
          @property() description?: string;

          render() {
            return html\`<div>\${this.size}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'complex-types.ts', emitDts: true });
      expect(res.dts).toBeDefined();
      const dts = res.dts ?? '';

      expect(dts).toContain('size?: "small" | "medium" | "large";');
      expect(dts).toContain('tags?: string[];');
      expect(dts).toContain('options?: Record<string, number>;');
      expect(dts).toContain('description?: string;');

      expect(dts).toContain('size: "small" | "medium" | "large";');
      expect(dts).toContain('tags: string[];');
      expect(dts).toContain('options: Record<string, number>;');
      expect(dts).toContain('description: string;');

      verifyDtsSyntaxAndSemantics(dts);
    });

    it('emits lightweight pure function declaration for Tier 0 components', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        export class PureBadge extends LitElement {
          @property({ type: String }) text = 'badge';

          render() {
            return html\`<span class="badge">\${this.text}</span>\`;
          }
        }
      `;

      const res = compileModule(code, {
        filePath: 'pure-badge.ts',
        emitDts: true,
        targetTier: 'Tier0Pure',
      });
      expect(res.dts).toBeDefined();
      const dts = res.dts ?? '';

      // Tier 0 must not import MorphHost
      expect(dts).toContain('import type * as React from "react";');
      expect(dts).not.toContain('@lit-core/morph-to-react/runtime');
      expect(dts).not.toContain('MorphHost');

      // Tier 0 emits function declaration returning React.JSX.Element
      expect(dts).toContain('export interface PureBadgeProps extends React.HTMLAttributes<HTMLElement>');
      expect(dts).toContain('export declare function PureBadge(props: PureBadgeProps): React.JSX.Element;');
      expect(dts).not.toContain('PureBadgeHost');
      expect(dts).not.toContain('ForwardRefExoticComponent');

      verifyDtsSyntaxAndSemantics(dts);
    });

    it('preserves public methods with parameters and return types while filtering lifecycles', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        export class InteractiveDialog extends LitElement {
          @property({ type: Boolean }) open = false;

          showModal(focusSelector?: string): boolean {
            return true;
          }

          close(returnValue?: string): void {}

          private _internalHelper() {}
          connectedCallback() {}
          disconnectedCallback() {}
          updated() {}

          render() {
            return html\`<dialog ?open=\${this.open}>Content</dialog>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'dialog.ts', emitDts: true });
      expect(res.dts).toBeDefined();
      const dts = res.dts ?? '';

      // Public methods present on Host class
      expect(dts).toContain('showModal(focusSelector?: string): boolean;');
      expect(dts).toContain('close(returnValue?: string): void;');

      // Private and lifecycle methods omitted
      expect(dts).not.toContain('_internalHelper');
      expect(dts).not.toContain('connectedCallback');
      expect(dts).not.toContain('disconnectedCallback');
      expect(dts).not.toContain('updated():');

      verifyDtsSyntaxAndSemantics(dts);
    });

    it('emits declarations for all components in multi-component files', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        export class MultiHeader extends LitElement {
          @property({ type: String }) title = 'Header';
          render() { return html\`<header>\${this.title}</header>\`; }
        }

        export class MultiFooter extends LitElement {
          @property({ type: String }) copyright = '2026';
          render() { return html\`<footer>\${this.copyright}</footer>\`; }
        }
      `;

      const res = compileModule(code, { filePath: 'multi.ts', emitDts: true });
      expect(res.dts).toBeDefined();
      const dts = res.dts ?? '';

      // Both components exported
      expect(dts).toContain('export interface MultiHeaderProps');
      expect(dts).toContain('export declare class MultiHeaderHost extends MorphHost');
      expect(dts).toContain('export declare const MultiHeader:');

      expect(dts).toContain('export interface MultiFooterProps');
      expect(dts).toContain('export declare class MultiFooterHost extends MorphHost');
      expect(dts).toContain('export declare const MultiFooter:');

      verifyDtsSyntaxAndSemantics(dts);
    });

    it('returns undefined for dts when emitDts: false is specified', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        export class NoDtsComp extends LitElement {
          @property({ type: String }) val = 'test';
          render() { return html\`<div>\${this.val}</div>\`; }
        }
      `;

      const res = compileModule(code, { filePath: 'no-dts.ts', emitDts: false });
      expect(res.dts).toBeUndefined();
    });
  });

  // =========================================================================
  // Feature 70: Strongly-typed event callbacks
  // =========================================================================

  describe('feature 70: strongly-typed event callbacks', () => {
    it('emits strongly-typed CustomEvent<DetailType> for custom generic detail types', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export interface TreeNodeDetail {
          nodeId: string;
          depth: number;
          expanded: boolean;
        }

        export class TreeView extends LitElement {
          private handleNodeExpand(id: string, depth: number) {
            this.dispatchEvent(new CustomEvent<TreeNodeDetail>('node-expand', {
              detail: { nodeId: id, depth, expanded: true },
            }));
          }

          render() {
            return html\`<div class="tree">Tree</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'tree.ts', emitDts: true });
      expect(res.dts).toBeDefined();
      const dts = res.dts ?? '';

      expect(dts).toContain('onNodeExpand?: (event: CustomEvent<TreeNodeDetail>) => void;');

      // Validate semantics with TreeNodeDetail declaration in context
      const extraTypes = `
        export interface TreeNodeDetail {
          nodeId: string;
          depth: number;
          expanded: boolean;
        }
      `;
      verifyDtsSyntaxAndSemantics(dts, extraTypes);
    });

    it('emits strongly-typed callbacks for primitive detail types: string, number, boolean', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class PrimitiveEvents extends LitElement {
          notify() {
            this.dispatchEvent(new CustomEvent<string>('filter-change', { detail: 'active' }));
            this.dispatchEvent(new CustomEvent<number>('page-change', { detail: 2 }));
            this.dispatchEvent(new CustomEvent<boolean>('toggle-change', { detail: false }));
          }

          render() {
            return html\`<div>Events</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'primitive-events.ts', emitDts: true });
      expect(res.dts).toBeDefined();
      const dts = res.dts ?? '';

      expect(dts).toContain('onFilterChange?: (event: CustomEvent<string>) => void;');
      expect(dts).toContain('onPageChange?: (event: CustomEvent<number>) => void;');
      expect(dts).toContain('onToggleChange?: (event: CustomEvent<boolean>) => void;');

      // Primitives need no extra declarations to pass semantic typecheck
      verifyDtsSyntaxAndSemantics(dts);
    });

    it('defaults untyped CustomEvent dispatches to CustomEvent<unknown>', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class UntypedEvents extends LitElement {
          fireUntyped() {
            this.dispatchEvent(new CustomEvent('simple-event'));
          }

          render() {
            return html\`<div>Untyped</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'untyped.ts', emitDts: true });
      expect(res.dts).toBeDefined();
      const dts = res.dts ?? '';

      expect(dts).toContain('onSimpleEvent?: (event: CustomEvent<unknown>) => void;');
      verifyDtsSyntaxAndSemantics(dts);
    });

    it('extracts template event listeners (@event) and maps to onEvent?: (event: CustomEvent<unknown>) => void', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class TemplateEvents extends LitElement {
          handleClick() {}
          handleCustomSelect() {}

          render() {
            return html\`
              <div @click=\${this.handleClick}>
                <custom-list @item-select=\${this.handleCustomSelect}></custom-list>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'template-events.ts', emitDts: true });
      expect(res.dts).toBeDefined();
      const dts = res.dts ?? '';

      expect(dts).toContain('onClick?: (event: CustomEvent<unknown>) => void;');
      expect(dts).toContain('onItemSelect?: (event: CustomEvent<unknown>) => void;');
      verifyDtsSyntaxAndSemantics(dts);
    });

    it('correctly converts complex kebab-case event names to camelCase props', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class CasingEvents extends LitElement {
          emitAll() {
            this.dispatchEvent(new CustomEvent('user-profile-avatar-update'));
            this.dispatchEvent(new CustomEvent('single'));
            this.dispatchEvent(new CustomEvent('a-b-c-d'));
          }

          render() { return html\`<div></div>\`; }
        }
      `;

      const res = compileModule(code, { filePath: 'casing.ts', emitDts: true });
      expect(res.dts).toBeDefined();
      const dts = res.dts ?? '';

      expect(dts).toContain('onUserProfileAvatarUpdate?: (event: CustomEvent<unknown>) => void;');
      expect(dts).toContain('onSingle?: (event: CustomEvent<unknown>) => void;');
      expect(dts).toContain('onABCD?: (event: CustomEvent<unknown>) => void;');

      verifyDtsSyntaxAndSemantics(dts);
    });

    it('sorts multiple event properties alphabetically in Props interface', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class SortedEvents extends LitElement {
          emitVarious() {
            this.dispatchEvent(new CustomEvent('zebra-event'));
            this.dispatchEvent(new CustomEvent('alpha-event'));
            this.dispatchEvent(new CustomEvent('middle-event'));
          }

          render() { return html\`<div></div>\`; }
        }
      `;

      const res = compileModule(code, { filePath: 'sorted.ts', emitDts: true });
      expect(res.dts).toBeDefined();
      const dts = res.dts ?? '';

      const alphaIdx = dts.indexOf('onAlphaEvent?:');
      const middleIdx = dts.indexOf('onMiddleEvent?:');
      const zebraIdx = dts.indexOf('onZebraEvent?:');

      expect(alphaIdx).toBeGreaterThan(-1);
      expect(middleIdx).toBeGreaterThan(alphaIdx);
      expect(zebraIdx).toBeGreaterThan(middleIdx);

      verifyDtsSyntaxAndSemantics(dts);
    });
  });

  // =========================================================================
  // AST Codegen Invariants: Zero String Splicing
  // =========================================================================

  describe('ast codegen invariants: zero string splicing', () => {
    it('emits syntactically valid TypeScript AST with zero formatting or bracket corruption', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        export class SyntaxCheckComp extends LitElement {
          @property({ type: String }) name = 'Syntax';
          @property({ type: Number }) count = 0;
          @property({ type: Boolean }) enabled = true;

          render() {
            return html\`<div class="test">Hello \${this.name}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'syntax-check.ts', emitDts: true });
      expect(res.dts).toBeDefined();
      const dts = res.dts ?? '';

      // Verify no broken template string leftovers or unmatched braces
      expect(dts).not.toContain('${');
      expect(dts).not.toContain('undefined');
      expect(dts).not.toContain('NaN');

      const sourceFile = ts.createSourceFile('syntax.d.ts', dts, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      expect((sourceFile as any).parseDiagnostics).toHaveLength(0);
    });
  });
});
