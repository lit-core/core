use lit_analysis::template_ir::{
    AttributePrefix, AttributeValue, ElementNamespace, TemplateNode, TemplateParser,
};

#[test]
fn test_template_ir_parsing_and_implied_tbody() {
    let quasis = ["<table><tr><td>Cell</td></tr></table>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 0).unwrap();

    assert_eq!(ir.roots.len(), 1);
    if let TemplateNode::Element(table) = &ir.roots[0] {
        assert_eq!(table.tag_name, "table");
        assert_eq!(table.children.len(), 1);
        if let TemplateNode::Element(tbody) = &table.children[0] {
            assert_eq!(
                tbody.tag_name, "tbody",
                "Spec-compliant parser must inject <tbody>"
            );
            assert_eq!(tbody.children.len(), 1);
            if let TemplateNode::Element(tr) = &tbody.children[0] {
                assert_eq!(tr.tag_name, "tr");
            } else {
                panic!("Expected <tr> inside <tbody>");
            }
        } else {
            panic!("Expected <tbody> inside <table>");
        }
    } else {
        panic!("Expected <table> root");
    }
}

#[test]
fn test_quasi_casing_and_prefix_recovery() {
    let quasis = [
        "<my-elem .itemCount=",
        " @itemSelected=",
        " ?hasBorder=",
        ">\n<svg viewBox=\"0 0 10 10\" strokeWidth=\"2\">\n</svg>\n</my-elem>",
    ];
    let ir = TemplateParser::parse_lit_template(&quasis, 3).unwrap();

    assert_eq!(ir.roots.len(), 1);
    if let TemplateNode::Element(el) = &ir.roots[0] {
        assert_eq!(el.tag_name, "my-elem");

        let item_count = el
            .attributes
            .iter()
            .find(|a| a.name == "itemCount")
            .unwrap();
        assert_eq!(item_count.prefix, AttributePrefix::Property);
        assert_eq!(item_count.value, AttributeValue::Dynamic(0));

        let item_selected = el
            .attributes
            .iter()
            .find(|a| a.name == "itemSelected")
            .unwrap();
        assert_eq!(item_selected.prefix, AttributePrefix::Event);
        assert_eq!(item_selected.value, AttributeValue::Dynamic(1));

        let has_border = el
            .attributes
            .iter()
            .find(|a| a.name == "hasBorder")
            .unwrap();
        assert_eq!(has_border.prefix, AttributePrefix::Boolean);
        assert_eq!(has_border.value, AttributeValue::Dynamic(2));

        // SVG element inside
        let svg = el
            .children
            .iter()
            .find_map(|c| match c {
                TemplateNode::Element(e) if e.tag_name == "svg" => Some(e),
                _ => None,
            })
            .unwrap();

        assert_eq!(svg.namespace, ElementNamespace::Svg);
        assert!(
            svg.attributes.iter().any(|a| a.name == "viewBox"),
            "viewBox casing must be recovered"
        );
        assert!(
            svg.attributes.iter().any(|a| a.name == "strokeWidth"),
            "strokeWidth casing must be recovered"
        );
    } else {
        panic!("Expected Element root");
    }
}

#[test]
fn test_slot_inspection_detection() {
    let quasis = ["<div><slot @slotchange=", "></slot></div>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 1).unwrap();
    assert!(ir.has_slots);

    if let TemplateNode::Element(div) = &ir.roots[0] {
        let slot = div
            .children
            .iter()
            .find_map(|c| match c {
                TemplateNode::Slot(s) => Some(s),
                _ => None,
            })
            .unwrap();
        assert!(
            slot.inspected,
            "Slot with @slotchange must be marked inspected"
        );
    }
}

#[test]
fn test_html_comments_preserved_in_template_ir() {
    let quasis = ["<!-- header comment --><div><!-- child comment -->text</div><!-- footer -->"];
    let ir = TemplateParser::parse_lit_template(&quasis, 0)
        .expect("Template with comments should parse");

    assert_eq!(ir.roots.len(), 3);
    assert_eq!(
        ir.roots[0],
        TemplateNode::Comment(" header comment ".to_string())
    );
    assert_eq!(ir.roots[2], TemplateNode::Comment(" footer ".to_string()));

    if let TemplateNode::Element(div) = &ir.roots[1] {
        assert_eq!(div.tag_name, "div");
        assert_eq!(div.children.len(), 2);
        assert_eq!(
            div.children[0],
            TemplateNode::Comment(" child comment ".to_string())
        );
        assert_eq!(div.children[1], TemplateNode::Text("text".to_string()));
    } else {
        panic!("Expected div element root");
    }
}

#[test]
fn test_bare_less_than_and_comparisons_in_text() {
    let quasis = ["<span>x < 5 && y > 10 && 1 << 2</span>"];
    let ir =
        TemplateParser::parse_lit_template(&quasis, 0).expect("Template with bare < should parse");

    assert_eq!(ir.roots.len(), 1);
    if let TemplateNode::Element(span) = &ir.roots[0] {
        assert_eq!(span.tag_name, "span");
        assert_eq!(span.children.len(), 1);
        assert_eq!(
            span.children[0],
            TemplateNode::Text("x < 5 && y > 10 && 1 << 2".to_string())
        );
    } else {
        panic!("Expected span element root");
    }
}

#[test]
fn test_bare_less_than_with_expression_hole() {
    let quasis = ["<span>x < ", "</span>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 1)
        .expect("Template with bare < before hole should parse");

    assert_eq!(ir.roots.len(), 1);
    if let TemplateNode::Element(span) = &ir.roots[0] {
        assert_eq!(span.tag_name, "span");
        assert_eq!(span.children.len(), 2);
        assert_eq!(span.children[0], TemplateNode::Text("x < ".to_string()));
        assert_eq!(span.children[1], TemplateNode::Expression(0));
    } else {
        panic!("Expected span element root");
    }
}
