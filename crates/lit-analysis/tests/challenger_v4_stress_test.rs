use lit_analysis::template_ir::{
    AttributePart, AttributePrefix, AttributeValue, TemplateNode, TemplateParser,
};

#[test]
fn stress_test_vector1_html_comments_comprehensive() {
    // 1. Comments without holes
    let quasis = ["<!-- header comment --><div><!-- child comment -->text</div><!-- footer -->"];
    let ir = TemplateParser::parse_lit_template(&quasis, 0).expect("Comments should parse");
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
        panic!("Expected div");
    }

    // 2. Comments with holes inside
    let quasis_holes = ["<!-- before ", " middle ", " after -->"];
    let ir_holes = TemplateParser::parse_lit_template(&quasis_holes, 2)
        .expect("Comments with holes should parse");
    assert_eq!(ir_holes.roots.len(), 1);
    match &ir_holes.roots[0] {
        TemplateNode::Comment(content) => {
            assert!(
                content.contains("__lit_hole_0__"),
                "Expected hole 0 marker in comment, got: {}",
                content
            );
            assert!(
                content.contains("__lit_hole_1__"),
                "Expected hole 1 marker in comment, got: {}",
                content
            );
        }
        other => panic!("Expected Comment node, got: {:?}", other),
    }

    // 3. Consecutive comments
    let quasis_consec = ["<!-- comment 1 --><!-- comment 2 --><!-- comment 3 -->"];
    let ir_consec = TemplateParser::parse_lit_template(&quasis_consec, 0)
        .expect("Consecutive comments should parse");
    assert_eq!(ir_consec.roots.len(), 3);
    assert_eq!(
        ir_consec.roots[0],
        TemplateNode::Comment(" comment 1 ".to_string())
    );
    assert_eq!(
        ir_consec.roots[1],
        TemplateNode::Comment(" comment 2 ".to_string())
    );
    assert_eq!(
        ir_consec.roots[2],
        TemplateNode::Comment(" comment 3 ".to_string())
    );

    // 4. Empty comments and minimal comments
    let quasis_empty = ["<!----><div></div><!-- -->"];
    let ir_empty =
        TemplateParser::parse_lit_template(&quasis_empty, 0).expect("Empty comments should parse");
    assert_eq!(ir_empty.roots.len(), 3);
    assert_eq!(ir_empty.roots[0], TemplateNode::Comment("".to_string()));
    assert_eq!(ir_empty.roots[2], TemplateNode::Comment(" ".to_string()));

    // 5. Unclosed comments (must terminate gracefully without infinite loops)
    let quasis_unclosed1 = ["<!-- unclosed comment"];
    let ir_unclosed1 = TemplateParser::parse_lit_template(&quasis_unclosed1, 0)
        .expect("Unclosed comment must terminate");
    assert_eq!(ir_unclosed1.roots.len(), 1);
    assert!(matches!(&ir_unclosed1.roots[0], TemplateNode::Comment(_)));

    let quasis_unclosed2 = ["<!--"];
    let ir_unclosed2 = TemplateParser::parse_lit_template(&quasis_unclosed2, 0)
        .expect("Minimal unclosed comment must terminate");
    assert_eq!(ir_unclosed2.roots.len(), 1);

    let quasis_unclosed3 = ["<!-- -"];
    let ir_unclosed3 = TemplateParser::parse_lit_template(&quasis_unclosed3, 0)
        .expect("Dash unclosed comment must terminate");
    assert_eq!(ir_unclosed3.roots.len(), 1);

    let quasis_unclosed4 = ["<!-- --"];
    let ir_unclosed4 = TemplateParser::parse_lit_template(&quasis_unclosed4, 0)
        .expect("Double dash unclosed comment must terminate");
    assert_eq!(ir_unclosed4.roots.len(), 1);

    // 6. Comments containing markup and special characters
    let quasis_special =
        ["<!-- <script>alert('xss')</script> <div> &amp; &lt; --><span>safe</span>"];
    let ir_special = TemplateParser::parse_lit_template(&quasis_special, 0)
        .expect("Comment with markup should parse");
    assert_eq!(ir_special.roots.len(), 2);
    assert!(matches!(&ir_special.roots[0], TemplateNode::Comment(_)));
    if let TemplateNode::Element(span) = &ir_special.roots[1] {
        assert_eq!(span.tag_name, "span");
    } else {
        panic!("Expected span element");
    }
}

