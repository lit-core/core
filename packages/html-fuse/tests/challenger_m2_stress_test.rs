use html_fuse::codegen::rewrite_file;
use html_fuse::extractor::template_visitor::TemplateVisitor;
use html_fuse::models::HtmlClusterGroup;
use oxc_allocator::Allocator;
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::SourceType;

fn scan_source(source: &str, file_name: &'static str) -> TemplateVisitor<'static> {
    // Leaking for test convenience to satisfy lifetime
    let source_box: &'static str = Box::leak(source.to_string().into_boxed_str());
    let allocator = Box::leak(Box::new(Allocator::default()));
    let parsed = Parser::new(allocator, source_box, SourceType::ts()).parse();
    let semantic_ret = oxc_semantic::SemanticBuilder::new().build(&parsed.program);
    let scoping = Box::leak(Box::new(semantic_ret.semantic.into_scoping()));

    let mut visitor = TemplateVisitor::new(source_box, file_name, 10, scoping);
    visitor.scan_imports(&parsed.program);
    visitor.visit_program(&parsed.program);
    visitor
}

#[test]
fn test_namespace_lit_html_and_svg_all_variants() {
    let source = r#"
    import * as Lit from 'lit';
    import * as LitHtml from 'lit-html';
    import * as LitElem from 'lit-element';

    const t1 = Lit.html`<div class="ns1"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg></div>`;
    const t2 = Lit.svg`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
    const t3 = LitHtml.html`<div class="ns2"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg></div>`;
    const t4 = LitElem.html`<div class="ns3"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg></div>`;

    // Direct invocation of namespace object (Lit`...`) must NOT be treated as a template
    const invalid = Lit`<div class="fail"></div>`;
    // Non-html property on namespace (Lit.other`...`) must NOT be treated as a template
    const otherProp = Lit.css`:host { color: red; }`;
    "#;

    let visitor = scan_source(source, "ns_all.ts");
    assert_eq!(
        visitor.templates_scanned, 4,
        "Should scan exactly the 4 Lit.html and Lit.svg templates, ignoring Lit`...` and Lit.css`...`"
    );

    // Verify SVG detection
    let svg_frags: Vec<_> = visitor
        .extracted_fragments
        .iter()
        .filter(|f| f.is_svg)
        .collect();
    assert!(!svg_frags.is_empty(), "Lit.svg must extract SVG fragments");
}

#[test]
fn test_foreign_namespace_isolation_even_with_mixed_lit_imports() {
    let source = r#"
    import { html } from 'lit';
    import * as Other from 'other-lib';
    import * as React from 'react';
    import * as Cheerio from 'cheerio';

    // Valid Lit template
    const litTmpl = html`<div class="valid"><svg viewBox="0 0 10 10"><path d="M0 0"/></svg></div>`;

    // Foreign namespace member calls ending in .html or .svg must NOT be extracted
    const oHtml = Other.html`<div class="invalid"><svg viewBox="0 0 10 10"><path d="M0 0"/></svg></div>`;
    const oSvg = Other.svg`<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>`;
    const rHtml = React.html`<div></div>`;
    const cHtml = Cheerio.html`<div></div>`;
    "#;

    let visitor = scan_source(source, "mixed_foreign.ts");
    assert_eq!(
        visitor.templates_scanned, 1,
        "Only the genuine Lit html template should be scanned; all foreign namespaces must be ignored"
    );
}

#[test]
fn test_lexical_scoping_and_shadowing_adversarial() {
    let source = r#"
    import { html } from 'lit';
    import * as Lit from 'lit';

    // 1. Unshadowed global scope: valid
    export const globalTmpl = html`<div class="ok"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg></div>`;

    // 2. Function parameter shadowing: invalid
    export function fnParamShadow(html: any) {
        return html`<div class="shadow-param"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg></div>`;
    }

    // 3. Block-scoped const shadowing: invalid
    export function blockShadow() {
        {
            const html = (s: any) => "local";
            const shadowed = html`<div class="shadow-block"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg></div>`;
        }
        // Unshadowed sibling in same function: valid
        return html`<div class="sibling-ok"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg></div>`;
    }

    // 4. Namespace identifier shadowed in local scope: invalid
    export function nsShadow() {
        {
            const Lit = { html: (s: any) => "not-lit" };
            const shadowedNs = Lit.html`<div class="shadow-ns"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg></div>`;
        }
        // Unshadowed sibling Lit.html: valid
        return Lit.html`<div class="ns-sibling-ok"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg></div>`;
    }

    // 5. Arrow function parameter shadowing: invalid
    export const arrowShadow = (html: any) => html`<div class="arrow-shadow"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg></div>`;
    "#;

    let visitor = scan_source(source, "shadowing.ts");
    assert_eq!(
        visitor.templates_scanned, 3,
        "Should scan exactly the 3 unshadowed Lit templates (globalTmpl, sibling-ok, ns-sibling-ok) and ignore all 4 shadowed ones"
    );
}

#[test]
fn test_rewriter_comprehensive_ast_statement_coverage() {
    let source = r#"
    import { html } from 'lit';

    export default function allControlFlow(n: number) {
        label1: for (let i = 0; i < n; i++) {
            const forT = html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
            break label1;
        }

        for (const item of [1, 2]) {
            const ofT = html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
        }

        for (const k in { a: 1 }) {
            const inT = html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
        }

        do {
            const doT = html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
        } while (false);

        try {
            const tryT = html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
        } catch (err) {
            const catchT = html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
        } finally {
            const finalT = html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
        }

        switch (n) {
            case 0:
                return html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
            default:
                return html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
        }
    }
    "#;

    let visitor = scan_source(source, "control_flow.ts");
    assert_eq!(
        visitor.templates_scanned, 9,
        "Should scan all 9 templates across all control flow branches"
    );
    assert!(!visitor.extracted_fragments.is_empty());

    let hash = &visitor.extracted_fragments[0].hash;
    let cluster_id = format!("_fused_svg_{}", hash);
    let clusters = vec![HtmlClusterGroup {
        id: cluster_id.clone(),
        canonical_text: r#"<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>"#
            .to_string(),
        is_svg: true,
        shared_by_files: vec!["control_flow.ts".to_string()],
        occurrences_count: 9,
        file_name: format!("{}.js", cluster_id),
    }];

    let rewritten = rewrite_file(
        "control_flow.ts",
        source,
        &visitor.extracted_fragments,
        &clusters,
        ".fused-html",
        true,
    )
    .expect("rewrite_file should succeed across all control flow statements");

    let code = &rewritten.transformed_code;
    println!("Rewritten control flow code:\n{}", code);

    // Verify all control flow statements remain intact
    assert!(
        code.contains("label1: for"),
        "Labeled statement must remain"
    );
    assert!(
        code.contains("for (const item of"),
        "for-of statement must remain"
    );
    assert!(
        code.contains("for (const k in"),
        "for-in statement must remain"
    );
    assert!(code.contains("do {"), "do-while statement must remain");
    assert!(code.contains("try {"), "try block must remain");
    assert!(code.contains("catch (err)"), "catch block must remain");
    assert!(code.contains("finally {"), "finally block must remain");
    assert!(code.contains("switch (n)"), "switch statement must remain");
    assert!(
        code.contains(&cluster_id),
        "Cluster import and replacement must be present"
    );

    // Verify SVG template literals were replaced by fused cluster references
    assert!(
        !code.contains(r#"<circle cx="5" cy="5" r="5"/>"#),
        "Raw SVG subtrees must be replaced with cluster references"
    );
}
