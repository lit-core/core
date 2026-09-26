use css_fuse::cluster::{ClusterEngine, FrequencyIndex};
use css_fuse::codegen::rewrite_file;
use css_fuse::extractor::StyleExtractor;
use css_fuse::models::{ExtractedStyle, SourceSpan};
use css_fuse::normalizer::{normalize_css, subtract_rules_from_css};
use css_fuse::scoping::{audit_custom_properties, audit_slotted_selectors};

#[test]
fn test_style_extraction_from_lit_component() {
    let source = r#"
    import { LitElement, css } from 'lit';
    import { customElement } from 'lit/decorators.js';

    @customElement('my-button')
    export class MyButton extends LitElement {
      static styles = css`
        :host {
          display: inline-block;
          box-sizing: border-box;
        }
        button {
          cursor: pointer;
        }
      `;
    }
  "#;

    let (styles, _) = StyleExtractor::extract_from_source(source, "my-button.ts");
    assert_eq!(styles.len(), 1);
    assert_eq!(styles[0].component_name.as_deref(), Some("MyButton"));
    assert_eq!(styles[0].tag_name.as_deref(), Some("my-button"));
    assert_eq!(styles[0].location_kind, "static_property");
    assert!(styles[0].css_text.contains("display: inline-block;"));
}

#[test]
fn test_css_normalization_and_deduplication() {
    let style1 = ExtractedStyle {
        file_path: "comp-a.ts".to_string(),
        component_name: Some("CompA".to_string()),
        tag_name: Some("comp-a".to_string()),
        css_text: ":host { display: block; box-sizing: border-box; }".to_string(),
        span: SourceSpan {
            start: 0,
            end: 50,
            line: 1,
            column: 1,
        },
        is_external_module: false,
        export_name: None,
        location_kind: "standalone".to_string(),
        parent_span: None,
        tag_identifier: None,
    };

    let style2 = ExtractedStyle {
        file_path: "comp-b.ts".to_string(),
        component_name: Some("CompB".to_string()),
        tag_name: Some("comp-b".to_string()),
        css_text: ":host { box-sizing: border-box; display: block; }".to_string(),
        span: SourceSpan {
            start: 0,
            end: 50,
            line: 1,
            column: 1,
        },
        is_external_module: false,
        export_name: None,
        location_kind: "standalone".to_string(),
        parent_span: None,
        tag_identifier: None,
    };

    let rules1 = normalize_css(&style1);
    let rules2 = normalize_css(&style2);

    assert!(!rules1.is_empty());
    assert!(!rules2.is_empty());

    let mut index = FrequencyIndex::new();
    index.index_rules(&rules1);
    index.index_rules(&rules2);

    let clusters = ClusterEngine::cluster(&index, 2);
    assert_eq!(
        clusters.len(),
        1,
        "Expected identical rules to form a cluster"
    );
    assert_eq!(clusters[0].shared_by_files.len(), 2);
}

#[test]
fn test_sub_rule_extraction_and_subtraction_preserves_overrides() {
    // Component A has :host with display, box-sizing, and color: red (override)
    let style_a = ExtractedStyle {
        file_path: "comp-a.ts".to_string(),
        component_name: Some("CompA".to_string()),
        tag_name: Some("comp-a".to_string()),
        css_text: ":host { display: block; box-sizing: border-box; color: red; }".to_string(),
        span: SourceSpan {
            start: 0,
            end: 60,
            line: 1,
            column: 1,
        },
        is_external_module: false,
        export_name: None,
        location_kind: "standalone".to_string(),
        parent_span: None,
        tag_identifier: None,
    };

    // Component B has :host with display, box-sizing, and color: blue (override)
    let style_b = ExtractedStyle {
        file_path: "comp-b.ts".to_string(),
        component_name: Some("CompB".to_string()),
        tag_name: Some("comp-b".to_string()),
        css_text: ":host { display: block; box-sizing: border-box; color: blue; }".to_string(),
        span: SourceSpan {
            start: 0,
            end: 61,
            line: 1,
            column: 1,
        },
        is_external_module: false,
        export_name: None,
        location_kind: "standalone".to_string(),
        parent_span: None,
        tag_identifier: None,
    };

    let rules_a = normalize_css(&style_a);
    let rules_b = normalize_css(&style_b);

    let mut index = FrequencyIndex::new();
    index.index_rules(&rules_a);
    index.index_rules(&rules_b);

    let clusters = ClusterEngine::cluster(&index, 2);
    assert_eq!(clusters.len(), 1, "Should create 1 shared cluster");
    let shared_cluster = &clusters[0];
    assert_eq!(shared_cluster.rules.len(), 1);
    assert!(shared_cluster.rules[0]
        .canonical_body
        .contains("box-sizing:border-box"));
    assert!(shared_cluster.rules[0]
        .canonical_body
        .contains("display:block"));
    assert!(!shared_cluster.rules[0].canonical_body.contains("color:red"));
    assert!(!shared_cluster.rules[0]
        .canonical_body
        .contains("color:blue"));

    // Subtract from Component A -> color: red must remain
    let rem_a = subtract_rules_from_css(&style_a, &shared_cluster.rules)
        .expect("Remaining CSS expected for A");
    assert!(
        rem_a.contains("color: red"),
        "Component A must retain its color override"
    );
    assert!(
        !rem_a.contains("display: block"),
        "Shared display rule must be subtracted"
    );
    assert!(
        !rem_a.contains("box-sizing: border-box"),
        "Shared box-sizing rule must be subtracted"
    );

    // Subtract from Component B -> color: blue (#00f) must remain
    let rem_b = subtract_rules_from_css(&style_b, &shared_cluster.rules)
        .expect("Remaining CSS expected for B");
    assert!(
        rem_b.contains("color: #00f") || rem_b.contains("color: blue"),
        "Component B must retain its color override"
    );
}