#[test]
fn stress_test_vector2_bare_less_than_in_text() {
    // 1. Math and comparison expressions in text
    let cases = [
        ("<span>x < 5</span>", "x < 5"),
        ("<span>a < b && c > d</span>", "a < b && c > d"),
        ("<span>1 << 2</span>", "1 << 2"),
        ("<span>a <=> b</span>", "a <=> b"),
        ("<span><<<>>></span>", "<<<>>>"),
        ("<span><<<</span>", "<<<"),
        ("<span>></span>", ">"),
        ("<span>>>=</span>", ">>="),
        ("<span> < </span>", " < "),
        ("<span>x < 10 && y <= 20</span>", "x < 10 && y <= 20"),
        ("<span>val <.05</span>", "val <.05"),
        ("<span>items <, none</span>", "items <, none"),
    ];

    for (html, expected_text) in cases {
        let ir = TemplateParser::parse_lit_template(&[html], 0)
            .unwrap_or_else(|e| panic!("Failed to parse '{}': {}", html, e));
        assert_eq!(ir.roots.len(), 1, "Expected 1 root for '{}'", html);
        if let TemplateNode::Element(span) = &ir.roots[0] {
            assert_eq!(span.tag_name, "span");
            assert_eq!(
                span.children.len(),
                1,
                "Expected 1 text child for '{}'",
                html
            );
            assert_eq!(
                span.children[0],
                TemplateNode::Text(expected_text.to_string()),
                "Text mismatch for '{}'",
                html
            );
        } else {
            panic!("Expected span element for '{}'", html);
        }
    }

    // 2. Bare < followed by dynamic holes
    let quasis_hole = ["<span>x < ", "</span>"];
    let ir_hole = TemplateParser::parse_lit_template(&quasis_hole, 1)
        .expect("Bare < before hole should parse");
    if let TemplateNode::Element(span) = &ir_hole.roots[0] {
        assert_eq!(span.children.len(), 2);
        assert_eq!(span.children[0], TemplateNode::Text("x < ".to_string()));
        assert_eq!(span.children[1], TemplateNode::Expression(0));
    } else {
        panic!("Expected span element");
    }

    // 3. Comparison with holes on both sides
    let quasis_both = ["<span>", " < ", "</span>"];
    let ir_both = TemplateParser::parse_lit_template(&quasis_both, 2)
        .expect("Comparison with holes should parse");
    if let TemplateNode::Element(span) = &ir_both.roots[0] {
        assert_eq!(span.children.len(), 3);
        assert_eq!(span.children[0], TemplateNode::Expression(0));
        assert_eq!(span.children[1], TemplateNode::Text(" < ".to_string()));
        assert_eq!(span.children[2], TemplateNode::Expression(1));
    } else {
        panic!("Expected span element");
    }

    // 4. Shift operators with holes: <<${a}>>
    let quasis_shift = ["<span><<", ">></span>"];
    let ir_shift =
        TemplateParser::parse_lit_template(&quasis_shift, 1).expect("Shift with hole should parse");
    if let TemplateNode::Element(span) = &ir_shift.roots[0] {
        assert_eq!(span.children.len(), 3);
        assert_eq!(span.children[0], TemplateNode::Text("<<".to_string()));
        assert_eq!(span.children[1], TemplateNode::Expression(0));
        assert_eq!(span.children[2], TemplateNode::Text(">>".to_string()));
    } else {
        panic!("Expected span element");
    }

    // 5. Bare < at end of input or isolated
    let ir_bare = TemplateParser::parse_lit_template(&["<"], 0).expect("Bare '<' should parse");
    assert_eq!(ir_bare.roots.len(), 1);
    assert_eq!(ir_bare.roots[0], TemplateNode::Text("<".to_string()));

    let ir_trailing = TemplateParser::parse_lit_template(&["<div>trailing <"], 0)
        .expect("Trailing < should parse");
    assert_eq!(ir_trailing.roots.len(), 1);
    if let TemplateNode::Element(div) = &ir_trailing.roots[0] {
        assert_eq!(div.children.len(), 1);
        assert_eq!(
            div.children[0],
            TemplateNode::Text("trailing <".to_string())
        );
    }
}

