use lit_analysis::decorator::{DecoratorExtractor, LitDecoratorKind};
use lit_analysis::symbol::SymbolProofContext;
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

#[test]
fn test_stage3_and_legacy_decorators() {
    let source = r#"
        import { LitElement, customElement, property, state, query, eventOptions } from 'lit';

        @customElement('cds-tag')
        class CdsTag extends LitElement {
            @property({ type: Boolean, reflect: true }) open = false;
            @state() count = 0;
            @query('#target') targetEl;
            @eventOptions({ capture: true })
            handleClick() {}
        }
    "#;

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    let semantic = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic.semantic.into_scoping();
    let ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    let class_stmt = parsed
        .program
        .body
        .iter()
        .find_map(|s| match s {
            oxc_ast::ast::Statement::ClassDeclaration(cls) => Some(cls),
            _ => None,
        })
        .unwrap();

    let class_decs = DecoratorExtractor::extract_class_decorators(class_stmt, &ctx);
    assert_eq!(class_decs.len(), 1);
    assert_eq!(
        class_decs[0].kind,
        LitDecoratorKind::CustomElement {
            tag: "cds-tag".to_string()
        }
    );

    let member_decs = DecoratorExtractor::extract_member_decorators(class_stmt, &ctx);
    assert!(member_decs
        .iter()
        .any(|d| d.target_member.as_deref() == Some("open")));
    assert!(member_decs
        .iter()
        .any(|d| d.target_member.as_deref() == Some("count")));
    assert!(member_decs
        .iter()
        .any(|d| d.target_member.as_deref() == Some("targetEl")));
    assert!(member_decs
        .iter()
        .any(|d| d.target_member.as_deref() == Some("handleClick")));
}

#[test]
fn test_transpiled_decorate_helpers() {
    let source = r#"
        import { LitElement, property } from 'lit';
        import { __decorate, __metadata } from 'tslib';

        class CDSButton extends LitElement {}

        __decorate([
            property({ type: Boolean, reflect: true, attribute: "has-main-content" }),
            __metadata("design:type", Boolean)
        ], CDSButton.prototype, "hasMainContent", void 0);

        customElements.define("cds-button", CDSButton);
    "#;

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::mjs()).parse();
    let semantic = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic.semantic.into_scoping();
    let ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    let transpiled =
        DecoratorExtractor::extract_transpiled_helpers(&parsed.program, "CDSButton", &ctx);
    assert_eq!(
        transpiled.len(),
        1,
        "Expected metadata to be stripped, keeping only @property"
    );
    assert_eq!(
        transpiled[0].target_member.as_deref(),
        Some("hasMainContent")
    );

    let tag = DecoratorExtractor::extract_custom_element_tag(
        &parsed.program,
        "CDSButton",
        None,
        &[],
        &ctx,
    );
    assert_eq!(tag, Some("cds-button".to_string()));
}
