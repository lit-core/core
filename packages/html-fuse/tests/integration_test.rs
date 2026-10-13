use html_fuse::codegen::rewrite_file;
use html_fuse::extractor::template_visitor::TemplateVisitor;
use html_fuse::models::HtmlClusterGroup;
use oxc_allocator::Allocator;
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::SourceType;

#[test]
fn test_reproduce_namespace_lit_html_missed() {
    let source_ns = r#"
        import * as Lit from 'lit';
        const tmpl = Lit.html`<div class="btn"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg></div>`;
    "#;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source_ns, SourceType::ts()).parse();
    let semantic_ret = oxc_semantic::SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic_ret.semantic.into_scoping();
    let mut visitor = TemplateVisitor::new(source_ns, "test.ts", 10, &scoping);
    visitor.scan_imports(&parsed.program);
    visitor.visit_program(&parsed.program);

    println!(
        "templates_scanned for Lit.html: {}",
        visitor.templates_scanned
    );
    assert_eq!(
        visitor.templates_scanned, 1,
        "Lit.html with namespace import is correctly recognized by html-fuse"
    );
}

#[test]
fn test_reproduce_unrelated_namespace_other_html_falsely_extracted() {
    let source_other = r#"
        import { html } from 'lit';
        import * as Other from 'other-lib';
        const tmpl = Other.html`<div class="btn"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg></div>`;
    "#;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source_other, SourceType::ts()).parse();
    let semantic_ret = oxc_semantic::SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic_ret.semantic.into_scoping();
    let mut visitor = TemplateVisitor::new(source_other, "test.ts", 10, &scoping);
    visitor.scan_imports(&parsed.program);
    visitor.visit_program(&parsed.program);

    println!(
        "templates_scanned for Other.html: {}",
        visitor.templates_scanned
    );
    assert_eq!(
        visitor.templates_scanned, 0,
        "Other.html from non-Lit module is not treated as Lit template"
    );
}

#[test]
fn test_reproduce_shadowed_html_falsely_extracted() {
    let source_shadowed = r#"
        import { html } from 'lit';
        function helper() {
            const html = (strings: any) => "custom-non-lit";
            const tmpl = html`<div class="btn"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg></div>`;
            return tmpl;
        }
    "#;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source_shadowed, SourceType::ts()).parse();
    let semantic_ret = oxc_semantic::SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic_ret.semantic.into_scoping();
    let mut visitor = TemplateVisitor::new(source_shadowed, "test.ts", 10, &scoping);
    visitor.scan_imports(&parsed.program);
    visitor.visit_program(&parsed.program);

    println!(
        "templates_scanned for locally shadowed html: {}",
        visitor.templates_scanned
    );
    assert_eq!(
        visitor.templates_scanned, 0,
        "Locally shadowed html identifier is ignored with semantic scoping"
    );
}

#[test]
fn test_rewriter_switch_try_and_loops_traversal() {
    let source = r#"
        import { html } from 'lit';
        export function renderPatterns(x: number) {
            switch (x) {
                case 1:
                    return html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
                default:
                    break;
            }

            try {
                for (let i = 0; i < 2; i++) {
                    const t = html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
                }
            } catch (e) {
                while (x > 0) {
                    const t = html`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`;
                    break;
                }
            }
            return null;
        }
    "#;

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    let semantic_ret = oxc_semantic::SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic_ret.semantic.into_scoping();
    let mut visitor = TemplateVisitor::new(source, "patterns.ts", 10, &scoping);
    visitor.scan_imports(&parsed.program);
    visitor.visit_program(&parsed.program);

    assert_eq!(visitor.templates_scanned, 3);
    assert!(!visitor.extracted_fragments.is_empty());

    let hash = &visitor.extracted_fragments[0].hash;
    let cluster_id = format!("_fused_svg_{}", hash);
    let clusters = vec![HtmlClusterGroup {
        id: cluster_id.clone(),
        canonical_text: r#"<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>"#
            .to_string(),
        is_svg: true,
        shared_by_files: vec!["patterns.ts".to_string()],
        occurrences_count: 3,
        file_name: format!("{}.js", cluster_id),
    }];

    let rewritten = rewrite_file(
        "patterns.ts",
        source,
        &visitor.extracted_fragments,
        &clusters,
        ".fused-html",
        true,
    )
    .unwrap();
    println!("Rewritten patterns:\n{}", rewritten.transformed_code);
    assert!(rewritten.transformed_code.contains(&cluster_id));
    assert!(rewritten.transformed_code.contains("switch (x)"));
    assert!(rewritten.transformed_code.contains("try {"));
    assert!(rewritten.transformed_code.contains("while (x > 0)"));
}