#[test]
fn test_cascade_order_in_rewrite() {
    let source_a = r#"import { LitElement, css } from 'lit';
export class CompA extends LitElement {
  static styles = css`
    :host { display: block; box-sizing: border-box; color: red; }
  `;
}
"#;

    let (styles_a, _) = StyleExtractor::extract_from_source(source_a, "comp-a.ts");
    let (styles_b, _) = StyleExtractor::extract_from_source(
        r#"import { LitElement, css } from 'lit';
export class CompB extends LitElement {
  static styles = css`
    :host { display: block; box-sizing: border-box; color: blue; }
  `;
}
"#,
        "comp-b.ts",
    );

    let mut index = FrequencyIndex::new();
    for s in &styles_a {
        index.index_rules(&normalize_css(s));
    }
    for s in &styles_b {
        index.index_rules(&normalize_css(s));
    }

    let clusters = ClusterEngine::cluster(&index, 2);
    let rewritten = rewrite_file("comp-a.ts", source_a, &styles_a, &clusters, ".fused", false)
        .expect("File must be rewritten");

    // Ensure shared rule is prepended before local rules in static styles array for proper cascade precedence
    let transformed = rewritten.transformed_code;
    assert!(transformed.contains("static styles = ["));
    let cluster_id = &clusters[0].id;
    assert!(transformed.contains(&format!("static styles = [{}, css`", cluster_id)));
    assert!(transformed.contains("color: red;"));
    assert!(transformed.contains(&format!(
        "import {{ {} }} from './.fused/{}.js';",
        cluster_id, cluster_id
    )));
}

