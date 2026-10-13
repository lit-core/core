use html_fuse::codegen::rewrite_file;
use html_fuse::extractor::template_visitor::TemplateVisitor;
use html_fuse::models::HtmlClusterGroup;
use oxc_allocator::Allocator;
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::SourceType;

fn scan_source(source: &str, file_name: &str) -> (u32, Vec<html_fuse::models::ExtractedFragment>) {
    let allocator = Allocator::default();
    let is_ts = file_name.ends_with(".ts") || file_name.ends_with(".tsx");
    let source_type = SourceType::ts().with_typescript(is_ts);
    let parsed = Parser::new(&allocator, source, source_type).parse();
    assert!(
        parsed.diagnostics.is_empty(),
        "Source should parse without errors: {:?}",
        parsed.diagnostics
    );

    let semantic_ret = oxc_semantic::SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic_ret.semantic.into_scoping();
    let mut visitor = TemplateVisitor::new(source, file_name, 10, &scoping);
    visitor.scan_imports(&parsed.program);
    visitor.visit_program(&parsed.program);
    (visitor.templates_scanned, visitor.extracted_fragments)
}

#[test]
fn test_namespace_lit_imports_comprehensive() {
    // Test various canonical Lit namespace import forms
    let source1 = r#"
        import * as Lit from 'lit';
        const t1 = Lit.html`<svg viewBox="0 0 10 10"><path d="M1 1"/></svg>`;
        const t2 = Lit.svg`<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5"/></svg>`;
    "#;
    let (scanned1, frags1) = scan_source(source1, "ns1.ts");
    assert_eq!(scanned1, 2, "Both Lit.html and Lit.svg scanned");
    assert!(!frags1.is_empty());
    assert!(
        !frags1[0].is_svg || frags1[0].canonical_text.starts_with("<svg"),
        "Fragment 0 is valid SVG/HTML"
    );
    assert!(
        frags1.iter().any(|f| f.is_svg),
        "Lit.svg fragment marked as SVG"
    );

    let source2 = r#"
        import * as LitHtml from 'lit-html';
        const t = LitHtml.html`<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`;
    "#;
    let (scanned2, frags2) = scan_source(source2, "ns2.ts");
    assert_eq!(
        scanned2, 1,
        "LitHtml.html recognized as canonical Lit namespace"
    );
    assert!(!frags2.is_empty());

    let source3 = r#"
        import * as Reactive from '@lit/reactive-element';
        const t = Reactive.html`<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10"/></svg>`;
    "#;
    let (scanned3, _) = scan_source(source3, "ns3.ts");
    assert_eq!(
        scanned3, 1,
        "@lit/reactive-element recognized as canonical Lit namespace"
    );

    let source4 = r#"
        import * as MyCustomLit from 'lit/index.js';
        const t = MyCustomLit.html`<svg viewBox="0 0 10 10"><polygon points="0,0 10,0 5,10"/></svg>`;
    "#;
    let (scanned4, _) = scan_source(source4, "ns4.ts");
    assert_eq!(
        scanned4, 1,
        "lit/index.js recognized as canonical Lit namespace"
    );
}

