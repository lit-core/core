use lit_analysis::analyze_lit_module;
use lit_analysis::symbol::{CanonicalDirective, CanonicalLitSymbol, SymbolProofContext};
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

#[test]
fn test_challenge_custom_elements_define_variations() {
    let allocator = Allocator::default();

    // 1. Unresolved global customElements.define
    let src1 = r#"
        import { LitElement } from 'lit';
        class El1 extends LitElement {}
        customElements.define('el-one', El1);
    "#;
    let res1 = analyze_lit_module(&allocator, src1, "el1.ts").unwrap();
    assert_eq!(res1.components.len(), 1);
    assert_eq!(res1.components[0].tag_name.as_deref(), Some("el-one"));

    // 2. Global window.customElements.define
    let src2 = r#"
        import { LitElement } from 'lit';
        class El2 extends LitElement {}
        window.customElements.define('el-two', El2);
    "#;
    let res2 = analyze_lit_module(&allocator, src2, "el2.ts").unwrap();
    assert_eq!(res2.components.len(), 1);
    assert_eq!(res2.components[0].tag_name.as_deref(), Some("el-two"));

    // 3. Global globalThis.customElements.define
    let src3 = r#"
        import { LitElement } from 'lit';
        class El3 extends LitElement {}
        globalThis.customElements.define('el-three', El3);
    "#;
    let res3 = analyze_lit_module(&allocator, src3, "el3.ts").unwrap();
    assert_eq!(res3.components.len(), 1);
    assert_eq!(res3.components[0].tag_name.as_deref(), Some("el-three"));

    // 4. Global self.customElements.define
    let src4 = r#"
        import { LitElement } from 'lit';
        class El4 extends LitElement {}
        self.customElements.define('el-four', El4);
    "#;
    let res4 = analyze_lit_module(&allocator, src4, "el4.ts").unwrap();
    assert_eq!(res4.components.len(), 1);
    assert_eq!(res4.components[0].tag_name.as_deref(), Some("el-four"));

    // 5. Shadowed local customElements object
    let src5 = r#"
        import { LitElement } from 'lit';
        class El5 extends LitElement {}
        const customElements = { define() {} };
        customElements.define('el-five', El5);
    "#;
    let res5 = analyze_lit_module(&allocator, src5, "el5.ts").unwrap();
    assert_eq!(res5.components.len(), 1);
    assert_eq!(
        res5.components[0].tag_name, None,
        "Shadowed customElements must be rejected"
    );

    // 6. Shadowed window object
    let src6 = r#"
        import { LitElement } from 'lit';
        class El6 extends LitElement {}
        const window = { customElements: { define() {} } };
        window.customElements.define('el-six', El6);
    "#;
    let res6 = analyze_lit_module(&allocator, src6, "el6.ts").unwrap();
    assert_eq!(res6.components.len(), 1);
    assert_eq!(
        res6.components[0].tag_name, None,
        "Shadowed window must be rejected"
    );

    // 7. Shadowed globalThis object
    let src7 = r#"
        import { LitElement } from 'lit';
        class El7 extends LitElement {}
        const globalThis = { customElements: { define() {} } };
        globalThis.customElements.define('el-seven', El7);
    "#;
    let res7 = analyze_lit_module(&allocator, src7, "el7.ts").unwrap();
    assert_eq!(res7.components.len(), 1);
    assert_eq!(
        res7.components[0].tag_name, None,
        "Shadowed globalThis must be rejected"
    );

    // 8. Shadowed self object
    let src8 = r#"
        import { LitElement } from 'lit';
        class El8 extends LitElement {}
        const self = { customElements: { define() {} } };
        self.customElements.define('el-eight', El8);
    "#;
    let res8 = analyze_lit_module(&allocator, src8, "el8.ts").unwrap();
    assert_eq!(res8.components.len(), 1);
    assert_eq!(
        res8.components[0].tag_name, None,
        "Shadowed self must be rejected"
    );

    // 9. Imported customElements polyfill
    let src9 = r#"
        import { LitElement } from 'lit';
        import { customElements } from './custom-elements-polyfill.js';
        class El9 extends LitElement {}
        customElements.define('el-nine', El9);
    "#;
    let res9 = analyze_lit_module(&allocator, src9, "el9.ts").unwrap();
    assert_eq!(res9.components.len(), 1);
    assert_eq!(
        res9.components[0].tag_name, None,
        "Imported customElements must be rejected"
    );

    // 10. customElements.define with 3 arguments (extends options)
    let src10 = r#"
        import { LitElement } from 'lit';
        class El10 extends LitElement {}
        customElements.define('el-ten', El10, { extends: 'button' });
    "#;
    let res10 = analyze_lit_module(&allocator, src10, "el10.ts").unwrap();
    assert_eq!(res10.components.len(), 1);
    assert_eq!(res10.components[0].tag_name.as_deref(), Some("el-ten"));

    // 11. customElements.define with static template literal tag
    let src11 = r#"
        import { LitElement } from 'lit';
        class El11 extends LitElement {}
        customElements.define(`el-eleven`, El11);
    "#;
    let res11 = analyze_lit_module(&allocator, src11, "el11.ts").unwrap();
    assert_eq!(res11.components.len(), 1);
    assert_eq!(res11.components[0].tag_name.as_deref(), Some("el-eleven"));

    // 12. customElements.define with dynamic tag
    let src12 = r#"
        import { LitElement } from 'lit';
        class El12 extends LitElement {}
        customElements.define(`el-${'twelve'}`, El12);
    "#;
    let res12 = analyze_lit_module(&allocator, src12, "el12.ts").unwrap();
    assert_eq!(res12.components.len(), 1);
    assert_eq!(
        res12.components[0].tag_name, None,
        "Dynamic tag should yield None"
    );
}