#[test]
fn test_tree_shaking_isolation() {
    // Comp A & Comp B share rule 1
    // Comp C & Comp D share rule 2
    let s_a = ExtractedStyle {
        file_path: "comp-a.ts".to_string(),
        component_name: None,
        tag_name: None,
        css_text: ".header { font-weight: bold; }".to_string(),
        span: SourceSpan {
            start: 0,
            end: 30,
            line: 1,
            column: 1,
        },
        is_external_module: false,
        export_name: None,
        location_kind: "standalone".to_string(),
        parent_span: None,
        tag_identifier: None,
    };
    let s_b = ExtractedStyle {
        file_path: "comp-b.ts".to_string(),
        component_name: None,
        tag_name: None,
        css_text: ".header { font-weight: bold; }".to_string(),
        span: SourceSpan {
            start: 0,
            end: 30,
            line: 1,
            column: 1,
        },
        is_external_module: false,
        export_name: None,
        location_kind: "standalone".to_string(),
        parent_span: None,
        tag_identifier: None,
    };
    let s_c = ExtractedStyle {
        file_path: "comp-c.ts".to_string(),
        component_name: None,
        tag_name: None,
        css_text: ".footer { padding: 10px; }".to_string(),
        span: SourceSpan {
            start: 0,
            end: 26,
            line: 1,
            column: 1,
        },
        is_external_module: false,
        export_name: None,
        location_kind: "standalone".to_string(),
        parent_span: None,
        tag_identifier: None,
    };
    let s_d = ExtractedStyle {
        file_path: "comp-d.ts".to_string(),
        component_name: None,
        tag_name: None,
        css_text: ".footer { padding: 10px; }".to_string(),
        span: SourceSpan {
            start: 0,
            end: 26,
            line: 1,
            column: 1,
        },
        is_external_module: false,
        export_name: None,
        location_kind: "standalone".to_string(),
        parent_span: None,
        tag_identifier: None,
    };

    let mut index = FrequencyIndex::new();
    index.index_rules(&normalize_css(&s_a));
    index.index_rules(&normalize_css(&s_b));
    index.index_rules(&normalize_css(&s_c));
    index.index_rules(&normalize_css(&s_d));

    let clusters = ClusterEngine::cluster(&index, 2);
    assert_eq!(
        clusters.len(),
        2,
        "Should create exactly 2 isolated clusters"
    );

    // Check cluster for A & B
    let cluster_ab = clusters
        .iter()
        .find(|c| c.shared_by_files.contains(&"comp-a.ts".to_string()))
        .unwrap();
    assert!(!cluster_ab
        .shared_by_files
        .contains(&"comp-c.ts".to_string()));
    assert!(!cluster_ab
        .shared_by_files
        .contains(&"comp-d.ts".to_string()));

    // Check cluster for C & D
    let cluster_cd = clusters
        .iter()
        .find(|c| c.shared_by_files.contains(&"comp-c.ts".to_string()))
        .unwrap();
    assert!(!cluster_cd
        .shared_by_files
        .contains(&"comp-a.ts".to_string()));
    assert!(!cluster_cd
        .shared_by_files
        .contains(&"comp-b.ts".to_string()));
}

#[test]
fn test_slotted_scoping_audit() {
    let invalid_style = ExtractedStyle {
        file_path: "test.ts".to_string(),
        component_name: None,
        tag_name: None,
        css_text: "::slotted(div > span) { color: red; }".to_string(),
        span: SourceSpan {
            start: 0,
            end: 40,
            line: 1,
            column: 1,
        },
        is_external_module: false,
        export_name: None,
        location_kind: "standalone".to_string(),
        parent_span: None,
        tag_identifier: None,
    };

    let valid_style = ExtractedStyle {
        file_path: "test.ts".to_string(),
        component_name: None,
        tag_name: None,
        css_text: "::slotted(video) { display: block; }".to_string(),
        span: SourceSpan {
            start: 0,
            end: 40,
            line: 1,
            column: 1,
        },
        is_external_module: false,
        export_name: None,
        location_kind: "standalone".to_string(),
        parent_span: None,
        tag_identifier: None,
    };

    let diags_invalid = audit_slotted_selectors(&invalid_style);
    assert_eq!(diags_invalid.len(), 1);
    assert_eq!(diags_invalid[0].code, "W3C_SLOTTED_COMPOUND");

    let diags_valid = audit_slotted_selectors(&valid_style);
    assert!(diags_valid.is_empty());
}

#[test]
fn test_custom_property_contract_audit() {
    let style_no_fallback = ExtractedStyle {
        file_path: "test.ts".to_string(),
        component_name: None,
        tag_name: None,
        css_text: ":host { color: var(--button-color); }".to_string(),
        span: SourceSpan {
            start: 0,
            end: 40,
            line: 1,
            column: 1,
        },
        is_external_module: false,
        export_name: None,
        location_kind: "standalone".to_string(),
        parent_span: None,
        tag_identifier: None,
    };

    let style_with_fallback = ExtractedStyle {
        file_path: "test.ts".to_string(),
        component_name: None,
        tag_name: None,
        css_text: ":host { color: var(--button-color, #111827); }".to_string(),
        span: SourceSpan {
            start: 0,
            end: 50,
            line: 1,
            column: 1,
        },
        is_external_module: false,
        export_name: None,
        location_kind: "standalone".to_string(),
        parent_span: None,
        tag_identifier: None,
    };

    let diags_no_fallback = audit_custom_properties(&style_no_fallback);
    assert_eq!(diags_no_fallback.len(), 1);
    assert_eq!(diags_no_fallback[0].code, "DESIGN_CONTRACT_NO_FALLBACK");

    let diags_with_fallback = audit_custom_properties(&style_with_fallback);
    assert!(diags_with_fallback.is_empty());
}
