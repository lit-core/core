#![cfg(feature = "template-ir")]

use lit_analysis::analyze_lit_module;
use lit_analysis::property::PropertyType;
use lit_analysis::symbol::{HeritageProof, SymbolProofContext};
use lit_analysis::template_ir::{
    AttributePart, AttributeValue, ElementNamespace, TemplateNode, TemplateParser,
};
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

#[test]
fn stress_test_consecutive_attribute_holes() {
    // Consecutive holes inside an attribute: class="${a}${b}"
    let quasis = ["<div class=\"", "", "\"></div>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 2).expect("Template should parse");

    assert_eq!(ir.roots.len(), 1);
    if let TemplateNode::Element(el) = &ir.roots[0] {
        let class_attr = el.attributes.iter().find(|a| a.name == "class");
        assert!(class_attr.is_some(), "Element must have 'class' attribute");
        let attr = class_attr.unwrap();

        match &attr.value {
            AttributeValue::Mixed(parts) => {
                println!("Consecutive attribute parts: {:?}", parts);
                assert_eq!(
                    parts.len(),
                    2,
                    "Expected 2 expression parts for consecutive holes in class"
                );
                assert_eq!(parts[0], AttributePart::Expression(0));
                assert_eq!(parts[1], AttributePart::Expression(1));
            }
            other => {
                panic!(
                    "Expected AttributeValue::Mixed with 2 expressions, got {:?}",
                    other
                );
            }
        }
    } else {
        panic!("Expected div Element");
    }
}

#[test]
fn stress_test_unquoted_prefixed_attribute_hole() {
    // Unquoted attribute with a prefix: <div class=btn-${variant}></div>
    let quasis = ["<div class=btn-", "></div>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 1).expect("Template should parse");

    assert_eq!(ir.roots.len(), 1);
    if let TemplateNode::Element(el) = &ir.roots[0] {
        let class_attr = el.attributes.iter().find(|a| a.name == "class");
        assert!(
            class_attr.is_some(),
            "Expected 'class' attribute to be extracted, found attributes: {:?}",
            el.attributes
        );
        let attr = class_attr.unwrap();
        match &attr.value {
            AttributeValue::Mixed(parts) => {
                println!("Unquoted mixed parts: {:?}", parts);
                assert!(parts
                    .iter()
                    .any(|p| matches!(p, AttributePart::Expression(0))));
            }
            other => {
                panic!("Expected Mixed attribute value, got {:?}", other);
            }
        }
    } else {
        panic!("Expected div Element");
    }
}

#[test]
fn stress_test_foster_parenting_in_tables() {
    // Foster-parented text nodes outside table cells:
    // In HTML5, text directly inside <table> is foster-parented BEFORE the table.
    let quasis = ["<table>TextBefore<tr><td>Cell</td></tr>TextAfter</table>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 0).expect("Template should parse");

    // In a spec-compliant HTML parser (html5ever), foster parenting moves text nodes
    // outside the table element into the parent (here the root list).
    println!("Foster parenting roots: {:?}", ir.roots);
    let table_has_direct_text = if let TemplateNode::Element(table) = &ir.roots[0] {
        table
            .children
            .iter()
            .any(|c| matches!(c, TemplateNode::Text(_)))
    } else {
        false
    };

    assert!(
        !table_has_direct_text,
        "Spec-compliant parser must foster-parent text nodes outside the <table> element"
    );
}

#[test]
fn stress_test_nested_tables_with_implicit_tbody() {
    let quasis = ["<table><tr><td><table><tr><td>Nested</td></tr></table></td></tr></table>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 0).expect("Template should parse");

    assert_eq!(ir.roots.len(), 1);
    if let TemplateNode::Element(outer_table) = &ir.roots[0] {
        assert_eq!(outer_table.tag_name, "table");
        let outer_tbody = outer_table
            .children
            .iter()
            .find_map(|c| match c {
                TemplateNode::Element(e) if e.tag_name == "tbody" => Some(e),
                _ => None,
            })
            .expect("Outer table must contain <tbody>");

        let outer_tr = outer_tbody
            .children
            .iter()
            .find_map(|c| match c {
                TemplateNode::Element(e) if e.tag_name == "tr" => Some(e),
                _ => None,
            })
            .expect("Outer tbody must contain <tr>");

        let outer_td = outer_tr
            .children
            .iter()
            .find_map(|c| match c {
                TemplateNode::Element(e) if e.tag_name == "td" => Some(e),
                _ => None,
            })
            .expect("Outer tr must contain <td>");

        let inner_table = outer_td
            .children
            .iter()
            .find_map(|c| match c {
                TemplateNode::Element(e) if e.tag_name == "table" => Some(e),
                _ => None,
            })
            .expect("Outer td must contain inner <table>");

        let inner_tbody = inner_table
            .children
            .iter()
            .find_map(|c| match c {
                TemplateNode::Element(e) if e.tag_name == "tbody" => Some(e),
                _ => None,
            })
            .expect("Inner table must contain <tbody>");

        assert!(
            inner_tbody
                .children
                .iter()
                .any(|c| matches!(c, TemplateNode::Element(e) if e.tag_name == "tr")),
            "Inner tbody must contain <tr>"
        );
    }
}

#[test]
fn stress_test_dozens_of_holes() {
    // 30 holes alternating between child and attributes
    let mut quasis = Vec::new();
    quasis.push("<div id=\"root\">".to_string());
    for i in 0..29 {
        if i % 2 == 0 {
            quasis.push(format!("</div><span data-idx=\"{}\" class=\"", i));
        } else {
            quasis.push(format!("\"><span>text {}</span>", i));
        }
    }
    quasis.push("</div>".to_string());

    let quasis_refs: Vec<&str> = quasis.iter().map(|s| s.as_str()).collect();
    let ir = TemplateParser::parse_lit_template(&quasis_refs, 30)
        .expect("Large template with 30 holes should parse");
    assert_eq!(ir.expression_count, 30);
}

#[test]
fn stress_test_svg_mathml_casing() {
    let quasis = [
        "<svg viewBox=\"0 0 100 100\" strokeWidth=\"1.5\" strokeLinecap=\"round\" clipPath=\"url(#p)\">\n  <clipPath id=\"p\"><rect /></clipPath>\n</svg>\n<math display=\"block\"><mrow><mi>x</mi><mo>=</mo><mn>1</mn></mrow></math>"
    ];
    let ir = TemplateParser::parse_lit_template(&quasis, 0).expect("SVG and MathML should parse");

    println!("SVG/MathML roots: {:?}", ir.roots);
    let svg_opt = ir.roots.iter().find_map(|c| match c {
        TemplateNode::Element(e) if e.tag_name == "svg" => Some(e),
        _ => None,
    });
    assert!(svg_opt.is_some(), "Expected SVG root element");
    let svg = svg_opt.unwrap();
    assert_eq!(svg.namespace, ElementNamespace::Svg);
    assert!(svg.attributes.iter().any(|a| a.name == "viewBox"));
    assert!(svg.attributes.iter().any(|a| a.name == "strokeWidth"));
    assert!(svg.attributes.iter().any(|a| a.name == "strokeLinecap"));
    assert!(svg.attributes.iter().any(|a| a.name == "clipPath"));
}

#[test]
fn stress_test_p_div_implied_end_tag() {
    // In HTML5 spec: <p> cannot contain block elements like <div>.
    // When <div> is encountered, the open <p> is implicitly closed.
    // The resulting DOM is sibling <p></p> followed by <div></div>.
    let quasis = ["<p><div>Inside Div</div></p>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 0).expect("Template should parse");

    println!("p-div roots: {:?}", ir.roots);
    // In spec-compliant HTML parser, roots should have 2 elements: p and div (or 3: p, div, p).
    // div should NOT be a child of p!
    if let TemplateNode::Element(p) = &ir.roots[0] {
        let has_child_div = p
            .children
            .iter()
            .any(|c| matches!(c, TemplateNode::Element(e) if e.tag_name == "div"));
        assert!(!has_child_div, "Spec-compliant parser must NOT nest <div> inside <p>; <p> is closed by block elements!");
    }
}

#[test]
fn stress_test_svg_element_tag_casing() {
    let quasis = ["<svg><clipPath id=\"cp\"><rect /></clipPath><linearGradient id=\"lg\" /></svg>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 0).expect("Template should parse");

    if let TemplateNode::Element(svg) = &ir.roots[0] {
        let clip_path = svg.children.iter().find_map(|c| match c {
            TemplateNode::Element(e) if e.tag_name == "clipPath" => Some(e),
            _ => None,
        });
        assert!(
            clip_path.is_some(),
            "SVG element tag 'clipPath' casing must be preserved/recovered, got: {:?}",
            svg.children
        );
    }
}

#[test]
fn stress_test_deep_mixin_chains() {
    let code = r#"
        import { LitElement, html } from 'lit';
        class DeepComponent extends A(B(C(D(LitElement)))) {
            render() {
                return html`<div>Deep</div>`;
            }
        }
    "#;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, code, SourceType::ts()).parse();
    assert!(
        parsed.diagnostics.is_empty(),
        "Parse errors: {:?}",
        parsed.diagnostics
    );

    let semantic = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic.semantic.into_scoping();
    let ctx = SymbolProofContext::scan(&parsed.program, &scoping, code);

    let class_stmt = parsed
        .program
        .body
        .iter()
        .find_map(|s| match s {
            oxc_ast::ast::Statement::ClassDeclaration(c) => Some(c),
            _ => None,
        })
        .expect("ClassDeclaration must exist");

    let proof = ctx.prove_heritage(class_stmt);
    println!("Heritage proof for deep mixin: {:?}", proof);
    match proof {
        HeritageProof::ProvenLitElement { depth, mixins } => {
            assert_eq!(depth, 4, "Depth should be 4 for A(B(C(D(LitElement))))");
            assert_eq!(mixins, vec!["A", "B", "C", "D"]);
        }
        other => panic!("Expected ProvenLitElement, got {:?}", other),
    }
}

#[test]
fn stress_test_interleaved_metadata_decorators() {
    let code = r#"
        import { LitElement, html } from 'lit';
        import { property } from 'lit/decorators.js';

        class MetadataComponent extends LitElement {
            render() { return html`<span>ok</span>`; }
        }
        __decorate([
            property({ type: String }),
            __metadata("design:type", String),
            __metadata("design:paramtypes", [])
        ], MetadataComponent.prototype, "title", void 0);
    "#;
    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, code, "metadata-component.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    let comp = &res.components[0];
    let title_prop = comp.properties.iter().find(|p| p.name == "title");
    assert!(
        title_prop.is_some(),
        "Expected 'title' property to be extracted despite __metadata"
    );
    let prop = title_prop.unwrap();
    assert_eq!(prop.property_type, PropertyType::String);
}

#[test]
fn stress_test_static_properties_has_changed() {
    let code = r#"
        import { LitElement, html } from 'lit';

        class HasChangedComponent extends LitElement {
            static properties = {
                count: {
                    type: Number,
                    hasChanged(newVal, oldVal) {
                        return newVal > oldVal;
                    }
                }
            };
            render() { return html`<div>${this.count}</div>`; }
        }
    "#;
    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, code, "has-changed-component.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    let comp = &res.components[0];
    let count_prop = comp.properties.iter().find(|p| p.name == "count");
    assert!(count_prop.is_some(), "Expected 'count' property");
    let prop = count_prop.unwrap();
    println!("count prop: {:?}", prop);
    assert!(
        prop.has_changed.is_some(),
        "hasChanged callback MUST be extracted, not None!"
    );
}

#[test]
fn stress_test_html_comments_in_template() {
    let quasis = [
        "<!-- header comment --><div><!-- nested comment --><span>text</span></div><!-- trailing comment with - hyphens -->",
    ];
    let ir = TemplateParser::parse_lit_template(&quasis, 0).expect("Comments should parse cleanly");
    assert_eq!(
        ir.roots.len(),
        3,
        "Expected 3 roots (comment, div, comment)"
    );
    assert_eq!(
        ir.roots[0],
        TemplateNode::Comment(" header comment ".to_string())
    );
    if let TemplateNode::Element(div) = &ir.roots[1] {
        assert_eq!(div.tag_name, "div");
        let has_span = div
            .children
            .iter()
            .any(|c| matches!(c, TemplateNode::Element(e) if e.tag_name == "span"));
        assert!(has_span, "div must contain span child");
    } else {
        panic!("Expected div element root");
    }

    let comment_only = ["<!-- standalone comment -->"];
    let ir_comment = TemplateParser::parse_lit_template(&comment_only, 0)
        .expect("Standalone comment should parse");
    assert_eq!(ir_comment.roots.len(), 1);
    assert_eq!(
        ir_comment.roots[0],
        TemplateNode::Comment(" standalone comment ".to_string())
    );
}

#[test]
fn stress_test_bare_less_than_in_text() {
    let quasis = ["<span>x < 5</span><div>a < b && b > c</div><p>< 10 items</p>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 0)
        .expect("Bare '<' should parse without hanging");
    assert_eq!(ir.roots.len(), 3, "Expected 3 roots: span, div, p");

    if let TemplateNode::Element(span) = &ir.roots[0] {
        assert_eq!(span.tag_name, "span");
        let text_child = span.children.iter().find_map(|c| match c {
            TemplateNode::Text(t) => Some(t.as_str()),
            _ => None,
        });
        assert_eq!(
            text_child,
            Some("x < 5"),
            "span must retain bare '<' in text child"
        );
    } else {
        panic!("Expected span element root");
    }

    if let TemplateNode::Element(p) = &ir.roots[2] {
        assert_eq!(p.tag_name, "p");
        let text_child = p.children.iter().find_map(|c| match c {
            TemplateNode::Text(t) => Some(t.as_str()),
            _ => None,
        });
        assert_eq!(
            text_child,
            Some("< 10 items"),
            "p must retain leading bare '<' in text child"
        );
    } else {
        panic!("Expected p element root");
    }
}

#[test]
fn stress_test_table_foster_parenting_child_preservation() {
    // 1. Foster-parented element with text retains its child text node
    let quasis = ["<table><span>Foster Me</span><tr><td>Cell</td></tr></table>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 0).expect("Template should parse");
    assert_eq!(ir.roots.len(), 2, "Must produce span and table as roots");
    if let TemplateNode::Element(span) = &ir.roots[0] {
        assert_eq!(span.tag_name, "span");
        assert_eq!(span.children.len(), 1, "Span must retain child text node");
        if let TemplateNode::Text(txt) = &span.children[0] {
            assert_eq!(txt, "Foster Me");
        } else {
            panic!("Expected Text child inside span");
        }
    } else {
        panic!("Expected first root to be span");
    }

    // 2. Nested elements inside foster-parented node
    let quasis = ["<table><span>Foster <b>Me</b> Now</span><tr><td>Cell</td></tr></table>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 0).expect("Template should parse");
    assert_eq!(ir.roots.len(), 2);
    if let TemplateNode::Element(span) = &ir.roots[0] {
        assert_eq!(
            span.children.len(),
            3,
            "Span must retain 3 children (text, b, text)"
        );
        if let TemplateNode::Element(b) = &span.children[1] {
            assert_eq!(b.tag_name, "b");
            assert_eq!(b.children.len(), 1);
            if let TemplateNode::Text(b_txt) = &b.children[0] {
                assert_eq!(b_txt, "Me");
            }
        } else {
            panic!("Expected middle child to be <b> element");
        }
    }

    // 3. Mixed text and foster-parented elements
    let quasis = ["<table>T1<span>T2</span>T3<tr><td>Cell</td></tr></table>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 0).expect("Template should parse");
    assert_eq!(ir.roots.len(), 4, "Must produce T1, span, T3, table");
    assert!(matches!(&ir.roots[0], TemplateNode::Text(t) if t == "T1"));
    if let TemplateNode::Element(span) = &ir.roots[1] {
        assert_eq!(span.children.len(), 1);
        assert!(matches!(&span.children[0], TemplateNode::Text(t) if t == "T2"));
    }
    assert!(matches!(&ir.roots[2], TemplateNode::Text(t) if t == "T3"));
    assert!(matches!(&ir.roots[3], TemplateNode::Element(t) if t.tag_name == "table"));

    // 4. Elements inside td are not foster-parented
    let quasis = ["<table><tr><td><span>In Td</span></td></tr></table>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 0).expect("Template should parse");
    assert_eq!(ir.roots.len(), 1, "Only table should be root");
    if let TemplateNode::Element(table) = &ir.roots[0] {
        assert_eq!(table.tag_name, "table");
    }
}

#[test]
fn stress_test_nested_directive_expressions_bailout() {
    // 1. Ternary expression with unsupported directive
    let ternary_code = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';

        class TernaryComp extends LitElement {
            render() {
                return html`<div>${this.loading ? until(this.promise, html`<span>Loading...</span>`) : 'Done'}</div>`;
            }
        }
    "#;
    let allocator = Allocator::default();
    let res = analyze_lit_module(&allocator, ternary_code, "ternary.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    match &res.components[0].tier {
        lit_analysis::classify::ClassificationTier::Bailout { reasons } => {
            assert!(
                reasons.iter().any(|r| matches!(r, lit_analysis::classify::BailoutReason::UnsupportedDirective { name, .. } if name == "until")),
                "Expected UnsupportedDirective(until), got: {:?}",
                reasons
            );
        }
        other => panic!(
            "Expected Bailout tier for ternary until(), got: {:?}",
            other
        ),
    }
    assert!(res
        .diagnostics
        .iter()
        .any(|d| d.code == lit_analysis::DiagnosticCode::LitBailUnsupportedDirective));

    // 2. Logical expression with unsupported directive
    let logical_code = r#"
        import { LitElement, html } from 'lit';
        import { asyncAppend } from 'lit/directives/async-append.js';

        class LogicalComp extends LitElement {
            render() {
                return html`<ul>${this.show && asyncAppend(this.stream)}</ul>`;
            }
        }
    "#;
    let res_logical = analyze_lit_module(&allocator, logical_code, "logical.ts").unwrap();
    assert_eq!(res_logical.components.len(), 1);
    match &res_logical.components[0].tier {
        lit_analysis::classify::ClassificationTier::Bailout { reasons } => {
            assert!(reasons.iter().any(|r| matches!(r, lit_analysis::classify::BailoutReason::UnsupportedDirective { name, .. } if name == "asyncAppend")));
        }
        other => panic!(
            "Expected Bailout tier for logical asyncAppend(), got: {:?}",
            other
        ),
    }

    // 3. Array expression with multiple unsupported directives
    let array_code = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';

        class ArrayComp extends LitElement {
            render() {
                return html`<div>${[until(this.p1), until(this.p2)]}</div>`;
            }
        }
    "#;
    let res_array = analyze_lit_module(&allocator, array_code, "array.ts").unwrap();
    assert_eq!(res_array.components.len(), 1);
    assert!(matches!(
        &res_array.components[0].tier,
        lit_analysis::classify::ClassificationTier::Bailout { .. }
    ));

    // 4. Aliased directive in deeply nested expression
    let deep_code = r#"
        import { LitElement, html } from 'lit';
        import { until as u } from 'lit/directives/until.js';

        class DeepComp extends LitElement {
            render() {
                return html`<div>${this.a ? (this.b ? [u(this.p)] : null) : undefined}</div>`;
            }
        }
    "#;
    let res_deep = analyze_lit_module(&allocator, deep_code, "deep.ts").unwrap();
    assert_eq!(res_deep.components.len(), 1);
    assert!(matches!(
        &res_deep.components[0].tier,
        lit_analysis::classify::ClassificationTier::Bailout { .. }
    ));
}

#[test]
fn stress_test_escaping_this_statements_bailout() {
    let allocator = Allocator::default();

    // 1. Escaping this in return statement
    let return_code = r#"
        import { LitElement, html } from 'lit';
        class ReturnComp extends LitElement {
            setup() {
                return register(this);
            }
            render() { return html`<div>ok</div>`; }
        }
    "#;
    let res_ret = analyze_lit_module(&allocator, return_code, "return.ts").unwrap();
    assert_eq!(res_ret.components.len(), 1);
    assert!(matches!(
        &res_ret.components[0].tier,
        lit_analysis::classify::ClassificationTier::Bailout { .. }
    ));
    assert!(res_ret
        .diagnostics
        .iter()
        .any(|d| d.code == lit_analysis::DiagnosticCode::LitBailEscapingThis));

    // 2. Escaping this in variable declaration
    let var_code = r#"
        import { LitElement, html } from 'lit';
        class VarComp extends LitElement {
            setup() {
                const token = register(this);
            }
            render() { return html`<div>ok</div>`; }
        }
    "#;
    let res_var = analyze_lit_module(&allocator, var_code, "var.ts").unwrap();
    assert_eq!(res_var.components.len(), 1);
    assert!(matches!(
        &res_var.components[0].tier,
        lit_analysis::classify::ClassificationTier::Bailout { .. }
    ));
    assert!(res_var
        .diagnostics
        .iter()
        .any(|d| d.code == lit_analysis::DiagnosticCode::LitBailEscapingThis));

    // 3. Escaping this in ternary inside method
    let ternary_this_code = r#"
        import { LitElement, html } from 'lit';
        class TernaryThisComp extends LitElement {
            setup() {
                cond ? register(this) : null;
            }
            render() { return html`<div>ok</div>`; }
        }
    "#;
    let res_ternary = analyze_lit_module(&allocator, ternary_this_code, "ternary_this.ts").unwrap();
    assert_eq!(res_ternary.components.len(), 1);
    assert!(matches!(
        &res_ternary.components[0].tier,
        lit_analysis::classify::ClassificationTier::Bailout { .. }
    ));
}