#[test]
fn stress_test_vector3_table_foster_parenting_deep_child_trees() {
    // 1. Deep nested tree inside foster-parented container:
    // <table><span>Foster <b>Bold <i>Italic <u>Underline</u></i></b> Suffix</span><tr><td>Cell</td></tr></table>
    let quasis = [
        "<table><span>Foster <b>Bold <i>Italic <u>Underline</u></i></b> Suffix</span><tr><td>Cell</td></tr></table>",
    ];
    let ir = TemplateParser::parse_lit_template(&quasis, 0)
        .expect("Deep tree in foster-parented container should parse");

    // Roots must be [span, table]
    assert_eq!(
        ir.roots.len(),
        2,
        "Expected 2 roots (foster-parented span + table)"
    );

    // Verify foster-parented span and its deep child tree
    if let TemplateNode::Element(span) = &ir.roots[0] {
        assert_eq!(span.tag_name, "span");
        assert_eq!(
            span.children.len(),
            3,
            "Expected 3 children for span: Text, Element(b), Text"
        );
        assert_eq!(span.children[0], TemplateNode::Text("Foster ".to_string()));
        assert_eq!(span.children[2], TemplateNode::Text(" Suffix".to_string()));

        if let TemplateNode::Element(b) = &span.children[1] {
            assert_eq!(b.tag_name, "b");
            assert_eq!(b.children.len(), 2, "Expected Text and Element(i)");
            assert_eq!(b.children[0], TemplateNode::Text("Bold ".to_string()));

            if let TemplateNode::Element(i) = &b.children[1] {
                assert_eq!(i.tag_name, "i");
                assert_eq!(i.children.len(), 2, "Expected Text and Element(u)");
                assert_eq!(i.children[0], TemplateNode::Text("Italic ".to_string()));

                if let TemplateNode::Element(u) = &i.children[1] {
                    assert_eq!(u.tag_name, "u");
                    assert_eq!(u.children.len(), 1);
                    assert_eq!(u.children[0], TemplateNode::Text("Underline".to_string()));
                } else {
                    panic!("Expected <u> inside <i>");
                }
            } else {
                panic!("Expected <i> inside <b>");
            }
        } else {
            panic!("Expected <b> inside <span>");
        }
    } else {
        panic!("Expected foster-parented <span> as first root");
    }

    // Verify table structure with implied tbody
    if let TemplateNode::Element(table) = &ir.roots[1] {
        assert_eq!(table.tag_name, "table");
        assert_eq!(table.children.len(), 1);
        if let TemplateNode::Element(tbody) = &table.children[0] {
            assert_eq!(tbody.tag_name, "tbody");
            assert_eq!(tbody.children.len(), 1);
            if let TemplateNode::Element(tr) = &tbody.children[0] {
                assert_eq!(tr.tag_name, "tr");
                assert_eq!(tr.children.len(), 1);
                if let TemplateNode::Element(td) = &tr.children[0] {
                    assert_eq!(td.tag_name, "td");
                    assert_eq!(td.children.len(), 1);
                    assert_eq!(td.children[0], TemplateNode::Text("Cell".to_string()));
                } else {
                    panic!("Expected <td>");
                }
            } else {
                panic!("Expected <tr>");
            }
        } else {
            panic!("Expected <tbody>");
        }
    } else {
        panic!("Expected <table> as second root");
    }

    // 2. Foster-parented tree with expression holes inside
    let quasis_holes = [
        "<table><span>Foster ",
        " <b>Bold ",
        "</b></span><tr><td>Cell ",
        "</td></tr></table>",
    ];
    let ir_holes = TemplateParser::parse_lit_template(&quasis_holes, 3)
        .expect("Foster tree with holes should parse");
    assert_eq!(ir_holes.roots.len(), 2);
    if let TemplateNode::Element(span) = &ir_holes.roots[0] {
        // Children: [Text("Foster "), Expression(0), Text(" "), Element(b)]
        assert_eq!(span.children.len(), 4);
        assert_eq!(span.children[0], TemplateNode::Text("Foster ".to_string()));
        assert_eq!(span.children[1], TemplateNode::Expression(0));
        assert_eq!(span.children[2], TemplateNode::Text(" ".to_string()));
        if let TemplateNode::Element(b) = &span.children[3] {
            assert_eq!(b.children.len(), 2);
            assert_eq!(b.children[0], TemplateNode::Text("Bold ".to_string()));
            assert_eq!(b.children[1], TemplateNode::Expression(1));
        }
    }
    if let TemplateNode::Element(table) = &ir_holes.roots[1] {
        if let TemplateNode::Element(tbody) = &table.children[0] {
            if let TemplateNode::Element(tr) = &tbody.children[0] {
                if let TemplateNode::Element(td) = &tr.children[0] {
                    assert_eq!(td.children.len(), 2);
                    assert_eq!(td.children[0], TemplateNode::Text("Cell ".to_string()));
                    assert_eq!(td.children[1], TemplateNode::Expression(2));
                }
            }
        }
    }

    // 3. Nested tables with foster parenting at both levels
    let quasis_nested = [
        "<table><span>Outer Foster</span><tr><td><table><span>Inner Foster</span><tr><td>Inner Cell</td></tr></table></td></tr></table>",
    ];
    let ir_nested = TemplateParser::parse_lit_template(&quasis_nested, 0)
        .expect("Nested tables with foster parenting should parse");
    assert_eq!(ir_nested.roots.len(), 2); // [Outer Foster span, outer table]
    assert_eq!(
        if let TemplateNode::Element(e) = &ir_nested.roots[0] {
            &e.tag_name
        } else {
            ""
        },
        "span"
    );
    if let TemplateNode::Element(outer_table) = &ir_nested.roots[1] {
        assert_eq!(outer_table.tag_name, "table");
        // Drill down to inner td
        let outer_tbody = match &outer_table.children[0] {
            TemplateNode::Element(e) => e,
            _ => panic!("Expected outer tbody"),
        };
        let outer_tr = match &outer_tbody.children[0] {
            TemplateNode::Element(e) => e,
            _ => panic!("Expected outer tr"),
        };
        let outer_td = match &outer_tr.children[0] {
            TemplateNode::Element(e) => e,
            _ => panic!("Expected outer td"),
        };
        // Inside outer_td, inner foster span should be before inner table!
        assert_eq!(
            outer_td.children.len(),
            2,
            "Expected inner foster span + inner table inside outer td"
        );
        if let TemplateNode::Element(inner_span) = &outer_td.children[0] {
            assert_eq!(inner_span.tag_name, "span");
            assert_eq!(
                inner_span.children[0],
                TemplateNode::Text("Inner Foster".to_string())
            );
        } else {
            panic!("Expected inner foster span");
        }
        if let TemplateNode::Element(inner_table) = &outer_td.children[1] {
            assert_eq!(inner_table.tag_name, "table");
        } else {
            panic!("Expected inner table");
        }
    }
}

