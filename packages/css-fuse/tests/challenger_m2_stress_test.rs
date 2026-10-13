use css_fuse::codegen::rewrite_file;
use css_fuse::extractor::StyleExtractor;
use css_fuse::models::ClusterGroup;
use css_fuse::normalizer::normalize_css;

#[test]
fn test_array_styles_preserves_non_css_and_spread_and_calls() {
    let source = r#"
    import { LitElement, css } from 'lit';
    import { baseReset } from './reset.js';
    import { theme } from './theme.js';
    import { getDynamicStyles } from './dynamic.js';
    import { extraSheet } from './extra.js';

    export class StressComp extends LitElement {
      static styles = [
        baseReset,
        css`
          :host { color: red; }
          .local-only { display: flex; }
        `,
        theme,
        css`:host { background: blue; padding: 10px; }`,
        ...extraSheet,
        getDynamicStyles()
      ];

      static get styles() {
        return [
          baseReset,
          css`
            :host { color: red; }
            .getter-local { display: grid; }
          `,
          theme
        ];
      }
    }
    "#;

    let (styles, _) = StyleExtractor::extract_from_source(source, "stress.ts");
    assert_eq!(
        styles.len(),
        3,
        "Should extract 3 css template blocks (2 from prop, 1 from getter)"
    );

    // Normalize rules from the first style to get a real normalized rule for :host { color: red; }
    let norm = normalize_css(&styles[0]);
    let color_rule = norm.into_iter().find(|r| r.selector == ":host").unwrap();

    let clusters = vec![ClusterGroup {
        id: "_fused_shared_rule".to_string(),
        fused_sheet_name: "_fused_shared_rule.js".to_string(),
        rules: vec![color_rule],
        shared_by_files: vec!["stress.ts".to_string()],
    }];

    let rewritten = rewrite_file("stress.ts", source, &styles, &clusters, ".fused", true)
        .expect("rewrite_file should succeed");

    let code = &rewritten.transformed_code;
    println!("Transformed code:\n{}", code);

    // Verify all non-css elements are preserved in the property array
    assert!(code.contains("baseReset"), "baseReset must be preserved");
    assert!(code.contains("theme"), "theme must be preserved");
    assert!(
        code.contains("...extraSheet"),
        "Spread element must be preserved"
    );
    assert!(
        code.contains("getDynamicStyles()"),
        "Dynamic call must be preserved"
    );

    // Verify fused sheet is prepended
    assert!(
        code.contains("_fused_shared_rule"),
        "Fused sheet must be prepended"
    );

    // Verify remaining CSS in the property array: color: red was subtracted, .local-only remains
    assert!(
        code.contains(".local-only"),
        ".local-only must remain in rewritten property array"
    );
    assert!(
        code.contains("background: #00f;") || code.contains("background: blue;"),
        "second css template must remain"
    );

    // Verify getter preservation
    assert!(code.contains("static get styles()"), "Getter must remain");
    assert!(
        code.contains(".getter-local"),
        ".getter-local must remain in rewritten getter array"
    );
}

#[test]
fn test_array_styles_complete_subtraction_omits_css_but_retains_non_css() {
    let source = r#"
    import { LitElement, css } from 'lit';
    import { baseReset } from './reset.js';
    import { theme } from './theme.js';

    export class AbsorbedComp extends LitElement {
      static styles = [
        baseReset,
        css`:host { color: red; }`,
        theme
      ];
    }
    "#;

    let (styles, _) = StyleExtractor::extract_from_source(source, "absorbed.ts");
    assert_eq!(styles.len(), 1);

    let all_rules = normalize_css(&styles[0]);

    let clusters = vec![ClusterGroup {
        id: "_fused_absorbed".to_string(),
        fused_sheet_name: "_fused_absorbed.js".to_string(),
        rules: all_rules,
        shared_by_files: vec!["absorbed.ts".to_string()],
    }];

    let rewritten = rewrite_file("absorbed.ts", source, &styles, &clusters, ".fused", true)
        .expect("rewrite_file should succeed");

    let code = &rewritten.transformed_code;
    println!("Absorbed code:\n{}", code);

    // Both baseReset and theme must be present
    assert!(code.contains("baseReset"), "baseReset must be preserved");
    assert!(code.contains("theme"), "theme must be preserved");
    assert!(
        code.contains("_fused_absorbed"),
        "Fused sheet must be prepended"
    );

    // The css template had only :host { color: red; }, so remaining css was None.
    // It should NOT contain an empty css`` template.
    assert!(
        !code.contains("css``"),
        "Empty css template should be omitted from array"
    );
}

