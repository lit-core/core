use css_fuse::codegen::rewrite_file;
use css_fuse::extractor::StyleExtractor;
use css_fuse::models::{ClusterGroup, NormalizedRule, RuleHash, SourceSpan};

fn make_test_rule(selector: &str, declarations: Vec<&str>) -> NormalizedRule {
    let decls: Vec<String> = declarations.into_iter().map(|s| s.to_string()).collect();
    let body = decls.join(";");
    NormalizedRule {
        at_rule: None,
        selector: selector.to_string(),
        declarations: decls,
        canonical_body: body.clone(),
        full_canonical_css: format!("{} {{{}}}", selector, body),
        hash: RuleHash(format!("rule_{}", selector)),
        source_file: "test.ts".to_string(),
        span: SourceSpan {
            start: 0,
            end: 0,
            line: 0,
            column: 0,
        },
        is_keyframes_or_media: false,
    }
}

#[test]
fn test_array_styles_multi_elements_and_mixed_subtraction() {
    let source = r#"
    import { LitElement, css } from 'lit';
    import { resetA, resetB } from './resets.js';
    import { theme } from './theme.js';

    export class ComplexCard extends LitElement {
      static styles = [
        resetA,
        theme.tokens,
        css`:host { color: red; }`,
        resetB,
        css`:host { font-size: 16px; margin: 8px; }`,
        ...theme.extras
      ];

      static get styles() {
        return [
          resetA,
          css`:host { color: red; }`,
          resetB
        ];
      }
    }
    "#;

    let (styles, _) = StyleExtractor::extract_from_source(source, "card.ts");
    assert_eq!(
        styles.len(),
        3,
        "Extracted 3 styles (2 from property, 1 from getter)"
    );

    // Define a cluster that only contains :host { color: red; }
    // This will fully absorb style[0] (in property) and style[2] (in getter),
    // but leave style[1] (:host { font-size: 16px; margin: 8px; }) with remaining CSS!
    let shared_rule = make_test_rule(":host", vec!["color: red;"]);
    let clusters = vec![ClusterGroup {
        id: "_fused_shared".to_string(),
        fused_sheet_name: "_fused_shared.js".to_string(),
        rules: vec![shared_rule],
        shared_by_files: vec!["card.ts".to_string()],
    }];

    let rewritten = rewrite_file("card.ts", source, &styles, &clusters, ".fused", true)
        .expect("rewrite_file should succeed");

    let code = &rewritten.transformed_code;
    println!("Rewritten ComplexCard:\n{}", code);

    // 1. Verify virtual import was prepended
    assert!(
        code.contains("import { _fused_shared } from 'virtual:css-fuse/_fused_shared.js';"),
        "Fused virtual import must be prepended"
    );

    // 2. In property static styles:
    // - _fused_shared must be prepended
    // - resetA must be preserved
    // - theme.tokens must be preserved
    // - css`:host { color: red; }` should be omitted because all rules were absorbed
    // - resetB must be preserved
    // - css`:host { font-size: 16px; margin: 8px; }` must remain with remaining CSS!
    // - ...theme.extras must be preserved
    assert!(code.contains("resetA"), "resetA preserved");
    assert!(
        code.contains("theme.tokens"),
        "theme.tokens member expression preserved"
    );
    assert!(code.contains("resetB"), "resetB preserved");
    assert!(
        code.contains("...theme.extras"),
        "...theme.extras spread element preserved"
    );
    assert!(
        code.contains("font-size: 16px;"),
        "Remaining CSS rule font-size preserved"
    );
    assert!(
        code.contains("margin: 8px;"),
        "Remaining CSS rule margin preserved"
    );

    // 3. In getter static get styles():
    // - _fused_shared must be prepended
    // - resetA must be preserved
    // - resetB must be preserved
    assert!(code.contains("static get styles()"), "Getter preserved");
}

