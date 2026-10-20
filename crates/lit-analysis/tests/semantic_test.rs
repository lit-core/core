use lit_analysis::analyze_lit_module;
use lit_analysis::classify::ClassificationTier;
use lit_analysis::symbol::{CanonicalDirective, CanonicalLitSymbol, SymbolProofContext};
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

#[test]
fn test_aliased_imports() {
    let source = r#"
        import {
            LitElement as MyBaseClass,
            html as markup,
            css as stylesheet,
            customElement as registerComponent,
            property as reactiveField,
            state as internalField,
            query as domQuery,
        } from 'lit';

        @registerComponent('aliased-card')
        class AliasedCard extends MyBaseClass {
            @reactiveField({ type: String }) title = 'initial';
            @internalField() counter = 0;
            @domQuery('.header') headerElement;

            static styles = stylesheet`
                :host { display: block; }
            `;

            render() {
                return markup`<div class="header">${this.title}</div>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, source, "aliased.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    let comp = &res.components[0];
    assert_eq!(comp.tag_name.as_deref(), Some("aliased-card"));
    assert_eq!(comp.class_name, "AliasedCard");
    assert_eq!(comp.super_class.as_deref(), Some("LitElement"));
    assert_eq!(comp.styles.len(), 1);
    assert!(comp.styles[0].css_text.contains("display: block;"));
    assert_eq!(comp.properties.len(), 2);
    assert!(comp
        .properties
        .iter()
        .any(|p| p.name == "title" && !p.is_state));
    assert!(comp
        .properties
        .iter()
        .any(|p| p.name == "counter" && p.is_state));
}

#[test]
fn test_namespace_imports() {
    let source = r#"
        import * as lit from 'lit';

        @lit.customElement('namespace-card')
        class NamespaceCard extends lit.LitElement {
            @lit.property({ type: Number }) count = 0;

            static styles = lit.css`
                p { color: red; }
            `;

            render() {
                return lit.html`<p>${this.count}</p>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, source, "namespace.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    let comp = &res.components[0];
    assert_eq!(comp.tag_name.as_deref(), Some("namespace-card"));
    assert_eq!(comp.super_class.as_deref(), Some("LitElement"));
    assert_eq!(comp.properties.len(), 1);
    assert_eq!(comp.properties[0].name, "count");
    assert_eq!(comp.styles.len(), 1);
}

#[test]
fn test_minified_single_letter_bindings() {
    let source = r#"
        import { LitElement as a, html as b, css as c, property as d, customElement as e } from 'lit';

        @e('m-btn')
        class f extends a {
            @d({ type: Boolean }) g = false;

            static styles = c`
                :host { display: inline-block; }
            `;

            render() {
                return b`<button ?disabled=${this.g}>click</button>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, source, "minified.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    let comp = &res.components[0];
    assert_eq!(comp.tag_name.as_deref(), Some("m-btn"));
    assert_eq!(comp.class_name, "f");
    assert_eq!(comp.super_class.as_deref(), Some("LitElement"));
    assert_eq!(comp.properties.len(), 1);
    assert_eq!(comp.properties[0].name, "g");
    assert_eq!(comp.styles.len(), 1);
}

#[test]
fn test_shadowed_identifiers_safety() {
    let allocator = Allocator::default();

    // 1. Shadowed html template tag
    let source_shadowed_html = r#"
        import { LitElement, html } from 'lit';

        class ShadowHtmlEl extends LitElement {
            render() {
                const html = (quasis, ...exprs) => "fake";
                return html`<div>shadowed</div>`;
            }
        }
    "#;
    let res1 = analyze_lit_module(&allocator, source_shadowed_html, "s1.ts").unwrap();
    assert_eq!(res1.components.len(), 1);
    #[cfg(feature = "template-ir")]
    assert!(res1.components[0].template.is_none());

    // 2. Shadowed LitElement base class
    let source_shadowed_le = r#"
        const LitElement = class { notLit() {} };
        class NonLitSubclass extends LitElement {}
    "#;
    let res2 = analyze_lit_module(&allocator, source_shadowed_le, "s2.ts").unwrap();
    assert_eq!(res2.components.len(), 0);

    // 3. Shadowed customElements global
    let source_shadowed_ce = r#"
        import { LitElement } from 'lit';
        class LocalWidget extends LitElement {
            render() { return null; }
        }
        const customElements = { define: () => {} };
        customElements.define('local-widget', LocalWidget);
    "#;
    let res3 = analyze_lit_module(&allocator, source_shadowed_ce, "s3.ts").unwrap();
    assert_eq!(res3.components.len(), 1);
    assert_eq!(res3.components[0].tag_name, None);

    // 4. Shadowed window global
    let source_shadowed_win = r#"
        import { LitElement } from 'lit';
        class WinWidget extends LitElement {
            render() { return null; }
        }
        const window = { customElements: { define: () => {} } };
        window.customElements.define('win-widget', WinWidget);
    "#;
    let res4 = analyze_lit_module(&allocator, source_shadowed_win, "s4.ts").unwrap();
    assert_eq!(res4.components.len(), 1);
    assert_eq!(res4.components[0].tag_name, None);

    // 5. Shadowed @property decorator
    let source_shadowed_prop = r#"
        import { LitElement } from 'lit';
        const property = () => (target, key) => {};
        class FakePropEl extends LitElement {
            @property() ignored = 1;
            render() { return null; }
        }
    "#;
    let res5 = analyze_lit_module(&allocator, source_shadowed_prop, "s5.ts").unwrap();
    assert_eq!(res5.components.len(), 1);
    assert_eq!(res5.components[0].properties.len(), 0);

    // 6. Shadowed directive (until)
    let source_shadowed_dir = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';

        class ShadowDirectiveEl extends LitElement {
            render() {
                const until = () => 'safe';
                return html`<div>${until()}</div>`;
            }
        }
    "#;
    let res6 = analyze_lit_module(&allocator, source_shadowed_dir, "s6.ts").unwrap();
    assert_eq!(res6.components.len(), 1);
    assert!(!matches!(
        res6.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));
}

#[test]
fn test_non_lit_files_zero_false_positives() {
    let allocator = Allocator::default();

    // 1. uhtml / hyperx template
    let source_uhtml = r#"
        import { html } from 'uhtml';
        function renderApp() { return html`<div>hello</div>`; }
    "#;
    let res1 = analyze_lit_module(&allocator, source_uhtml, "uhtml.js").unwrap();
    assert_eq!(res1.components.len(), 0);
    assert_eq!(res1.diagnostics.len(), 0);

    // 2. Emotion css tag
    let source_emotion = r#"
        import { css } from '@emotion/css';
        const cls = css`color: blue;`;
    "#;
    let res2 = analyze_lit_module(&allocator, source_emotion, "emotion.js").unwrap();
    assert_eq!(res2.components.len(), 0);
    assert_eq!(res2.diagnostics.len(), 0);

    // 3. Native DOM classes with Element or Host suffix
    let source_elements = r#"
        class FormElement extends HTMLElement {}
        class XmlElement {}
        class StripeElement {}
        class AppHost {}
    "#;
    let res3 = analyze_lit_module(&allocator, source_elements, "classes.js").unwrap();
    assert_eq!(res3.components.len(), 0);
    assert_eq!(res3.diagnostics.len(), 0);

    // 4. Arbitrary .define() calls
    let source_define = r#"
        class Component {}
        const myRegistry = { define: () => {} };
        myRegistry.define('c-el', Component);
        define('c-el', Component);
        defineElement('c-el', Component);
        customElementsDefine('c-el', Component);
    "#;
    let res4 = analyze_lit_module(&allocator, source_define, "define.js").unwrap();
    assert_eq!(res4.components.len(), 0);
    assert_eq!(res4.diagnostics.len(), 0);
}

#[test]
fn test_transpiled_decorator_helpers() {
    let allocator = Allocator::default();

    // 1. @swc/helpers _ts_decorate
    let source_swc = r#"
        import { _ts_decorate } from '@swc/helpers';
        import { LitElement, property, customElement } from 'lit';

        let SwcButton = class extends LitElement {
            constructor() { super(); this.disabled = false; }
        };
        _ts_decorate([
            property({ type: Boolean })
        ], SwcButton.prototype, "disabled", void 0);
        SwcButton = _ts_decorate([
            customElement("swc-button")
        ], SwcButton);
    "#;
    let res1 = analyze_lit_module(&allocator, source_swc, "swc.js").unwrap();
    assert_eq!(res1.components.len(), 1);
    let comp1 = &res1.components[0];
    assert_eq!(comp1.tag_name.as_deref(), Some("swc-button"));
    assert!(comp1.properties.iter().any(|p| p.name == "disabled"));

    // 2. @babel/runtime/helpers applyDecoratedDescriptor
    let source_babel = r#"
        import applyDecoratedDescriptor from '@babel/runtime/helpers/esm/applyDecoratedDescriptor.js';
        import { LitElement, property } from 'lit';

        class BabelButton extends LitElement {
            constructor() { super(); this.label = 'Default'; }
        }
        applyDecoratedDescriptor(
            BabelButton.prototype,
            "label",
            [property({ type: String })],
            Object.getOwnPropertyDescriptor(BabelButton.prototype, "label"),
            BabelButton.prototype
        );
    "#;
    let res2 = analyze_lit_module(&allocator, source_babel, "babel.js").unwrap();
    assert_eq!(res2.components.len(), 1);
    let comp2 = &res2.components[0];
    assert!(comp2.properties.iter().any(|p| p.name == "label"));

    // 3. @babel/runtime/helpers decorate
    let source_babel_class = r#"
        import _decorate from '@babel/runtime/helpers/esm/decorate';
        import { LitElement, customElement } from 'lit';

        let BabelEl = class extends LitElement {};
        BabelEl = _decorate([customElement("babel-el")], BabelEl);
    "#;
    let res3 = analyze_lit_module(&allocator, source_babel_class, "babel-class.js").unwrap();
    assert_eq!(res3.components.len(), 1);
    assert_eq!(res3.components[0].tag_name.as_deref(), Some("babel-el"));
}

#[test]
fn test_all_21_lit_directives() {
    let source = r#"
        import { until } from 'lit/directives/until.js';
        import { asyncAppend } from 'lit/directives/async-append.js';
        import { asyncReplace } from 'lit/directives/async-replace.js';
        import { cache } from 'lit/directives/cache.js';
        import { choose } from 'lit/directives/choose.js';
        import { classMap } from 'lit/directives/class-map.js';
        import { guard } from 'lit/directives/guard.js';
        import { ifDefined } from 'lit/directives/if-defined.js';
        import { keyed } from 'lit/directives/keyed.js';
        import { live } from 'lit/directives/live.js';
        import { map } from 'lit/directives/map.js';
        import { range } from 'lit/directives/range.js';
        import { ref } from 'lit/directives/ref.js';
        import { repeat } from 'lit/directives/repeat.js';
        import { styleMap } from 'lit/directives/style-map.js';
        import { templateContent } from 'lit/directives/template-content.js';
        import { unsafeHTML } from 'lit/directives/unsafe-html.js';
        import { unsafeSVG } from 'lit/directives/unsafe-svg.js';
        import { when } from 'lit/directives/when.js';
        import { slice } from 'lit/directives/slice.js';
        import { join } from 'lit/directives/join.js';
    "#;

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    let semantic = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic.semantic.into_scoping();
    let ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    let root_scope = scoping.root_scope_id();
    let directives = [
        ("until", CanonicalDirective::Until),
        ("asyncAppend", CanonicalDirective::AsyncAppend),
        ("asyncReplace", CanonicalDirective::AsyncReplace),
        ("cache", CanonicalDirective::Cache),
        ("choose", CanonicalDirective::Choose),
        ("classMap", CanonicalDirective::ClassMap),
        ("guard", CanonicalDirective::Guard),
        ("ifDefined", CanonicalDirective::IfDefined),
        ("keyed", CanonicalDirective::Keyed),
        ("live", CanonicalDirective::Live),
        ("map", CanonicalDirective::Map),
        ("range", CanonicalDirective::Range),
        ("ref", CanonicalDirective::Ref),
        ("repeat", CanonicalDirective::Repeat),
        ("styleMap", CanonicalDirective::StyleMap),
        ("templateContent", CanonicalDirective::TemplateContent),
        ("unsafeHTML", CanonicalDirective::UnsafeHTML),
        ("unsafeSVG", CanonicalDirective::UnsafeSVG),
        ("when", CanonicalDirective::When),
        ("slice", CanonicalDirective::Slice),
        ("join", CanonicalDirective::Join),
    ];

    for (name, expected) in directives {
        let sym = scoping
            .get_binding(root_scope, name.into())
            .unwrap_or_else(|| panic!("Missing binding for {}", name));
        assert_eq!(
            ctx.lit_symbols.get(&sym),
            Some(&CanonicalLitSymbol::Directive(expected)),
            "Failed for directive {}",
            name
        );
    }

    // Aliased directive import
    let source_alias = r#"
        import { repeat as rep } from 'lit/directives/repeat.js';
    "#;
    let parsed_a = Parser::new(&allocator, source_alias, SourceType::ts()).parse();
    let sem_a = SemanticBuilder::new().build(&parsed_a.program);
    let scop_a = sem_a.semantic.into_scoping();
    let ctx_a = SymbolProofContext::scan(&parsed_a.program, &scop_a, source_alias);
    let sym_rep = scop_a
        .get_binding(scop_a.root_scope_id(), "rep".into())
        .unwrap();
    assert_eq!(
        ctx_a.lit_symbols.get(&sym_rep),
        Some(&CanonicalLitSymbol::Directive(CanonicalDirective::Repeat))
    );

    // Non-Lit directive with same name (lodash map)
    let source_lodash = r#"
        import { map } from 'lodash-es';
    "#;
    let parsed_l = Parser::new(&allocator, source_lodash, SourceType::ts()).parse();
    let sem_l = SemanticBuilder::new().build(&parsed_l.program);
    let scop_l = sem_l.semantic.into_scoping();
    let ctx_l = SymbolProofContext::scan(&parsed_l.program, &scop_l, source_lodash);
    let sym_map = scop_l
        .get_binding(scop_l.root_scope_id(), "map".into())
        .unwrap();
    assert_eq!(ctx_l.lit_symbols.get(&sym_map), None);
}

#[test]
fn test_custom_elements_define_resolution() {
    let source = r#"
        import { LitElement } from 'lit';

        class ButtonA extends LitElement {}
        class ButtonB extends LitElement {}
        class ButtonC extends LitElement {}
        class ButtonD extends LitElement {}
        class ButtonE extends LitElement {}

        customElements.define('btn-a', ButtonA);
        window.customElements.define('btn-b', ButtonB);
        globalThis.customElements.define('btn-c', ButtonC);
        self.customElements.define('btn-d', ButtonD);
        customElements.define('btn-' + 'e', ButtonE);
    "#;

    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, source, "defines.ts").unwrap();
    assert_eq!(res.components.len(), 5);

    let comp_a = res
        .components
        .iter()
        .find(|c| c.class_name == "ButtonA")
        .unwrap();
    assert_eq!(comp_a.tag_name.as_deref(), Some("btn-a"));

    let comp_b = res
        .components
        .iter()
        .find(|c| c.class_name == "ButtonB")
        .unwrap();
    assert_eq!(comp_b.tag_name.as_deref(), Some("btn-b"));

    let comp_c = res
        .components
        .iter()
        .find(|c| c.class_name == "ButtonC")
        .unwrap();
    assert_eq!(comp_c.tag_name.as_deref(), Some("btn-c"));

    let comp_d = res
        .components
        .iter()
        .find(|c| c.class_name == "ButtonD")
        .unwrap();
    assert_eq!(comp_d.tag_name.as_deref(), Some("btn-d"));

    let comp_e = res
        .components
        .iter()
        .find(|c| c.class_name == "ButtonE")
        .unwrap();
    assert_eq!(comp_e.tag_name, None, "Dynamic tag name should be None");
}
