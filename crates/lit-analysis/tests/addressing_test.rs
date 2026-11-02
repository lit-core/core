use lit_analysis::parts::{PartAddressing, compute_template_parts, compute_template_paths};

#[test]
fn test_element_anchored_attributes() {
    let quasis = [
        "<button id=\"",
        "\" ?disabled=\"",
        "\" @click=\"",
        "\">Submit</button>",
    ];
    let parts = compute_template_parts(&quasis, 3).expect("parts computed");
    assert_eq!(parts.len(), 3);

    for (idx, p) in parts.iter().enumerate() {
        assert_eq!(p.index, idx);
        assert!(p.is_attribute);
        assert_eq!(p.addressing.kind(), "element");
        assert_eq!(p.addressing.type_name(), "ElementAnchored");
        assert_eq!(p.target_tag.as_deref(), Some("button"));
        match &p.addressing {
            PartAddressing::ElementAnchored {
                path,
                target_tag,
                attr_name,
                prefix,
                ..
            } => {
                assert_eq!(path, &[0]);
                assert_eq!(target_tag.as_deref(), Some("button"));
                match idx {
                    0 => {
                        assert_eq!(attr_name.as_deref(), Some("id"));
                        assert_eq!(prefix.as_deref(), None);
                    }
                    1 => {
                        assert_eq!(attr_name.as_deref(), Some("disabled"));
                        assert_eq!(prefix.as_deref(), Some("?"));
                    }
                    2 => {
                        assert_eq!(attr_name.as_deref(), Some("click"));
                        assert_eq!(prefix.as_deref(), Some("@"));
                    }
                    _ => unreachable!(),
                }
            }
            _ => panic!("Expected ElementAnchored"),
        }
    }
}

#[test]
fn test_sole_text_child() {
    let quasis = ["<div><h1>", "</h1><p>", "</p><span>", "</span></div>"];
    let parts = compute_template_parts(&quasis, 3).expect("parts computed");
    assert_eq!(parts.len(), 3);

    for (idx, p) in parts.iter().enumerate() {
        assert_eq!(p.index, idx);
        assert!(!p.is_attribute);
        assert_eq!(p.addressing.kind(), "sole-text");
        assert_eq!(p.addressing.type_name(), "SoleTextChild");
        match &p.addressing {
            PartAddressing::SoleTextChild {
                parent_path,
                parent_tag,
            } => match idx {
                0 => {
                    assert_eq!(parent_path, &[0, 0]);
                    assert_eq!(parent_tag.as_deref(), Some("h1"));
                }
                1 => {
                    assert_eq!(parent_path, &[0, 1]);
                    assert_eq!(parent_tag.as_deref(), Some("p"));
                }
                2 => {
                    assert_eq!(parent_path, &[0, 2]);
                    assert_eq!(parent_tag.as_deref(), Some("span"));
                }
                _ => unreachable!(),
            },
            _ => panic!("Expected SoleTextChild"),
        }
    }
}

#[test]
fn test_range_markers_for_adjacent_and_mixed_expressions() {
    let quasis = ["<div>Static ", " middle ", " end</div>"];
    let parts = compute_template_parts(&quasis, 2).expect("parts computed");
    assert_eq!(parts.len(), 2);

    for (idx, p) in parts.iter().enumerate() {
        assert_eq!(p.index, idx);
        assert!(!p.is_attribute);
        assert_eq!(p.addressing.kind(), "range");
        assert_eq!(p.addressing.type_name(), "RangeAddressed");
        match &p.addressing {
            PartAddressing::RangeMarker {
                name,
                start_path,
                parent_path,
            } => {
                assert_eq!(name, &format!("p{}", idx));
                assert_eq!(parent_path, &[0]);
                match idx {
                    0 => assert_eq!(start_path, &[0, 1]),
                    1 => assert_eq!(start_path, &[0, 3]),
                    _ => unreachable!(),
                }
            }
            _ => panic!("Expected RangeMarker"),
        }
    }
}

#[test]
fn test_table_implied_tbody_addressing() {
    let quasis = ["<table><tr><td>", "</td></tr></table>"];
    let parts = compute_template_parts(&quasis, 1).expect("parts computed");
    assert_eq!(parts.len(), 1);

    let p = &parts[0];
    assert_eq!(p.addressing.kind(), "sole-text");
    match &p.addressing {
        PartAddressing::SoleTextChild {
            parent_path,
            parent_tag,
        } => {
            // Implied tbody: table (0) -> tbody (0) -> tr (0) -> td (0)
            assert_eq!(parent_path, &[0, 0, 0, 0]);
            assert_eq!(parent_tag.as_deref(), Some("td"));
        }
        _ => panic!("Expected SoleTextChild"),
    }

    let paths = compute_template_paths(&quasis, 1).expect("paths computed");
    assert_eq!(paths, vec![vec![0, 0, 0, 0, 0]]);
}

#[test]
fn test_svg_elements_and_namespaces() {
    let quasis = [
        "<svg viewBox=\"",
        "\"><circle r=\"",
        "\"></circle><text>",
        "</text></svg>",
    ];
    let parts = compute_template_parts(&quasis, 3).expect("parts computed");
    assert_eq!(parts.len(), 3);

    // Part 0: viewBox attribute on svg
    assert!(parts[0].is_attribute);
    assert_eq!(parts[0].addressing.kind(), "element");
    assert_eq!(parts[0].path, &[0]);

    // Part 1: r attribute on circle
    assert!(parts[1].is_attribute);
    assert_eq!(parts[1].addressing.kind(), "element");
    assert_eq!(parts[1].path, &[0, 0]);

    // Part 2: sole text inside text element
    assert!(!parts[2].is_attribute);
    assert_eq!(parts[2].addressing.kind(), "sole-text");
    match &parts[2].addressing {
        PartAddressing::SoleTextChild {
            parent_path,
            parent_tag,
        } => {
            assert_eq!(parent_path, &[0, 1]);
            assert_eq!(parent_tag.as_deref(), Some("text"));
        }
        _ => panic!("Expected SoleTextChild"),
    }
}

#[test]
fn test_multi_part_attributes() {
    let quasis = ["<div class=\"a ", "\" data-pair=\"", "-", "\"></div>"];
    let parts = compute_template_parts(&quasis, 3).expect("parts computed");
    assert_eq!(parts.len(), 3);

    for p in &parts {
        assert!(p.is_attribute);
        assert_eq!(p.addressing.kind(), "element");
        assert_eq!(p.path, &[0]);
    }

    match &parts[0].addressing {
        PartAddressing::ElementAnchored { strings, .. } => {
            assert_eq!(
                strings.as_deref(),
                Some(&["a ".to_string(), "".to_string()][..])
            );
        }
        _ => panic!("Expected ElementAnchored"),
    }

    match &parts[1].addressing {
        PartAddressing::ElementAnchored { strings, .. } => {
            assert_eq!(
                strings.as_deref(),
                Some(&["".to_string(), "-".to_string(), "".to_string()][..])
            );
        }
        _ => panic!("Expected ElementAnchored"),
    }
}

#[test]
fn test_html_entities_with_adjacent_expressions() {
    let quasis = ["<div>&amp; ", " &mdash; ", "</div>"];
    let parts = compute_template_parts(&quasis, 2).expect("parts computed");
    assert_eq!(parts.len(), 2);

    for p in &parts {
        assert_eq!(p.addressing.kind(), "range");
        assert_eq!(p.addressing.type_name(), "RangeAddressed");
    }
}
