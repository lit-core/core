use server_split::{ServerSplitOptions, transform_code};

fn diagnostics_for(method: &str, decorator: &str) -> Vec<(String, String)> {
    let source = format!(
        r#"
import {{ LitElement, html }} from 'lit';
import {{ action, loader }} from '@lit-core/server-elements';
export class ReservedComponent extends LitElement {{
    static properties = {{ n: {{ type: Number }} }};
    @{decorator}()
    async {method}() {{ this.n = 1; }}
    render() {{ return html`<p>${{this.n}}</p>`; }}
}}
customElements.define('reserved-component', ReservedComponent);
"#
    );
    transform_code(&source, ServerSplitOptions::default())
        .diagnostics
        .into_iter()
        .map(|d| (d.code, d.message))
        .collect()
}

#[test]
fn an_action_named_like_a_dom_method_is_rejected() {
    let found = diagnostics_for("remove", "action");
    let (_, message) = found
        .iter()
        .find(|(code, _)| code == "SE108")
        .unwrap_or_else(|| panic!("expected SE108: {found:?}"));
    assert!(message.contains("'remove'"), "{message}");
    assert!(message.contains("@action()"), "{message}");
}

#[test]
fn a_loader_named_like_a_lit_member_is_rejected_too() {
    let found = diagnostics_for("requestUpdate", "loader");
    assert!(found.iter().any(|(code, _)| code == "SE108"), "{found:?}");
}

#[test]
fn ordinary_names_pass() {
    for (method, decorator) in [
        ("removeTask", "action"),
        ("add", "action"),
        ("load", "loader"),
    ] {
        let found = diagnostics_for(method, decorator);
        assert!(
            found.iter().all(|(code, _)| code != "SE108"),
            "{method}: {found:?}"
        );
    }
}

fn pending_source() -> &'static str {
    r#"
import { LitElement, html } from 'lit';
import { loader } from '@lit-core/server-elements';
export class PendingComponent extends LitElement {
    static properties = { total: { state: true } };
    @loader()
    async load() { this.total = 3; }
    renderPending() { return html`<p class="skeleton">Counting</p>`; }
    render() { return html`<p>${this.total}</p>`; }
}
customElements.define('pending-component', PendingComponent);
"#
}

#[test]
fn render_pending_is_accepted_as_a_server_only_method() {
    let res = transform_code(pending_source(), ServerSplitOptions::default());
    assert!(!res.has_errors, "{:?}", res.diagnostics);
    assert!(
        res.zero_lit,
        "the element must still lower to a zero-Lit stub"
    );
}

#[test]
fn render_pending_stays_in_the_worker_and_never_reaches_the_client() {
    let res = transform_code(pending_source(), ServerSplitOptions::default());
    assert!(
        res.worker_code.contains("renderPending"),
        "{}",
        res.worker_code
    );
    assert!(res.worker_code.contains("skeleton"));
    assert!(
        !res.client_code.contains("renderPending"),
        "{}",
        res.client_code
    );
    assert!(!res.client_code.contains("skeleton"));
}
