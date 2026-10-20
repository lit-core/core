use css_minifier::{transform_embedded_css, MinifyCssOptions};

#[test]
fn test_challenge_css_minifier_aliased_import() {
    let input = r#"
        import { css as c } from 'lit';
        const s = c`
            .foo {
                color: red;
                margin: 0px 0px 0px 0px;
            }
        `;
    "#;
    let res = transform_embedded_css(input, MinifyCssOptions::default());
    assert_eq!(res.minified_templates, 1);
    assert!(res.bytes_saved > 0);
    assert!(
        res.code.contains(".foo{color:red;margin:0}")
            || res.code.contains(".foo{color:#f00;margin:0}"),
        "Output code must be minified, got: {}",
        res.code
    );
}

#[test]
fn test_challenge_css_minifier_shadowed_identifiers() {
    // 1. Standalone unimported css function
    let input_unimported = r#"
        const css = (s: any) => s;
        const s = css`
            .foo {
                color: red;
                margin: 0px 0px 0px 0px;
            }
        `;
    "#;
    let res1 = transform_embedded_css(input_unimported, MinifyCssOptions::default());
    assert_eq!(res1.minified_templates, 0);
    assert_eq!(res1.bytes_saved, 0);
    assert_eq!(res1.code, input_unimported);

    // 2. Inner function scope shadowing imported css
    let input_shadowed = r#"
        import { css } from 'lit';
        const real = css`
            .real {
                margin: 0px 0px;
            }
        `;
        function test() {
            const css = (s: any) => s;
            const fake = css`
                .foo {
                    color: red;
                    margin: 0px 0px 0px 0px;
                }
            `;
            return fake;
        }
    "#;
    let res2 = transform_embedded_css(input_shadowed, MinifyCssOptions::default());
    assert_eq!(res2.minified_templates, 1);
    assert!(res2.code.contains(".real{margin:0}"));
    assert!(
        res2.code.contains("margin: 0px 0px 0px 0px;"),
        "Shadowed template must not be minified"
    );

    // 3. Function parameter shadowing imported css
    let input_param = r#"
        import { css } from 'lit';
        function render(css: any) {
            return css`
                .param {
                    margin: 0px 0px 0px 0px;
                }
            `;
        }
    "#;
    let res3 = transform_embedded_css(input_param, MinifyCssOptions::default());
    assert_eq!(res3.minified_templates, 0);
    assert_eq!(res3.bytes_saved, 0);
    assert!(res3.code.contains("margin: 0px 0px 0px 0px;"));
}

#[test]
fn test_challenge_css_minifier_non_lit_files() {
    // 1. styled-components file
    let input_styled = r#"
        import styled from 'styled-components';
        const Button = styled.button`
            color: red;
            margin: 0px 0px;
        `;
    "#;
    let res1 = transform_embedded_css(input_styled, MinifyCssOptions::default());
    assert_eq!(res1.minified_templates, 0);
    assert_eq!(res1.bytes_saved, 0);
    assert_eq!(res1.code, input_styled);

    // 2. Emotion css file
    let input_emotion = r#"
        import { css } from '@emotion/react';
        const s = css`
            .box {
                margin: 0px 0px 0px 0px;
            }
        `;
    "#;
    let res2 = transform_embedded_css(input_emotion, MinifyCssOptions::default());
    assert_eq!(res2.minified_templates, 0);
    assert_eq!(res2.bytes_saved, 0);
    assert_eq!(res2.code, input_emotion);

    // 3. Zero-import vanilla JS file with random template literals
    let input_vanilla = r#"
        const tag = (x: any) => x;
        const msg = tag`hello world`;
        const num = 42;
    "#;
    let res3 = transform_embedded_css(input_vanilla, MinifyCssOptions::default());
    assert_eq!(res3.minified_templates, 0);
    assert_eq!(res3.bytes_saved, 0);
    assert_eq!(res3.code, input_vanilla);
}
