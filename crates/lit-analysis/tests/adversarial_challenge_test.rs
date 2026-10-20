use lit_analysis::analyze_lit_module;
use lit_analysis::symbol::{CanonicalLitSymbol, HeritageProof, SymbolProofContext};
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

#[test]
fn test_minified_and_aliased_imports_comprehensive() {
    let source = r#"
        import {
            html as a,
            css as b,
            LitElement as c,
            svg as d,
            customElement as e,
            property as f,
            state as g
        } from 'lit';

        @e('aliased-el')
        class MyElement extends c {
            @f({ type: String }) title = 'test';
            @g() counter = 0;

            static styles = b`
                :host { display: block; }
            `;

            render() {
                return a`<div title=${this.title}>${d`<svg><circle r="10"/></svg>`}</div>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    let semantic = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic.semantic.into_scoping();
    let ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    // 1. Verify symbol resolution on raw tags and classes
    let root_scope = scoping.root_scope_id();
    let sym_a = scoping.get_binding(root_scope, "a".into()).unwrap();
    let sym_b = scoping.get_binding(root_scope, "b".into()).unwrap();
    let sym_c = scoping.get_binding(root_scope, "c".into()).unwrap();
    let sym_d = scoping.get_binding(root_scope, "d".into()).unwrap();
    let sym_e = scoping.get_binding(root_scope, "e".into()).unwrap();
    let sym_f = scoping.get_binding(root_scope, "f".into()).unwrap();
    let sym_g = scoping.get_binding(root_scope, "g".into()).unwrap();

    assert_eq!(
        ctx.lit_symbols.get(&sym_a),
        Some(&CanonicalLitSymbol::HtmlTag)
    );
    assert_eq!(
        ctx.lit_symbols.get(&sym_b),
        Some(&CanonicalLitSymbol::CssTag)
    );
    assert_eq!(
        ctx.lit_symbols.get(&sym_c),
        Some(&CanonicalLitSymbol::LitElement)
    );
    assert_eq!(
        ctx.lit_symbols.get(&sym_d),
        Some(&CanonicalLitSymbol::SvgTag)
    );
    assert_eq!(
        ctx.lit_symbols.get(&sym_e),
        Some(&CanonicalLitSymbol::CustomElementDecorator)
    );
    assert_eq!(
        ctx.lit_symbols.get(&sym_f),
        Some(&CanonicalLitSymbol::PropertyDecorator)
    );
    assert_eq!(
        ctx.lit_symbols.get(&sym_g),
        Some(&CanonicalLitSymbol::StateDecorator)
    );

    // 2. Verify analyze_lit_module extracts the component accurately
    let res = analyze_lit_module(&allocator, source, "aliased.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    let comp = &res.components[0];
    assert_eq!(comp.tag_name.as_deref(), Some("aliased-el"));
    assert_eq!(comp.class_name, "MyElement");
    assert_eq!(comp.super_class.as_deref(), Some("LitElement"));
    assert_eq!(comp.styles.len(), 1);
    assert!(comp.styles[0].css_text.contains("display: block;"));
    assert_eq!(comp.properties.len(), 2);
}

#[test]
fn test_mixed_aliased_and_third_party_imports() {
    let source = r#"
        import { html as litHtml, css as litCss, LitElement } from 'lit';
        import { html as uHtml } from 'uhtml';
        import { css as emoCss } from '@emotion/css';

        class MixedComponent extends LitElement {
            static styles = litCss`span { color: green; }`;
            static extraStyles = emoCss`span { color: red; }`;

            renderLit() {
                return litHtml`<span>Lit</span>`;
            }

            renderUHtml() {
                return uHtml`<span>UHtml</span>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    let semantic = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic.semantic.into_scoping();
    let ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    for stmt in &parsed.program.body {
        if let Statement::ClassDeclaration(cls) = stmt {
            for element in &cls.body.body {
                if let ClassElement::MethodDefinition(method) = element {
                    let method_name = method.key.static_name().unwrap();
                    if let Some(body) = &method.value.body {
                        for s in &body.statements {
                            if let Statement::ReturnStatement(ret) = s {
                                if let Some(Expression::TaggedTemplateExpression(tagged)) =
                                    &ret.argument
                                {
                                    if method_name == "renderLit" {
                                        assert!(
                                            ctx.is_lit_html_tag(&tagged.tag),
                                            "litHtml should be recognized as Lit HTML tag"
                                        );
                                    } else if method_name == "renderUHtml" {
                                        assert!(
                                            !ctx.is_lit_html_tag(&tagged.tag),
                                            "uHtml must NOT be recognized as Lit HTML tag"
                                        );
                                    }
                                }
                            }
                        }
                    }
                } else if let ClassElement::PropertyDefinition(prop) = element {
                    let prop_name = prop.key.static_name().unwrap();
                    if let Some(Expression::TaggedTemplateExpression(tagged)) = &prop.value {
                        if prop_name == "styles" {
                            assert!(
                                ctx.is_lit_css_tag(&tagged.tag),
                                "litCss should be recognized as Lit CSS tag"
                            );
                        } else if prop_name == "extraStyles" {
                            assert!(
                                !ctx.is_lit_css_tag(&tagged.tag),
                                "emoCss must NOT be recognized as Lit CSS tag"
                            );
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn test_parameter_shadowed_identifiers() {
    let source = r#"
        import { html, css, LitElement } from 'lit';

        function renderWithParam(html, css) {
            const h = html`<div>parameter</div>`;
            const c = css`div { color: black; }`;
            return { h, c };
        }

        class ParamShadowElement extends LitElement {
            renderCustom(html) {
                return html`<div>shadowed in method</div>`;
            }

            render() {
                return html`<div>genuine lit</div>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    let semantic = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic.semantic.into_scoping();
    let ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    for stmt in &parsed.program.body {
        match stmt {
            Statement::FunctionDeclaration(func) => {
                if func.id.as_ref().map(|id| id.name.as_str()) == Some("renderWithParam") {
                    let body = func.body.as_ref().unwrap();
                    for s in &body.statements {
                        if let Statement::VariableDeclaration(var) = s {
                            for decl in &var.declarations {
                                if let Some(Expression::TaggedTemplateExpression(tagged)) =
                                    &decl.init
                                {
                                    assert!(
                                        !ctx.is_lit_html_tag(&tagged.tag),
                                        "Parameter-shadowed html must NOT be recognized as Lit tag"
                                    );
                                    assert!(
                                        !ctx.is_lit_css_tag(&tagged.tag),
                                        "Parameter-shadowed css must NOT be recognized as Lit tag"
                                    );
                                }
                            }
                        }
                    }
                }
            }
            Statement::ClassDeclaration(cls) => {
                for element in &cls.body.body {
                    if let ClassElement::MethodDefinition(method) = element {
                        let name = method.key.static_name().unwrap();
                        let body = method.value.body.as_ref().unwrap();
                        if let Statement::ReturnStatement(ret) = &body.statements[0] {
                            if let Some(Expression::TaggedTemplateExpression(tagged)) =
                                &ret.argument
                            {
                                if name == "renderCustom" {
                                    assert!(
                                        !ctx.is_lit_html_tag(&tagged.tag),
                                        "Method parameter-shadowed html must NOT be recognized"
                                    );
                                } else if name == "render" {
                                    assert!(
                                        ctx.is_lit_html_tag(&tagged.tag),
                                        "Top-level imported html in render() MUST be recognized"
                                    );
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

#[test]
fn test_block_shadowed_identifiers() {
    let source = r#"
        import { html, LitElement } from 'lit';

        class BlockShadowElement extends LitElement {
            render() {
                {
                    const html = (quasis, ...exprs) => "fake";
                    const fakeResult = html`<span>fake</span>`;
                }
                return html`<span>genuine</span>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    let semantic = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic.semantic.into_scoping();
    let ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    for stmt in &parsed.program.body {
        if let Statement::ClassDeclaration(cls) = stmt {
            let method = match &cls.body.body[0] {
                ClassElement::MethodDefinition(m) => m,
                _ => panic!("Expected method"),
            };
            let body = method.value.body.as_ref().unwrap();

            if let Statement::BlockStatement(block) = &body.statements[0] {
                if let Statement::VariableDeclaration(var) = &block.body[1] {
                    if let Some(Expression::TaggedTemplateExpression(tagged)) =
                        &var.declarations[0].init
                    {
                        assert!(
                            !ctx.is_lit_html_tag(&tagged.tag),
                            "Block-scoped shadowed html must NOT be recognized as Lit tag"
                        );
                    }
                }
            }

            if let Statement::ReturnStatement(ret) = &body.statements[1] {
                if let Some(Expression::TaggedTemplateExpression(tagged)) = &ret.argument {
                    assert!(
                        ctx.is_lit_html_tag(&tagged.tag),
                        "Outer imported html must be recognized as genuine Lit tag"
                    );
                }
            }
        }
    }
}

#[test]
fn test_shadowed_base_class_and_local_classes() {
    let source = r#"
        import { LitElement as RealLitElement } from 'lit';

        // Local non-lit class with the name LitElement
        class LitElement {
            customField = 123;
        }

        // Subclass of local LitElement, NOT the imported LitElement
        class FakeLitComponent extends LitElement {
            render() { return "not-lit"; }
        }

        // Subclass of RealLitElement
        class GenuineLitComponent extends RealLitElement {
            render() { return "lit"; }
        }
    "#;

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    let semantic = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic.semantic.into_scoping();
    let ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    for stmt in &parsed.program.body {
        if let Statement::ClassDeclaration(cls) = stmt {
            let class_name = cls.id.as_ref().unwrap().name.as_str();
            let proof = ctx.prove_heritage(cls);
            if class_name == "FakeLitComponent" {
                assert!(
                    !matches!(proof, HeritageProof::ProvenLitElement { .. }),
                    "FakeLitComponent must NOT be ProvenLitElement"
                );
            } else if class_name == "GenuineLitComponent" {
                assert!(
                    matches!(proof, HeritageProof::ProvenLitElement { .. }),
                    "GenuineLitComponent MUST be ProvenLitElement"
                );
            }
        }
    }

    let res = analyze_lit_module(&allocator, source, "classes.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    assert_eq!(res.components[0].class_name, "GenuineLitComponent");
}

#[test]
fn test_shadowed_custom_elements_define_variations() {
    let source = r#"
        import { LitElement } from 'lit';

        class ComponentA extends LitElement {}
        class ComponentB extends LitElement {}
        class ComponentC extends LitElement {}

        // 1. Function parameter shadowing customElements
        function registerA(customElements) {
            customElements.define('comp-a', ComponentA);
        }

        // 2. Block-scoped shadowing customElements
        {
            const customElements = { define: () => {} };
            customElements.define('comp-b', ComponentB);
        }

        // 3. Genuine registration
        customElements.define('comp-c', ComponentC);
    "#;

    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, source, "ce_shadow.ts").unwrap();
    let comp_a = res
        .components
        .iter()
        .find(|c| c.class_name == "ComponentA")
        .unwrap();
    assert_eq!(
        comp_a.tag_name, None,
        "Parameter-shadowed customElements.define must NOT register tag"
    );

    let comp_b = res
        .components
        .iter()
        .find(|c| c.class_name == "ComponentB")
        .unwrap();
    assert_eq!(
        comp_b.tag_name, None,
        "Block-shadowed customElements.define must NOT register tag"
    );

    let comp_c = res
        .components
        .iter()
        .find(|c| c.class_name == "ComponentC")
        .unwrap();
    assert_eq!(
        comp_c.tag_name.as_deref(),
        Some("comp-c"),
        "Global customElements.define MUST register tag"
    );
}

#[test]
fn test_shadowed_transpiled_helpers() {
    let source = r#"
        import { LitElement, property } from 'lit';

        // Local function named _ts_decorate, NOT from @swc/helpers or tslib
        function _ts_decorate(decorators, target, key, desc) {
            return null;
        }

        class FakeTranspiledEl extends LitElement {
            myProp = 'initial';
        }

        _ts_decorate([
            property({ type: String })
        ], FakeTranspiledEl.prototype, "myProp", void 0);
    "#;

    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, source, "fake_helper.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    let comp = &res.components[0];
    assert_eq!(
        comp.properties.len(),
        0,
        "Local _ts_decorate should not be treated as genuine transpiled helper"
    );
}

#[test]
fn test_deep_mixin_and_intermediate_classes() {
    let source = r#"
        import { LitElement, html } from 'lit';

        const MixinA = (base) => class extends base {
            mixinMethod() {}
        };

        const MixinB = (base) => class extends base {
            anotherMixinMethod() {}
        };

        class DeepElement extends MixinA(MixinB(LitElement)) {
            render() {
                return html`<div>deep</div>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    let semantic = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic.semantic.into_scoping();
    let ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    for stmt in &parsed.program.body {
        if let Statement::ClassDeclaration(cls) = stmt {
            if cls.id.as_ref().unwrap().name == "DeepElement" {
                let proof = ctx.prove_heritage(cls);
                match proof {
                    HeritageProof::ProvenLitElement { depth, mixins } => {
                        assert!(depth >= 2, "Depth should reflect mixin wrapping");
                        assert_eq!(mixins.len(), 2);
                        assert_eq!(mixins[0], "MixinA");
                        assert_eq!(mixins[1], "MixinB");
                    }
                    other => panic!("Expected ProvenLitElement, got {:?}", other),
                }
            }
        }
    }
}

#[test]
fn test_aliased_namespace_and_nested_directives() {
    let source = r#"
        import * as litCore from 'lit';
        import * as repeatDir from 'lit/directives/repeat.js';
        import { ifDefined as ifDef } from 'lit/directives/if-defined.js';

        class AliasedDirectiveComponent extends litCore.LitElement {
            render() {
                return litCore.html`
                    <div id=${ifDef(this.id)}>
                        ${repeatDir.repeat(this.items, (i) => i.id, (i) => litCore.html`<span>${i.name}</span>`)}
                    </div>
                `;
            }
        }
    "#;

    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, source, "aliased_dir.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    let comp = &res.components[0];
    assert_eq!(comp.class_name, "AliasedDirectiveComponent");
    assert_eq!(comp.super_class.as_deref(), Some("LitElement"));
}

// =========================================================================
// HOSTILE CHALLENGES: Non-Lit files, lookalikes, and third-party classes
// =========================================================================

#[test]
fn test_non_lit_imports_and_lookalikes() {
    let source = r#"
        import { LitElement } from 'fake-lit';
        import { html } from 'uhtml';
        import { css } from 'styled-components';
        import { property } from 'mobx';
        import { customElement } from './my-decorators';

        @customElement('fake-el')
        class FakeElement extends LitElement {
            @property foo = 1;
            static styles = css`div { color: blue; }`;
            render() {
                return html`<div>Fake</div>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, source, "fake.ts").unwrap();
    // fake-lit is not a canonical Lit package, so this must yield 0 components
    assert_eq!(
        res.components.len(),
        0,
        "fake-lit must yield zero components"
    );
    assert_eq!(res.manifest.components.len(), 0);
}

#[test]
fn test_plain_class_with_static_styles_no_lit() {
    let source = r#"
        class PlainVanillaCard {
            static styles = { color: 'blue' };
        }
    "#;
    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, source, "plain.js").unwrap();
    assert_eq!(
        res.components.len(),
        0,
        "Plain class with static styles must not be a Lit component"
    );
}

#[test]
fn test_plain_class_with_static_properties_no_lit() {
    let source = r#"
        class PlainVanillaModel {
            static properties = {
                id: { type: Number }
            };
        }
    "#;
    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, source, "plain_model.js").unwrap();
    assert_eq!(
        res.components.len(),
        0,
        "Plain class with static properties must not be a Lit component"
    );
}

#[test]
fn test_backbone_model_with_static_properties_no_lit() {
    let source = r#"
        import { Model } from 'backbone';

        class UserModel extends Model {
            static properties = {
                id: { type: Number }
            };
        }
    "#;
    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, source, "backbone.js").unwrap();
    assert_eq!(
        res.components.len(),
        0,
        "Backbone model with static properties must not be a Lit component"
    );
}

#[test]
fn test_react_component_with_static_styles_no_lit() {
    let source = r#"
        import React from 'react';

        class HeaderWidget extends React.Component {
            static styles = {
                header: { fontSize: 16 }
            };
            render() {
                return null;
            }
        }
    "#;
    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, source, "react.js").unwrap();
    assert_eq!(
        res.components.len(),
        0,
        "React component with static styles must not be a Lit component"
    );
}

#[test]
fn test_prove_heritage_returns_none_for_non_lit_classes() {
    let source = r#"
        import React from 'react';
        import { Model } from 'backbone';
        import { LitElement as FakeLit } from 'fake-lit';

        class PlainCard {
            static styles = { color: 'blue' };
        }

        class PlainModel {
            static properties = { id: { type: Number } };
        }

        class BackboneUser extends Model {
            static properties = { name: { type: String } };
        }

        class ReactHeader extends React.Component {
            static styles = { header: { fontSize: 16 } };
            render() { return null; }
        }

        class FakeComponent extends FakeLit {
            static styles = { color: 'red' };
        }
    "#;

    let allocator = Allocator::default();
    let source_type = SourceType::ts();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    let semantic = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic.semantic.into_scoping();
    let ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    for stmt in &parsed.program.body {
        if let Statement::ClassDeclaration(cls) = stmt {
            let proof = ctx.prove_heritage(cls);
            assert_eq!(
                proof,
                HeritageProof::None,
                "Class {:?} must prove to HeritageProof::None",
                cls.id.as_ref().map(|id| id.name.as_str())
            );
        }
    }
}

#[test]
fn test_mixed_lit_and_non_lit_classes_in_same_file() {
    let source = r#"
        import { LitElement, html, css } from 'lit';

        class GenuineLitCard extends LitElement {
            static styles = css`div { color: green; }`;
            render() {
                return html`<div>genuine</div>`;
            }
        }

        class NonLitHelperModel {
            static properties = { id: { type: Number } };
        }

        class NonLitPlainWidget {
            static styles = { color: 'purple' };
        }
    "#;

    let allocator = Allocator::default();
    let source_type = SourceType::ts();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    let semantic = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic.semantic.into_scoping();
    let ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    for stmt in &parsed.program.body {
        if let Statement::ClassDeclaration(cls) = stmt {
            let name = cls.id.as_ref().unwrap().name.as_str();
            let proof = ctx.prove_heritage(cls);
            if name == "GenuineLitCard" {
                assert!(
                    matches!(proof, HeritageProof::ProvenLitElement { .. }),
                    "GenuineLitCard must be ProvenLitElement"
                );
            } else {
                assert_eq!(
                    proof,
                    HeritageProof::None,
                    "{} must prove to HeritageProof::None even when file imports Lit",
                    name
                );
            }
        }
    }

    let res = analyze_lit_module(&allocator, source, "mixed.ts").unwrap();
    assert_eq!(
        res.components.len(),
        1,
        "Only GenuineLitCard should be recognized"
    );
    assert_eq!(res.components[0].class_name, "GenuineLitCard");
}
