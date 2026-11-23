use server_split::{ServerSplitOptions, transform_code};

fn worker(params: &str) -> String {
    let source = format!(
        r#"
import {{ LitElement, html }} from 'lit';
import {{ action }} from '@lit-core/server-elements';
export class DefaultsComponent extends LitElement {{
    static properties = {{ n: {{ type: Number }} }};
    @action()
    async save({params}) {{ this.n = 1; }}
    render() {{ return html`<p>${{this.n}}</p>`; }}
}}
customElements.define('defaults-component', DefaultsComponent);
"#
    );
    let res = transform_code(&source, ServerSplitOptions::default());
    assert!(!res.has_errors, "{:?}", res.diagnostics);
    res.worker_code
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("")
}

#[test]
fn a_parameter_with_a_default_value_may_be_omitted() {
    let code = worker("name: string, tags: string[] = []");
    assert!(code.contains("if(p1!==undefined)"), "{code}");
}

#[test]
fn a_parameter_with_a_default_is_still_type_checked_when_given() {
    let code = worker("qty: number = 1");
    assert!(code.contains("if(p0!==undefined)"), "{code}");
    assert!(
        code.contains("Invalidargument'qty':expectednumber"),
        "{code}"
    );
}

#[test]
fn required_parameters_stay_required() {
    let code = worker("name: string, qty: number");
    assert!(!code.contains("if(p0!==undefined)"), "{code}");
    assert!(!code.contains("if(p1!==undefined)"), "{code}");
}