#[test]
fn stress_test_vector4_unclosed_foster_tags() {
    // 1. Unclosed foster tag before <tr>
    // <table><span>Foster text<tr><td>Cell</td></tr></table>
    let quasis_tr = ["<table><span>Foster text<tr><td>Cell</td></tr></table>"];
    let ir_tr = TemplateParser::parse_lit_template(&quasis_tr, 0)
        .expect("Unclosed span before <tr> should parse");
    assert_eq!(ir_tr.roots.len(), 2, "Expected [span, table]");
    if let TemplateNode::Element(span) = &ir_tr.roots[0] {
        assert_eq!(span.tag_name, "span");
        assert_eq!(span.children.len(), 1);
        assert_eq!(
            span.children[0],
            TemplateNode::Text("Foster text".to_string())
        );
    }
    if let TemplateNode::Element(table) = &ir_tr.roots[1] {
        assert_eq!(table.tag_name, "table");
        assert_eq!(table.children.len(), 1);
        if let TemplateNode::Element(tbody) = &table.children[0] {
            assert_eq!(tbody.tag_name, "tbody");
            assert_eq!(tbody.children.len(), 1);
            if let TemplateNode::Element(tr) = &tbody.children[0] {
                assert_eq!(tr.tag_name, "tr");
                assert_eq!(tr.children.len(), 1);
                if let TemplateNode::Element(td) = &tr.children[0] {
                    assert_eq!(td.tag_name, "td");
                    assert_eq!(td.children.len(), 1);
                    assert_eq!(td.children[0], TemplateNode::Text("Cell".to_string()));
                }
            }
        }
    }

    // 2. Deep unclosed foster tags before <tr>
    // <table><div><span><b><i>Deep Unclosed<tr><td>Cell</td></tr></table>
    let quasis_deep = ["<table><div><span><b><i>Deep Unclosed<tr><td>Cell</td></tr></table>"];
    let ir_deep = TemplateParser::parse_lit_template(&quasis_deep, 0)
        .expect("Deep unclosed foster tags should parse");
    assert_eq!(ir_deep.roots.len(), 2);
    if let TemplateNode::Element(div) = &ir_deep.roots[0] {
        assert_eq!(div.tag_name, "div");
        assert_eq!(div.children.len(), 1);
        if let TemplateNode::Element(span) = &div.children[0] {
            assert_eq!(span.tag_name, "span");
            if let TemplateNode::Element(b) = &span.children[0] {
                assert_eq!(b.tag_name, "b");
                if let TemplateNode::Element(i) = &b.children[0] {
                    assert_eq!(i.tag_name, "i");
                    assert_eq!(
                        i.children[0],
                        TemplateNode::Text("Deep Unclosed".to_string())
                    );
                }
            }
        }
    }

    // 3. Unclosed foster tag before <tbody>
    let quasis_tbody =
        ["<table><span>Unclosed before tbody<tbody><tr><td>Cell</td></tr></tbody></table>"];
    let ir_tbody = TemplateParser::parse_lit_template(&quasis_tbody, 0)
        .expect("Unclosed span before <tbody> should parse");
    assert_eq!(ir_tbody.roots.len(), 2);
    if let TemplateNode::Element(span) = &ir_tbody.roots[0] {
        assert_eq!(span.tag_name, "span");
        assert_eq!(
            span.children[0],
            TemplateNode::Text("Unclosed before tbody".to_string())
        );
    }
    if let TemplateNode::Element(table) = &ir_tbody.roots[1] {
        assert_eq!(table.children.len(), 1);
        if let TemplateNode::Element(tbody) = &table.children[0] {
            assert_eq!(tbody.tag_name, "tbody");
        }
    }

    // 4. Unclosed foster tag before <td> (table -> td triggers ensure_tr_for_cell)
    let quasis_td = ["<table><span>Unclosed before td<td>Cell</td></table>"];
    let ir_td = TemplateParser::parse_lit_template(&quasis_td, 0)
        .expect("Unclosed span before <td> should parse");
    assert_eq!(ir_td.roots.len(), 2);
    if let TemplateNode::Element(table) = &ir_td.roots[1] {
        if let TemplateNode::Element(tbody) = &table.children[0] {
            if let TemplateNode::Element(tr) = &tbody.children[0] {
                if let TemplateNode::Element(td) = &tr.children[0] {
                    assert_eq!(td.tag_name, "td");
                    assert_eq!(td.children[0], TemplateNode::Text("Cell".to_string()));
                }
            }
        }
    }

    // 5. Unclosed foster tag before <thead>
    let quasis_thead =
        ["<table><span>Unclosed before thead<thead><tr><th>Head</th></tr></thead></table>"];
    let ir_thead = TemplateParser::parse_lit_template(&quasis_thead, 0)
        .expect("Unclosed span before <thead> should parse");
    assert_eq!(ir_thead.roots.len(), 2);
    if let TemplateNode::Element(table) = &ir_thead.roots[1] {
        if let TemplateNode::Element(thead) = &table.children[0] {
            assert_eq!(thead.tag_name, "thead");
        }
    }
}

