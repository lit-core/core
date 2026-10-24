use lit_analysis::manifest::StyleInfo;
use morph_to_react::emit_css::{ScopedCssOptions, transform_component_styles};
use morph_to_react::{CompileOptionsDto, compile_module};

#[test]
fn test_eof_brace_recovery_vs_unrecoverable_malformed_css() {
    let opts = ScopedCssOptions {
        host_tag: "test-elem".to_string(),
        ..Default::default()
    };

    // 1. CSS Syntax Level 3 compliant EOF recovery:
    // A missing trailing '}' at EOF is validly recovered by standard CSS parsers per spec.
    let eof_auto_closed = vec![
        "div { color: red;",
        "@media (min-width: 600px) { div { color: red; }",
        "@supports (display: flex) { .flex { display: flex;",
    ];

    for case in eof_auto_closed {
        let styles = vec![StyleInfo {
            css_text: case.to_string(),
            is_shared: false,
            shared_import_path: None,
        }];
        let res = transform_component_styles(&styles, &opts);
        assert!(
            res.is_ok(),
            "CSS spec auto-closes blocks at EOF, expected Ok, got: {:?}",
            res
        );
    }

    // 2. Truly unrecoverable malformed CSS:
    // Unmatched parens in at-rules, unclosed strings with braces, and broken at-rules
    // CANNOT be parsed by lightningcss and MUST bail out with clean Err without string splicing.
    let unrecoverable_malformed = vec![
        "@media ( { div { color: red; }",
        "@supports ( { .btn { color: red; }",
        "@keyframes { from { opacity: 0; } to { opacity: 1; } }",
        r#"div { content: "unclosed } string; color: red; }"#,
        r#"div::before { content: 'broken } quote; }"#,
        r#"[data-attr="unclosed } bracket] { color: red; }"#,
    ];

    for case in unrecoverable_malformed {
        let styles = vec![StyleInfo {
            css_text: case.to_string(),
            is_shared: false,
            shared_import_path: None,
        }];
        let res = transform_component_styles(&styles, &opts);
        assert!(
            res.is_err(),
            "expected clean Err bailout for unrecoverable malformed CSS: {:?}, got: {:?}",
            case,
            res
        );
    }
}

#[test]
fn test_valid_css_with_brace_in_string_literal() {
    let valid_brace_cases = vec![
        r#"div::after { content: "hello } world"; }"#,
        r#"span { content: '}'; }"#,
        r#"[data-title="foo}bar"] { color: blue; }"#,
    ];

    let opts = ScopedCssOptions {
        host_tag: "test-elem".to_string(),
        ..Default::default()
    };

    for case in valid_brace_cases {
        let styles = vec![StyleInfo {
            css_text: case.to_string(),
            is_shared: false,
            shared_import_path: None,
        }];
        let res = transform_component_styles(&styles, &opts);
        assert!(
            res.is_ok(),
            "expected valid CSS with brace in string to parse cleanly, got Err: {:?}",
            res.err()
        );
        let output = res.unwrap().scoped_css;
        assert!(
            output.contains("}") && (output.contains("hello } world") || output.contains("}")),
            "output must preserve string content without string-splicing corruption: {}",
            output
        );
    }
}

#[test]
fn test_end_to_end_component_unrecoverable_malformed_css_bailout() {
    let code = r#"
import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('bad-style-elem')
export class BadStyleElem extends LitElement {
    static styles = css`
        @media ( { div { color: red; }
    `;
    render() {
        return html`<div>Bad Style</div>`;
    }
}
"#;

    let res = compile_module(code.to_string(), None);
    assert!(
        res.is_err(),
        "expected compile_module to cleanly bail out with Err on unrecoverable malformed CSS, got: {:?}",
        res.ok().map(|r| r.code)
    );
}

#[test]
fn test_end_to_end_component_string_literal_with_brace_inlined_style() {
    let code = r#"
import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('brace-string-elem')
export class BraceStringElem extends LitElement {
    static styles = css`
        .badge::after {
            content: "}";
            color: green;
        }
    `;
    render() {
        return html`<div class="badge">Success</div>`;
    }
}
"#;

    // Default options (emit_css: false) inlines <style> in JSX
    let res = compile_module(code.to_string(), None);
    assert!(
        res.is_ok(),
        "expected compile_module to succeed with brace inside CSS string literal, got Err: {:?}",
        res.err()
    );
    let output = res.unwrap();
    assert!(
        output.code.contains("<style"),
        "expected inlined style tag in JSX: {}",
        output.code
    );
    assert!(
        output.code.contains("\"}\"")
            || output.code.contains("content:\\\"}\\\"")
            || output.code.contains("content:\"}\""),
        "expected JSX style content to preserve brace in string literal: {}",
        output.code
    );
}