#[test]
fn test_challenge_custom_elements_define_callee_isolated() {
    let allocator = Allocator::default();
    let source_valid = r#"
        customElements.define('a-a', A);
        window.customElements.define('b-b', B);
        globalThis.customElements.define('c-c', C);
        self.customElements.define('d-d', D);
        customElements.otherMethod('j-j', J);
        customElements.define();
        customElements.define('k-k');
    "#;

    let parsed_v = Parser::new(&allocator, source_valid, SourceType::ts()).parse();
    let sem_v = SemanticBuilder::new().build(&parsed_v.program);
    let scop_v = sem_v.semantic.into_scoping();
    let ctx_v = SymbolProofContext::scan(&parsed_v.program, &scop_v, source_valid);

    let calls_v: Vec<_> = parsed_v
        .program
        .body
        .iter()
        .filter_map(|s| match s {
            oxc_ast::ast::Statement::ExpressionStatement(e) => match &e.expression {
                oxc_ast::ast::Expression::CallExpression(c) => Some(c.as_ref()),
                _ => None,
            },
            _ => None,
        })
        .collect();

    // calls_v[0]: customElements.define('a-a', A); -> Valid
    assert!(ctx_v.is_custom_elements_define_callee(&calls_v[0].callee));
    assert_eq!(
        ctx_v
            .is_custom_elements_define(calls_v[0])
            .unwrap()
            .tag
            .as_deref(),
        Some("a-a")
    );

    // calls_v[1]: window.customElements.define('b-b', B); -> Valid
    assert!(ctx_v.is_custom_elements_define_callee(&calls_v[1].callee));
    assert_eq!(
        ctx_v
            .is_custom_elements_define(calls_v[1])
            .unwrap()
            .tag
            .as_deref(),
        Some("b-b")
    );

    // calls_v[2]: globalThis.customElements.define('c-c', C); -> Valid
    assert!(ctx_v.is_custom_elements_define_callee(&calls_v[2].callee));
    assert_eq!(
        ctx_v
            .is_custom_elements_define(calls_v[2])
            .unwrap()
            .tag
            .as_deref(),
        Some("c-c")
    );

    // calls_v[3]: self.customElements.define('d-d', D); -> Valid
    assert!(ctx_v.is_custom_elements_define_callee(&calls_v[3].callee));
    assert_eq!(
        ctx_v
            .is_custom_elements_define(calls_v[3])
            .unwrap()
            .tag
            .as_deref(),
        Some("d-d")
    );

    // calls_v[4]: customElements.otherMethod -> Invalid callee
    assert!(!ctx_v.is_custom_elements_define_callee(&calls_v[4].callee));
    assert!(ctx_v.is_custom_elements_define(calls_v[4]).is_none());

    // calls_v[5]: customElements.define() (< 2 args) -> Callee valid, define call None
    assert!(ctx_v.is_custom_elements_define_callee(&calls_v[5].callee));
    assert!(ctx_v.is_custom_elements_define(calls_v[5]).is_none());

    // calls_v[6]: customElements.define('k-k') (1 arg) -> Callee valid, define call None
    assert!(ctx_v.is_custom_elements_define_callee(&calls_v[6].callee));
    assert!(ctx_v.is_custom_elements_define(calls_v[6]).is_none());
}