#[test]
fn stress_test_vector5_hole_marker_scaling() {
    // 1. Scaling to 100 expression holes in a flat element
    let mut quasis = Vec::new();
    quasis.push("<div>".to_string());
    for i in 0..100 {
        quasis.push(format!(" <!-- sep {} --> ", i));
    }
    let quasis_refs: Vec<&str> = quasis.iter().map(|s| s.as_str()).collect();
    let ir = TemplateParser::parse_lit_template(&quasis_refs, 100)
        .expect("100 expression holes should parse without error");

    assert_eq!(ir.roots.len(), 1);
    if let TemplateNode::Element(div) = &ir.roots[0] {
        assert_eq!(div.tag_name, "div");
        // Verify all 100 expressions are present in order
        let expressions: Vec<usize> = div
            .children
            .iter()
            .filter_map(|c| match c {
                TemplateNode::Expression(idx) => Some(*idx),
                _ => None,
            })
            .collect();
        assert_eq!(expressions.len(), 100);
        for (expected_idx, actual_idx) in expressions.into_iter().enumerate() {
            assert_eq!(expected_idx, actual_idx);
        }
    } else {
        panic!("Expected div element");
    }

    // 2. Scaling to 50 distinct dynamic attributes
    let mut attr_quasis = Vec::new();
    attr_quasis.push("<div .prop0=".to_string());
    for i in 1..50 {
        attr_quasis.push(format!(" .prop{}=", i));
    }
    attr_quasis.push(">content</div>".to_string());
    assert_eq!(attr_quasis.len(), 51);
    let attr_refs: Vec<&str> = attr_quasis.iter().map(|s| s.as_str()).collect();
    let ir_attrs = TemplateParser::parse_lit_template(&attr_refs, 50)
        .expect("50 dynamic attributes should parse");

    if let TemplateNode::Element(div) = &ir_attrs.roots[0] {
        assert_eq!(div.attributes.len(), 50);
        for (i, attr) in div.attributes.iter().enumerate() {
            assert_eq!(attr.name, format!("prop{}", i));
            assert_eq!(attr.prefix, AttributePrefix::Property);
            assert_eq!(attr.value, AttributeValue::Dynamic(i));
        }
    }

    // 3. Multi-hole composite attribute scaling (10 holes in single style attribute)
    let style_quasis = [
        "<div style=\"a: ",
        "; b: ",
        "; c: ",
        "; d: ",
        "; e: ",
        "; f: ",
        "; g: ",
        "; h: ",
        "; i: ",
        "; j: ",
        "\"></div>",
    ];
    let ir_style = TemplateParser::parse_lit_template(&style_quasis, 10)
        .expect("10 holes in single style attribute should parse");
    if let TemplateNode::Element(div) = &ir_style.roots[0] {
        let style_attr = div.attributes.iter().find(|a| a.name == "style").unwrap();
        match &style_attr.value {
            AttributeValue::Mixed(parts) => {
                let expr_indices: Vec<usize> = parts
                    .iter()
                    .filter_map(|p| match p {
                        AttributePart::Expression(idx) => Some(*idx),
                        _ => None,
                    })
                    .collect();
                assert_eq!(expr_indices, (0..10).collect::<Vec<_>>());
            }
            other => panic!("Expected Mixed attribute value, got: {:?}", other),
        }
    }

    // 4. Large hole indices (> 150)
    let mut large_quasis = Vec::new();
    large_quasis.push("<div id=\"".to_string());
    for i in 0..150 {
        large_quasis.push(format!("-part{}-", i));
    }
    large_quasis.push("\"></div>".to_string());
    let large_refs: Vec<&str> = large_quasis.iter().map(|s| s.as_str()).collect();
    let ir_large = TemplateParser::parse_lit_template(&large_refs, 150)
        .expect("Large hole index should parse");
    if let TemplateNode::Element(div) = &ir_large.roots[0] {
        let id_attr = div.attributes.iter().find(|a| a.name == "id").unwrap();
        match &id_attr.value {
            AttributeValue::Mixed(parts) => {
                let expr_count = parts
                    .iter()
                    .filter(|p| matches!(p, AttributePart::Expression(_)))
                    .count();
                assert_eq!(expr_count, 150);
            }
            other => panic!("Expected Mixed, got: {:?}", other),
        }
    }
}