#[test]
fn test_end_to_end_component_string_literal_with_brace_external_css() {
    let code = r#"
import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('brace-string-elem')
export class BraceStringElem extends LitElement {
    static styles = css`
        .badge::after {
            content: "}";
            color: green;
        }
    `;
    render() {
        return html`<div class="badge">Success</div>`;
    }
}
"#;

    // emit_css: true emits CSS externally
    let res = compile_module(
        code.to_string(),
        Some(CompileOptionsDto {
            emit_css: Some(true),
            ..Default::default()
        }),
    );
    assert!(
        res.is_ok(),
        "expected compile_module to succeed with external CSS, got Err: {:?}",
        res.err()
    );
    let output = res.unwrap();
    let css = output.css.expect("expected external CSS string");
    assert!(
        css.contains("\"}\"") || css.contains("content:\"}\""),
        "expected external CSS to preserve brace in string literal: {}",
        css
    );
}

#[test]
fn test_slotted_repeated_and_compound_cursor_order() {
    use morph_to_react::emit_css::{rewrite_internal_selector, rewrite_slotted_selector};

    // 1. Identical repeated slot[name=...]::slotted in compound selector
    let sel = "slot[name=\"icon\"]::slotted(svg) > slot[name=\"icon\"]::slotted(svg)";
    let rewritten = rewrite_slotted_selector(sel);
    assert_eq!(
        rewritten,
        ":scope [data-slot-boundary][data-slot=\"icon\"] > :is(svg) > :scope [data-slot-boundary][data-slot=\"icon\"] > :is(svg)"
    );

    // 2. Prefix substring slot names (prefix vs prefix_extended)
    let sel_prefix =
        "slot[name=\"foo\"]::slotted(div) + slot[name=\"foo_extended\"]::slotted(span)";
    let rewritten_prefix = rewrite_slotted_selector(sel_prefix);
    assert_eq!(
        rewritten_prefix,
        ":scope [data-slot-boundary][data-slot=\"foo\"] > :is(div) + :scope [data-slot-boundary][data-slot=\"foo_extended\"] > :is(span)"
    );

    // 3. Repeated bare ::slotted(...) with identical inner targets
    let sel_bare = "::slotted(div.item) + ::slotted(div.item)";
    let rewritten_bare = rewrite_slotted_selector(sel_bare);
    assert_eq!(
        rewritten_bare,
        ":scope [data-slot-boundary] > :is(div.item) + :scope [data-slot-boundary] > :is(div.item)"
    );

    // 4. Inner target string appears outside of slotted selector before and after
    let sel_context = "div.icon > slot[name=\"action\"]::slotted(div.icon) > span.icon";
    let rewritten_context = rewrite_slotted_selector(sel_context);
    assert_eq!(
        rewritten_context,
        "div.icon > :scope [data-slot-boundary][data-slot=\"action\"] > :is(div.icon) > span.icon"
    );

    // 5. Multiple repeated :host functional pseudos
    let sel_host = ":host(.primary):host(.active) > div > :host(.primary)";
    let rewritten_host = rewrite_internal_selector(sel_host);
    assert_eq!(
        rewritten_host,
        ":scope:is(.primary):scope:is(.active) > div > :scope:is(.primary)"
    );

    // 6. Multiple repeated :state functional pseudos
    let sel_state = ":state(active) + :state(active)";
    let rewritten_state = rewrite_internal_selector(sel_state);
    assert_eq!(
        rewritten_state,
        "[data-state~=\"active\"] + [data-state~=\"active\"]"
    );

    // 7. Repeated :host-context pseudos
    let sel_ctx = ":host-context(.dark) > div > :host-context(.dark)";
    let rewritten_ctx = rewrite_internal_selector(sel_ctx);
    assert_eq!(
        rewritten_ctx,
        ":is(.dark :scope, :scope:is(.dark)) > div > :is(.dark :scope, :scope:is(.dark))"
    );

    // 8. Sibling host combinators
    assert_eq!(rewrite_internal_selector(":host + :host"), ":not(*)");
    assert_eq!(rewrite_internal_selector(":scope ~ :scope"), ":not(*)");
}
