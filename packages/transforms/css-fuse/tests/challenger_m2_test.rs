use css_fuse::extractor::StyleExtractor;

#[test]
fn test_challenge_custom_element_decorator_proven_vs_fake() {
    // 1. Genuine Lit decorator
    let src_genuine = r#"
        import { LitElement, css } from 'lit';
        import { customElement } from 'lit/decorators.js';

        @customElement('genuine-button')
        export class GenuineButton extends LitElement {
            static styles = css`:host { display: block; }`;
        }
    "#;
    let (styles_genuine, _) = StyleExtractor::extract_from_source(src_genuine, "genuine.ts");
    assert_eq!(styles_genuine.len(), 1);
    assert_eq!(
        styles_genuine[0].tag_name.as_deref(),
        Some("genuine-button"),
        "Genuine Lit decorator must resolve tag name"
    );

    // 2. Aliased Lit decorator
    let src_aliased = r#"
        import { LitElement, css } from 'lit';
        import { customElement as ce } from 'lit/decorators.js';

        @ce('aliased-button')
        export class AliasedButton extends LitElement {
            static styles = css`:host { display: flex; }`;
        }
    "#;
    let (styles_aliased, _) = StyleExtractor::extract_from_source(src_aliased, "aliased.ts");
    assert_eq!(styles_aliased.len(), 1);
    assert_eq!(
        styles_aliased[0].tag_name.as_deref(),
        Some("aliased-button"),
        "Aliased Lit decorator must resolve tag name"
    );

    // 3. Fake decorator from unrelated package
    let src_fake = r#"
        import { LitElement, css } from 'lit';
        import { customElement } from 'unrelated-library';

        @customElement('fake-button')
        export class FakeButton extends LitElement {
            static styles = css`:host { display: grid; }`;
        }
    "#;
    let (styles_fake, _) = StyleExtractor::extract_from_source(src_fake, "fake.ts");
    assert_eq!(styles_fake.len(), 1);
    assert_eq!(
        styles_fake[0].tag_name.as_deref(),
        None,
        "Decorator from unrelated library must NOT resolve tag name (no name fallback)"
    );

    // 4. Fake local decorator function
    let src_local = r#"
        import { LitElement, css } from 'lit';
        function customElement(name: string) {
            return (cls: any) => cls;
        }

        @customElement('local-button')
        export class LocalButton extends LitElement {
            static styles = css`:host { display: inline; }`;
        }
    "#;
    let (styles_local, _) = StyleExtractor::extract_from_source(src_local, "local.ts");
    assert_eq!(styles_local.len(), 1);
    assert_eq!(
        styles_local[0].tag_name.as_deref(),
        None,
        "Local decorator function must NOT resolve tag name"
    );
}

#[test]
fn test_challenge_css_fuse_tagged_template_extraction_boundaries() {
    // 1. Genuine css template
    let src1 = r#"
        import { css } from 'lit';
        export const s1 = css`:host { color: red; }`;
    "#;
    let (styles1, _) = StyleExtractor::extract_from_source(src1, "s1.ts");
    assert_eq!(styles1.len(), 1);

    // 2. Aliased css template from lit/index.js
    let src2 = r#"
        import { css as customCss } from 'lit/index.js';
        export const s2 = customCss`:host { color: blue; }`;
    "#;
    let (styles2, _) = StyleExtractor::extract_from_source(src2, "s2.ts");
    assert_eq!(styles2.len(), 1);

    // 3. Shadowed css in file with Lit import
    let src3 = r#"
        import { html } from 'lit';
        const css = (s: any) => s;
        export const s3 = css`:host { color: green; }`;
    "#;
    let (styles3, _) = StyleExtractor::extract_from_source(src3, "s3.ts");
    assert_eq!(
        styles3.len(),
        0,
        "Shadowed css identifier must not be extracted"
    );

    // 4. Completely unrelated module
    let src4 = r#"
        import { css } from '@emotion/react';
        export const s4 = css`:host { color: yellow; }`;
    "#;
    let (styles4, _) = StyleExtractor::extract_from_source(src4, "s4.ts");
    assert_eq!(
        styles4.len(),
        0,
        "CSS imported from non-Lit library must not be extracted"
    );
}