#[test]
fn stress_test_foster_parenting_multiple_order_and_after_rows() {
    // 1. Multiple foster parented elements before table rows: preserve their relative order
    let quasis = [
        "<table><span>One</span><span>Two</span><span>Three</span><tr><td>Cell</td></tr></table>",
    ];
    let ir =
        TemplateParser::parse_lit_template(&quasis, 0).expect("Multiple foster tags should parse");
    assert_eq!(ir.roots.len(), 4, "Expected [One, Two, Three, Table]");
    let tag_names: Vec<String> = ir
        .roots
        .iter()
        .filter_map(|r| match r {
            TemplateNode::Element(e) => Some(e.tag_name.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(tag_names, vec!["span", "span", "span", "table"]);

    // Verify text contents of each foster span
    for (i, expected_word) in ["One", "Two", "Three"].iter().enumerate() {
        if let TemplateNode::Element(span) = &ir.roots[i] {
            assert_eq!(
                span.children[0],
                TemplateNode::Text((*expected_word).to_string())
            );
        }
    }

    // 2. Foster parented element AFTER table rows
    let quasis_after = ["<table><tr><td>Row</td></tr><span>After</span></table>"];
    let ir_after = TemplateParser::parse_lit_template(&quasis_after, 0)
        .expect("Foster tag after row should parse");
    // In HTML5, foster parented element is moved before table
    assert_eq!(ir_after.roots.len(), 2, "Expected [span, table]");
    if let TemplateNode::Element(span) = &ir_after.roots[0] {
        assert_eq!(span.tag_name, "span");
        assert_eq!(span.children[0], TemplateNode::Text("After".to_string()));
    }
    if let TemplateNode::Element(table) = &ir_after.roots[1] {
        assert_eq!(table.tag_name, "table");
    }
}

#[test]
fn stress_test_rawtext_elements_with_comparisons_and_holes() {
    // Rawtext tag <script> with comparisons < and && that should not start tags
    let quasis = ["<script>if (a < 5 && b > 10) { const x = '<span>not a tag</span>'; }</script>"];
    let ir = TemplateParser::parse_lit_template(&quasis, 0).expect("Rawtext script should parse");
    assert_eq!(ir.roots.len(), 1);
    if let TemplateNode::Element(script) = &ir.roots[0] {
        assert_eq!(script.tag_name, "script");
        assert_eq!(script.children.len(), 1);
        if let TemplateNode::Text(raw) = &script.children[0] {
            assert!(raw.contains("a < 5"));
            assert!(raw.contains("not a tag"));
        } else {
            panic!("Expected text child inside script");
        }
    }

    // Rawtext tag <style> with CSS selectors
    let quasis_style =
        ["<style>div > span { color: red; } *[data-x=\"<\"] { display: none; }</style>"];
    let ir_style =
        TemplateParser::parse_lit_template(&quasis_style, 0).expect("Rawtext style should parse");
    assert_eq!(ir_style.roots.len(), 1);
    if let TemplateNode::Element(style) = &ir_style.roots[0] {
        assert_eq!(style.tag_name, "style");
        assert_eq!(style.children.len(), 1);
    }
}

#[test]
fn stress_test_html_entity_decoding_adversarial() {
    let cases = [
        (
            "<span>&amp;&lt;&gt;&quot;&apos;&nbsp;</span>",
            "&<>\"'\u{00A0}",
        ),
        ("<span>&#60;&#62;&#38;</span>", "<>&"),
        ("<span>&#x3c;&#x3E;&#x26;</span>", "<>&"),
        (
            "<span>& &amp; &unknown; &123;</span>",
            "& & &unknown; &123;",
        ),
        ("<span>&#; &#x; &#999999999;</span>", "&#; &#x; \u{FFFD}"),
    ];

    for (html, expected_start) in cases {
        let ir = TemplateParser::parse_lit_template(&[html], 0)
            .unwrap_or_else(|e| panic!("Failed to parse entity test '{}': {}", html, e));
        assert_eq!(ir.roots.len(), 1);
        if let TemplateNode::Element(span) = &ir.roots[0] {
            if let TemplateNode::Text(txt) = &span.children[0] {
                assert!(
                    txt.starts_with(expected_start) || txt == expected_start,
                    "Entity mismatch for '{}': got '{}', expected '{}'",
                    html,
                    txt,
                    expected_start
                );
            }
        }
    }
}

#[test]
fn stress_test_mixed_attribute_directives_and_properties() {
    // Directives mixed with dynamic properties, events, and boolean attributes
    let quasis = [
        "<custom-el class=\"btn\" ",
        " .count=",
        " @click=",
        " ?disabled=",
        " ",
        ">child</custom-el>",
    ];
    let ir = TemplateParser::parse_lit_template(&quasis, 5)
        .expect("Mixed directives and attributes should parse");

    assert_eq!(ir.roots.len(), 1);
    if let TemplateNode::Element(el) = &ir.roots[0] {
        assert_eq!(el.tag_name, "custom-el");
        // Attributes:
        // 0: class="btn" (static)
        // 1: directive 0 (from " ")
        // 2: .count (dynamic property 1)
        // 3: @click (dynamic event 2)
        // 4: ?disabled (dynamic boolean 3)
        // 5: directive 4 (from " ")
        assert!(el
            .attributes
            .iter()
            .any(|a| a.name == "class" && a.value == AttributeValue::Static("btn".to_string())));
        assert!(el
            .attributes
            .iter()
            .any(|a| a.value == AttributeValue::Directive(0)));
        assert!(el.attributes.iter().any(|a| a.name == "count"
            && a.prefix == AttributePrefix::Property
            && a.value == AttributeValue::Dynamic(1)));
        assert!(el.attributes.iter().any(|a| a.name == "click"
            && a.prefix == AttributePrefix::Event
            && a.value == AttributeValue::Dynamic(2)));
        assert!(el.attributes.iter().any(|a| a.name == "disabled"
            && a.prefix == AttributePrefix::Boolean
            && a.value == AttributeValue::Dynamic(3)));
        assert!(el
            .attributes
            .iter()
            .any(|a| a.value == AttributeValue::Directive(4)));
    }
}

#[test]
fn stress_test_extreme_adversarial_scaling_and_fuzzing() {
    // 500 nested elements: <div><div><div>...</div></div></div>
    let mut open = String::new();
    let mut close = String::new();
    for _ in 0..100 {
        open.push_str("<div>");
        close.push_str("</div>");
    }
    let html = format!("{}<span>Leaf Node</span>{}", open, close);
    let start = std::time::Instant::now();
    let ir = TemplateParser::parse_lit_template(&[&html], 0)
        .expect("100-deep nested elements should parse without stack overflow");
    let elapsed = start.elapsed();
    assert_eq!(ir.roots.len(), 1);
    assert!(
        elapsed.as_millis() < 500,
        "100-deep parse took too long: {:?}",
        elapsed
    );
}