#[test]
fn test_challenge_double_underscore_decorate_class() {
    let allocator = Allocator::default();
    let src = r#"
        import { __decorateClass } from '@swc/helpers';
        import { LitElement, property, customElement } from 'lit';

        let DecClassEl2 = class extends LitElement {};
        __decorateClass([property({ type: Boolean })], DecClassEl2.prototype, "flag", void 0);
        DecClassEl2 = __decorateClass([customElement("dec-class-el2")], DecClassEl2);
    "#;
    let res = analyze_lit_module(&allocator, src, "dec_class2.js").unwrap();
    assert_eq!(res.components.len(), 1);
    assert_eq!(res.components[0].tag_name.as_deref(), Some("dec-class-el2"));
    assert_eq!(res.components[0].properties.len(), 1);
    assert_eq!(res.components[0].properties[0].name, "flag");
}

#[test]
fn test_challenge_single_underscore_decorate_class() {
    let allocator = Allocator::default();
    let src = r#"
        import { _decorateClass } from '@swc/helpers';
        import { LitElement, property, customElement } from 'lit';

        let DecClassEl1 = class extends LitElement {};
        _decorateClass([property({ type: Boolean })], DecClassEl1.prototype, "flag", void 0);
        DecClassEl1 = _decorateClass([customElement("dec-class-el1")], DecClassEl1);
    "#;
    let res = analyze_lit_module(&allocator, src, "dec_class1.js").unwrap();
    assert_eq!(res.components.len(), 1);
    let is_tag_found = res.components[0].tag_name.as_deref() == Some("dec-class-el1");
    let is_prop_found = res.components[0].properties.len() == 1;
    // Empirically asserts whether _decorateClass (1 underscore) is recognized
    assert!(
        is_tag_found,
        "_decorateClass class decorator was not recognized!"
    );
    assert!(
        is_prop_found,
        "_decorateClass member decorator was not recognized!"
    );
}