#[test]
fn test_challenge_css_fuse_micro_cluster_threshold_rejection() {
    use css_fuse::cluster::{ClusterEngine, FrequencyIndex};
    use css_fuse::models::{DEFAULT_MIN_SAVINGS, ExtractedStyle, SourceSpan};
    use css_fuse::normalizer::normalize_css;

    let make_style = |file: &str, css: &str| ExtractedStyle {
        file_path: file.to_string(),
        component_name: Some("Comp".to_string()),
        tag_name: Some("x-comp".to_string()),
        css_text: css.to_string(),
        span: SourceSpan {
            start: 0,
            end: css.len(),
            line: 1,
            column: 1,
        },
        is_external_module: false,
        export_name: None,
        location_kind: "static_property".to_string(),
        parent_span: None,
        tag_identifier: None,
    };

    // 1. Micro-cluster (< 200 bytes gross savings)
    {
        let s1 = make_style("a.ts", ":host { display: block; box-sizing: border-box; }");
        let s2 = make_style("b.ts", ":host { display: block; box-sizing: border-box; }");
        let r1 = normalize_css(&s1);
        let r2 = normalize_css(&s2);
        let mut index = FrequencyIndex::new();
        index.index_rules(&r1);
        index.index_rules(&r2);

        // With min_savings = 0: accepted
        let clusters_0 = ClusterEngine::cluster_with_min_savings(&index, 2, 0);
        assert_eq!(
            clusters_0.len(),
            1,
            "Micro-cluster accepted when min_savings = 0"
        );

        // With DEFAULT_MIN_SAVINGS (200): rejected
        let clusters_200 =
            ClusterEngine::cluster_with_min_savings(&index, 2, DEFAULT_MIN_SAVINGS as usize);
        assert_eq!(
            clusters_200.len(),
            0,
            "Micro-cluster rejected when net savings < 200"
        );
    }

    // 2. Gross savings is 300 bytes (> 200 gross), but module overhead is 168 bytes (64 + 2*52),
    // so net savings is 300 - 168 = 132 bytes (< 200 net). Must be rejected!
    {
        let decls = (0..10)
            .map(|i| format!("--custom-var-color-property-{}: red;", i))
            .collect::<Vec<_>>()
            .join(" ");
        let css = format!(":host {{ {} }}", decls);

        let s1 = make_style("a.ts", &css);
        let s2 = make_style("b.ts", &css);
        let r1 = normalize_css(&s1);
        let r2 = normalize_css(&s2);
        let mut index = FrequencyIndex::new();
        index.index_rules(&r1);
        index.index_rules(&r2);

        let clusters_200 = ClusterEngine::cluster_with_min_savings(&index, 2, 200);
        assert_eq!(
            clusters_200.len(),
            0,
            "Cluster with 300 gross savings must be rejected because net savings after 168B module overhead is 132B (< 200B)"
        );
    }

    // 3. Gross savings is ~500 bytes. Module overhead for 2 files is 168 bytes.
    // Net savings is > 200 bytes. Must be accepted!
    {
        let decls = (0..20)
            .map(|i| format!("--large-custom-design-token-var-{}: #123456;", i))
            .collect::<Vec<_>>()
            .join(" ");
        let css = format!(":host {{ {} }}", decls);

        let s1 = make_style("a.ts", &css);
        let s2 = make_style("b.ts", &css);
        let r1 = normalize_css(&s1);
        let r2 = normalize_css(&s2);
        let mut index = FrequencyIndex::new();
        index.index_rules(&r1);
        index.index_rules(&r2);

        let clusters_200 = ClusterEngine::cluster_with_min_savings(&index, 2, 200);
        assert_eq!(
            clusters_200.len(),
            1,
            "Cluster with ~500B gross savings must be accepted because net savings after 168B module overhead is > 200B"
        );
    }
}