#[test]
fn test_array_styles_untouched_when_no_css_templates_present() {
    let source = r#"
    import { LitElement, css } from 'lit';
    import { baseReset } from './reset.js';
    import { theme } from './theme.js';

    export const otherStyles = css`:host { color: red; }`;

    export class NoCssComp extends LitElement {
      static styles = [baseReset, theme];
    }
    "#;

    let (styles, _) = StyleExtractor::extract_from_source(source, "no_css.ts");
    // Only otherStyles was extracted
    assert_eq!(styles.len(), 1);

    let clusters = vec![ClusterGroup {
        id: "_fused_sheet".to_string(),
        fused_sheet_name: "_fused_sheet.js".to_string(),
        rules: vec![],
        shared_by_files: vec!["no_css.ts".to_string()],
    }];

    let rewritten = rewrite_file("no_css.ts", source, &styles, &clusters, ".fused", true)
        .expect("rewrite_file should succeed");

    let code = &rewritten.transformed_code;
    println!("NoCss code:\n{}", code);

    // static styles = [baseReset, theme] must NOT have _fused_sheet prepended because it had no css rewrite!
    assert!(
        code.contains("static styles = [\n\t\tbaseReset,\n\t\ttheme\n\t];")
            || code.contains("static styles = [baseReset, theme];"),
        "static styles without css must remain untouched: got {}",
        code
    );
}

#[test]
fn test_variable_declaration_array_styles() {
    let source = r#"
    import { css } from 'lit';
    import { baseReset } from './reset.js';

    export const cardStyles = [
      baseReset,
      css`:host { border: 1px solid black; }`
    ];
    "#;

    let (styles, _) = StyleExtractor::extract_from_source(source, "var_styles.ts");
    assert_eq!(styles.len(), 1);

    let clusters = vec![ClusterGroup {
        id: "_fused_var".to_string(),
        fused_sheet_name: "_fused_var.js".to_string(),
        rules: vec![],
        shared_by_files: vec!["var_styles.ts".to_string()],
    }];

    let rewritten = rewrite_file("var_styles.ts", source, &styles, &clusters, ".fused", true)
        .expect("rewrite_file should succeed");

    let code = &rewritten.transformed_code;
    println!("Variable declaration code:\n{}", code);

    assert!(
        code.contains("baseReset"),
        "baseReset must be preserved in exported variable array"
    );
    assert!(
        code.contains("_fused_var"),
        "_fused_var must be prepended to exported variable array"
    );
}

#[test]
fn test_array_styles_mixed_absorption_multi_templates() {
    let source = r#"
    import { LitElement, css } from 'lit';
    import { baseReset } from './reset.js';
    import { theme } from './theme.js';

    export class MixedAbsorbComp extends LitElement {
      static styles = [
        baseReset,
        css`:host { color: red; }`,
        theme,
        css`
          :host { color: red; }
          .local-rule { padding: 4px; }
        `
      ];
    }
    "#;

    let (styles, _) = StyleExtractor::extract_from_source(source, "mixed_absorb.ts");
    assert_eq!(styles.len(), 2);

    let norm1 = normalize_css(&styles[0]);
    let color_rule = norm1.into_iter().find(|r| r.selector == ":host").unwrap();

    let clusters = vec![ClusterGroup {
        id: "_fused_color".to_string(),
        fused_sheet_name: "_fused_color.js".to_string(),
        rules: vec![color_rule],
        shared_by_files: vec!["mixed_absorb.ts".to_string()],
    }];

    let rewritten = rewrite_file(
        "mixed_absorb.ts",
        source,
        &styles,
        &clusters,
        ".fused",
        true,
    )
    .expect("rewrite_file should succeed");

    let code = &rewritten.transformed_code;
    println!("Mixed absorb code:\n{}", code);

    // Verify fused sheet is prepended
    assert!(
        code.contains("_fused_color"),
        "Fused sheet must be prepended"
    );
    // Verify baseReset and theme are preserved
    assert!(code.contains("baseReset"), "baseReset must be preserved");
    assert!(code.contains("theme"), "theme must be preserved");
    // Verify first css template is omitted (completely absorbed)
    // and second css template is retained with .local-rule
    assert!(
        code.contains(".local-rule"),
        ".local-rule must be retained in second css template"
    );
}
