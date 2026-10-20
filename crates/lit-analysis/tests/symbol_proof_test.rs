use lit_analysis::symbol::{CanonicalLitSymbol, HeritageProof, SymbolProofContext};
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

#[test]
fn test_canonical_lit_symbols_and_minified_aliasing() {
    let source = r#"
        import { LitElement as LE, html as H, css as C, property as P, customElement as CE } from 'lit';

        @CE('my-el')
        class MyEl extends LE {
            @P() prop = 'hello';
            render() {
                return H`<div>${this.prop}</div>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    assert!(
        parsed.diagnostics.is_empty(),
        "Parse errors: {:?}",
        parsed.diagnostics
    );

    let semantic = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic.semantic.into_scoping();
    let ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    let root_scope = scoping.root_scope_id();
    let sym_le = scoping.get_binding(root_scope, "LE".into()).unwrap();
    let sym_h = scoping.get_binding(root_scope, "H".into()).unwrap();
    let sym_c = scoping.get_binding(root_scope, "C".into()).unwrap();
    let sym_p = scoping.get_binding(root_scope, "P".into()).unwrap();
    let sym_ce = scoping.get_binding(root_scope, "CE".into()).unwrap();

    assert_eq!(
        ctx.lit_symbols.get(&sym_le),
        Some(&CanonicalLitSymbol::LitElement)
    );
    assert_eq!(
        ctx.lit_symbols.get(&sym_h),
        Some(&CanonicalLitSymbol::HtmlTag)
    );
    assert_eq!(
        ctx.lit_symbols.get(&sym_c),
        Some(&CanonicalLitSymbol::CssTag)
    );
    assert_eq!(
        ctx.lit_symbols.get(&sym_p),
        Some(&CanonicalLitSymbol::PropertyDecorator)
    );
    assert_eq!(
        ctx.lit_symbols.get(&sym_ce),
        Some(&CanonicalLitSymbol::CustomElementDecorator)
    );
}

#[test]
fn test_mixin_heritage_unwrapping() {
    let source = r#"
        import { LitElement } from 'lit';

        function FocusMixin(base) { return class extends base {}; }
        function HostListenerMixin(base) { return class extends base {}; }

        class CdsButton extends HostListenerMixin(FocusMixin(LitElement)) {
            render() { return null; }
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
        .expect("CdsButton class not found");

    let heritage = ctx.prove_heritage(class_stmt);
    match heritage {
        HeritageProof::ProvenLitElement { depth, mixins } => {
            assert!(depth >= 2, "Expected mixin depth >= 2, got {}", depth);
            assert!(mixins.contains(&"HostListenerMixin".to_string()));
            assert!(mixins.contains(&"FocusMixin".to_string()));
        }
        other => panic!("Expected ProvenLitElement, got {:?}", other),
    }
}
