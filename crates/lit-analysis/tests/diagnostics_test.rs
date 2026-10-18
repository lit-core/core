use lit_analysis::analyze_lit_module;
use lit_analysis::diagnostics::DiagnosticCode;
use oxc_allocator::Allocator;

#[test]
fn test_diagnostics_with_universal_lit_hints() {
    let source = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';

        class UnresolvableComponent extends LitElement {
            render() {
                return html`<div>${until(Promise.resolve(1))}</div>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "unsupported.js").unwrap();

    let diag = result
        .diagnostics
        .iter()
        .find(|d| d.code == DiagnosticCode::LitBailUnsupportedDirective)
        .unwrap();
    assert_eq!(diag.code.as_str(), "LIT101");
    assert!(
        diag.universal_lit_hint.contains("@lit/task"),
        "Must suggest @lit/task as Universal Lit alternative"
    );
}