#[test]
fn test_challenge_all_21_directives_thorough() {
    let allocator = Allocator::default();

    let slug_directives = [
        ("until", "until.js", CanonicalDirective::Until),
        (
            "asyncAppend",
            "async-append.js",
            CanonicalDirective::AsyncAppend,
        ),
        (
            "asyncReplace",
            "async-replace.js",
            CanonicalDirective::AsyncReplace,
        ),
        ("cache", "cache.js", CanonicalDirective::Cache),
        ("choose", "choose.js", CanonicalDirective::Choose),
        ("classMap", "class-map.js", CanonicalDirective::ClassMap),
        ("guard", "guard.js", CanonicalDirective::Guard),
        ("ifDefined", "if-defined.js", CanonicalDirective::IfDefined),
        ("keyed", "keyed.js", CanonicalDirective::Keyed),
        ("live", "live.js", CanonicalDirective::Live),
        ("map", "map.js", CanonicalDirective::Map),
        ("range", "range.js", CanonicalDirective::Range),
        ("ref", "ref.js", CanonicalDirective::Ref),
        ("repeat", "repeat.js", CanonicalDirective::Repeat),
        ("styleMap", "style-map.js", CanonicalDirective::StyleMap),
        (
            "templateContent",
            "template-content.js",
            CanonicalDirective::TemplateContent,
        ),
        (
            "unsafeHTML",
            "unsafe-html.js",
            CanonicalDirective::UnsafeHTML,
        ),
        ("unsafeSVG", "unsafe-svg.js", CanonicalDirective::UnsafeSVG),
        ("when", "when.js", CanonicalDirective::When),
        ("slice", "slice.js", CanonicalDirective::Slice),
        ("join", "join.js", CanonicalDirective::Join),
    ];

    for (name, slug, canonical) in slug_directives {
        // 1. Named import from lit/directives/<slug>
        let src_named = format!("import {{ {name} }} from 'lit/directives/{slug}';");
        let parsed = Parser::new(&allocator, &src_named, SourceType::ts()).parse();
        let sem = SemanticBuilder::new().build(&parsed.program);
        let scop = sem.semantic.into_scoping();
        let ctx = SymbolProofContext::scan(&parsed.program, &scop, &src_named);
        let sym = scop.get_binding(scop.root_scope_id(), name.into()).unwrap();
        assert_eq!(
            ctx.lit_symbols.get(&sym),
            Some(&CanonicalLitSymbol::Directive(canonical)),
            "Named import failed for {}",
            name
        );

        // 2. Default import from lit/directives/<slug>
        let src_default = format!("import myDir from 'lit/directives/{slug}';");
        let parsed_d = Parser::new(&allocator, &src_default, SourceType::ts()).parse();
        let sem_d = SemanticBuilder::new().build(&parsed_d.program);
        let scop_d = sem_d.semantic.into_scoping();
        let ctx_d = SymbolProofContext::scan(&parsed_d.program, &scop_d, &src_default);
        let sym_d = scop_d
            .get_binding(scop_d.root_scope_id(), "myDir".into())
            .unwrap();
        assert_eq!(
            ctx_d.lit_symbols.get(&sym_d),
            Some(&CanonicalLitSymbol::Directive(canonical)),
            "Default import failed for {}",
            name
        );

        // 3. Namespace import from lit/directives/<slug>
        let src_ns = format!("import * as ns from 'lit/directives/{slug}';");
        let parsed_ns = Parser::new(&allocator, &src_ns, SourceType::ts()).parse();
        let sem_ns = SemanticBuilder::new().build(&parsed_ns.program);
        let scop_ns = sem_ns.semantic.into_scoping();
        let ctx_ns = SymbolProofContext::scan(&parsed_ns.program, &scop_ns, &src_ns);
        let sym_ns = scop_ns
            .get_binding(scop_ns.root_scope_id(), "ns".into())
            .unwrap();
        assert_eq!(
            ctx_ns.lit_symbols.get(&sym_ns),
            Some(&CanonicalLitSymbol::DirectiveNamespace(canonical)),
            "Namespace import failed for {}",
            name
        );

        // 4. Import from lit-html/directives/<slug>
        let src_lit_html = format!("import {{ {name} }} from 'lit-html/directives/{slug}';");
        let parsed_lh = Parser::new(&allocator, &src_lit_html, SourceType::ts()).parse();
        let sem_lh = SemanticBuilder::new().build(&parsed_lh.program);
        let scop_lh = sem_lh.semantic.into_scoping();
        let ctx_lh = SymbolProofContext::scan(&parsed_lh.program, &scop_lh, &src_lit_html);
        let sym_lh = scop_lh
            .get_binding(scop_lh.root_scope_id(), name.into())
            .unwrap();
        assert_eq!(
            ctx_lh.lit_symbols.get(&sym_lh),
            Some(&CanonicalLitSymbol::Directive(canonical)),
            "lit-html import failed for {}",
            name
        );
    }
}
