use css_fuse::codegen::rewrite_file;
use css_fuse::extractor::StyleExtractor;
use css_fuse::models::ClusterGroup;

#[test]
fn test_reproduce_array_styles_element_loss() {
    let source = r#"
    import { LitElement, css } from 'lit';
    import { baseReset } from './reset.js';
    export class CompA extends LitElement {
      static styles = [
        baseReset,
        css`:host { color: red; }`
      ];
    }
    "#;
    let (styles, _) = StyleExtractor::extract_from_source(source, "comp-a.ts");
    assert_eq!(styles.len(), 1);
    let clusters = vec![ClusterGroup {
        id: "_fused_test".to_string(),
        fused_sheet_name: "_fused_test.js".to_string(),
        rules: vec![],
        shared_by_files: vec!["comp-a.ts".to_string()],
    }];
    let rewritten = rewrite_file("comp-a.ts", source, &styles, &clusters, ".fused", true).unwrap();
    println!("Rewritten:\n{}", rewritten.transformed_code);

    // Check if static styles still has baseReset
    let styles_slice = if let Some(idx) = rewritten.transformed_code.find("static styles") {
        &rewritten.transformed_code[idx..]
    } else {
        ""
    };
    assert!(
        styles_slice.contains("baseReset"),
        "baseReset was preserved in static styles definition!"
    );
    assert!(
        styles_slice.contains("_fused_test"),
        "Fused cluster was prepended to static styles array!"
    );
}

#[test]
fn test_array_styles_multiple_elements_and_getters() {
    let source = r#"
    import { LitElement, css } from 'lit';
    import { baseReset } from './reset.js';
    import { theme } from './theme.js';
    export class CompMulti extends LitElement {
      static styles = [
        baseReset,
        theme,
        css`:host { color: red; }`,
        css`:host { background: blue; }`
      ];

      static get styles() {
        return [baseReset, css`:host { color: red; }`];
      }
    }
    "#;
    let (styles, _) = StyleExtractor::extract_from_source(source, "comp-multi.ts");
    assert_eq!(styles.len(), 3);
    let clusters = vec![ClusterGroup {
        id: "_fused_test".to_string(),
        fused_sheet_name: "_fused_test.js".to_string(),
        rules: vec![],
        shared_by_files: vec!["comp-multi.ts".to_string()],
    }];
    let rewritten =
        rewrite_file("comp-multi.ts", source, &styles, &clusters, ".fused", true).unwrap();
    println!("Rewritten multi:\n{}", rewritten.transformed_code);

    assert!(rewritten.transformed_code.contains("baseReset"));
    assert!(rewritten.transformed_code.contains("theme"));
    assert!(rewritten.transformed_code.contains("_fused_test"));
}