#[test]
fn test_foreign_namespace_isolation_adversarial() {
    // 1. Foreign namespace only
    let foreign1 = r#"
        import * as Other from 'other-lib';
        const t = Other.html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
    "#;
    let (scanned1, _) = scan_source(foreign1, "foreign1.ts");
    assert_eq!(
        scanned1, 0,
        "Other.html from foreign library must NOT be scanned"
    );

    // 2. Both canonical Lit and foreign namespace in the same file
    let foreign2 = r#"
        import * as Lit from 'lit';
        import * as Canvas from 'canvas-renderer';
        import * as Graph from 'graph-lib';

        export function renderBoth() {
            const litTemplate = Lit.html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
            const canvasTemplate = Canvas.html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
            const graphTemplate = Graph.svg`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
            return { litTemplate, canvasTemplate, graphTemplate };
        }
    "#;
    let (scanned2, frags2) = scan_source(foreign2, "foreign2.ts");
    assert_eq!(
        scanned2, 1,
        "ONLY Lit.html scanned, Canvas.html and Graph.svg completely ignored"
    );
    assert!(!frags2.is_empty());

    // 3. Named Lit import + Foreign namespace calling .html
    let foreign3 = r#"
        import { html } from 'lit';
        import * as Unknown from 'unknown-template-engine';

        const real = html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
        const fake = Unknown.html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
    "#;
    let (scanned3, frags3) = scan_source(foreign3, "foreign3.ts");
    assert_eq!(
        scanned3, 1,
        "Only canonical named html scanned; Unknown.html ignored despite named html in scope"
    );
    assert!(!frags3.is_empty());
}

#[test]
fn test_lexical_scope_shadowing_adversarial() {
    // 1. Function parameter shadowing
    let shadow_param = r#"
        import { html } from 'lit';
        function wrapper(html: (s: any) => string) {
            return html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
        }
    "#;
    let (scanned1, _) = scan_source(shadow_param, "shadow1.ts");
    assert_eq!(scanned1, 0, "Parameter shadowed html must NOT be scanned");

    // 2. Local variable shadowing inside block
    let shadow_block = r#"
        import { html } from 'lit';
        export function compute(condition: boolean) {
            if (condition) {
                const html = (strings: TemplateStringsArray) => "fake";
                return html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
            }
            return null;
        }
    "#;
    let (scanned2, _) = scan_source(shadow_block, "shadow2.ts");
    assert_eq!(scanned2, 0, "Block shadowed html must NOT be scanned");

    // 3. Namespace object shadowing
    let shadow_ns = r#"
        import * as Lit from 'lit';
        function test() {
            const Lit = { html: (s: any) => "shadowed" };
            return Lit.html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
        }
    "#;
    let (scanned3, _) = scan_source(shadow_ns, "shadow3.ts");
    assert_eq!(
        scanned3, 0,
        "Shadowed namespace object Lit must NOT be scanned"
    );

    // 4. Coexistence: canonical in outer scope, shadowed in inner scope
    let coexistence = r#"
        import { html } from 'lit';

        export function valid() {
            return html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
        }

        export function shadowed() {
            const html = (s: any) => "local";
            return html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
        }
    "#;
    let (scanned4, frags4) = scan_source(coexistence, "coexist.ts");
    assert_eq!(
        scanned4, 1,
        "Exactly 1 valid template scanned; shadowed template ignored"
    );
    assert!(!frags4.is_empty());
}

#[test]
fn test_ast_codegen_across_all_control_flow_constructs() {
    let source = r#"
        import { html } from 'lit';

        export function fullControlFlow(val: number, items: string[], flag: boolean) {
            switch (val) {
                case 1: {
                    const s1 = html`<svg viewBox="0 0 10 10"><path d="M1 1"/></svg>`;
                    break;
                }
                case 2:
                    return html`<svg viewBox="0 0 10 10"><path d="M1 1"/></svg>`;
                default: {
                    break;
                }
            }

            try {
                for (let i = 0; i < 5; i++) {
                    const loopTmpl = html`<svg viewBox="0 0 10 10"><path d="M1 1"/></svg>`;
                }
                for (const item of items) {
                    const ofTmpl = html`<svg viewBox="0 0 10 10"><path d="M1 1"/></svg>`;
                }
                for (const key in items) {
                    const inTmpl = html`<svg viewBox="0 0 10 10"><path d="M1 1"/></svg>`;
                }
            } catch (err) {
                while (flag) {
                    const whileTmpl = html`<svg viewBox="0 0 10 10"><path d="M1 1"/></svg>`;
                    break;
                }
                do {
                    const doTmpl = html`<svg viewBox="0 0 10 10"><path d="M1 1"/></svg>`;
                    break;
                } while (flag);
            } finally {
                myLabel: {
                    const labelTmpl = html`<svg viewBox="0 0 10 10"><path d="M1 1"/></svg>`;
                }
            }

            return null;
        }
    "#;

    let (scanned, frags) = scan_source(source, "control_flow.ts");
    assert_eq!(scanned, 8, "All 8 templates across control flow scanned");
    assert!(!frags.is_empty());

    let hash = &frags[0].hash;
    let cluster_id = format!("_fused_svg_{}", hash);
    let clusters = vec![HtmlClusterGroup {
        id: cluster_id.clone(),
        canonical_text: r#"<svg viewBox="0 0 10 10"><path d="M1 1"/></svg>"#.to_string(),
        is_svg: true,
        shared_by_files: vec!["control_flow.ts".to_string()],
        occurrences_count: 8,
        file_name: format!("{}.js", cluster_id),
    }];

    let rewritten = rewrite_file(
        "control_flow.ts",
        source,
        &frags,
        &clusters,
        ".fused-html",
        true,
    )
    .expect("rewrite_file should succeed across all statement types");

    let code = &rewritten.transformed_code;
    println!("Rewritten full control flow:\n{}", code);

    // Verify all control flow statements survived
    assert!(code.contains("switch (val)"), "switch preserved");
    assert!(code.contains("case 1:"), "case 1 preserved");
    assert!(code.contains("case 2:"), "case 2 preserved");
    assert!(code.contains("try {"), "try block preserved");
    assert!(
        code.contains("for (let i = 0; i < 5; i++)"),
        "for loop preserved"
    );
    assert!(
        code.contains("for (const item of items)"),
        "for-of preserved"
    );
    assert!(
        code.contains("for (const key in items)"),
        "for-in preserved"
    );
    assert!(code.contains("} catch (err) {"), "catch block preserved");
    assert!(code.contains("while (flag)"), "while preserved");
    assert!(code.contains("do {"), "do-while preserved");
    assert!(code.contains("} finally {"), "finally block preserved");
    assert!(code.contains("myLabel: {"), "labeled statement preserved");

    // Verify all 8 templates were replaced with cluster_id
    let count = code.matches(&cluster_id).count();
    // 2 in import declaration (named import + specifier) + 8 replacement usages = 10 occurrences
    assert_eq!(
        count, 10,
        "Import (specifier + clause) + 8 replacement usages of cluster_id"
    );

    // Ensure the rewritten code is syntactically valid TypeScript/JavaScript!
    let allocator = Allocator::default();
    let reparsed = Parser::new(&allocator, code, SourceType::ts()).parse();
    assert!(
        reparsed.diagnostics.is_empty(),
        "Transformed code must be valid syntax with 0 diagnostics: {:?}",
        reparsed.diagnostics
    );
}