#[test]
fn test_multiple_components_in_single_file_with_array_styles() {
    let source = r#"
    import { LitElement, css } from 'lit';
    import { baseReset } from './reset.js';
    import { themeTokens } from './tokens.js';

    export class CompOne extends LitElement {
      static styles = [
        baseReset,
        css`:host { color: red; }`
      ];
    }

    export class CompTwo extends LitElement {
      static styles = [
        themeTokens,
        css`:host { color: red; }`,
        baseReset
      ];
    }

    export class CompThree extends LitElement {
      static styles = css`:host { color: red; }`;
    }
    "#;

    let (styles, _) = StyleExtractor::extract_from_source(source, "multi.ts");
    assert_eq!(styles.len(), 3, "Extracted 3 styles across 3 classes");

    let shared_rule = make_test_rule(":host", vec!["color: red;"]);
    let clusters = vec![ClusterGroup {
        id: "_fused_all".to_string(),
        fused_sheet_name: "_fused_all.js".to_string(),
        rules: vec![shared_rule],
        shared_by_files: vec!["multi.ts".to_string()],
    }];

    let rewritten = rewrite_file("multi.ts", source, &styles, &clusters, ".fused", true)
        .expect("rewrite_file should succeed");

    let code = &rewritten.transformed_code;
    println!("Rewritten multi components:\n{}", code);

    // CompOne must have [_fused_all, baseReset]
    assert!(code.contains("class CompOne"), "CompOne present");
    // CompTwo must have [_fused_all, themeTokens, baseReset]
    assert!(code.contains("class CompTwo"), "CompTwo present");
    assert!(
        code.contains("themeTokens"),
        "themeTokens preserved in CompTwo"
    );
    // CompThree (scalar styles) must be rewritten to [_fused_all]
    assert!(code.contains("class CompThree"), "CompThree present");
}

#[test]
fn test_export_default_class_and_ternary_elements() {
    let source = r#"
    import { LitElement, css } from 'lit';
    import { darkTheme, lightTheme } from './theme.js';
    import { isDark } from './config.js';

    class DefaultComp extends LitElement {
      static styles = [
        isDark ? darkTheme : lightTheme,
        css`:host { display: block; }`
      ];
    }
    export default DefaultComp;
    "#;

    let (styles, _) = StyleExtractor::extract_from_source(source, "default_comp.ts");
    assert_eq!(styles.len(), 1);

    let shared_rule = make_test_rule(":host", vec!["display: block;"]);
    let clusters = vec![ClusterGroup {
        id: "_fused_display".to_string(),
        fused_sheet_name: "_fused_display.js".to_string(),
        rules: vec![shared_rule],
        shared_by_files: vec!["default_comp.ts".to_string()],
    }];

    let rewritten = rewrite_file(
        "default_comp.ts",
        source,
        &styles,
        &clusters,
        ".fused",
        true,
    )
    .expect("rewrite_file should succeed");

    let code = &rewritten.transformed_code;
    println!("Rewritten default comp:\n{}", code);

    assert!(
        code.contains("isDark ? darkTheme : lightTheme"),
        "Ternary element preserved"
    );
    assert!(code.contains("_fused_display"), "Fused sheet prepended");
    assert!(
        code.contains("export default DefaultComp;"),
        "Export default statement preserved"
    );

    // Also verify inline export default class clean bailout
    let inline_default = r#"
    import { LitElement, css } from 'lit';
    export default class InlineDefault extends LitElement {
      static styles = css`:host { display: block; }`;
    }
    "#;
    let (inline_styles, _) = StyleExtractor::extract_from_source(inline_default, "inline.ts");
    assert_eq!(
        inline_styles.len(),
        0,
        "Extracts 0 styles from inline default class"
    );
    let inline_rewritten = rewrite_file(
        "inline.ts",
        inline_default,
        &inline_styles,
        &clusters,
        ".fused",
        true,
    );
    assert!(
        inline_rewritten.is_none(),
        "Must cleanly bail out with None leaving file untouched"
    );
}
