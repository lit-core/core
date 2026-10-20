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
