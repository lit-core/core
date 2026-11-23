use server_split::{ServerSplitOptions, transform_code};

fn component(body: &str) -> String {
    format!(
        r#"
import {{ LitElement, html }} from 'lit';
import {{ loader, action }} from '@lit-core/server-elements';

export class OptionsComponent extends LitElement {{
    static properties = {{
        user: {{ type: Object }},
        posts: {{ type: Array }},
        count: {{ type: Number }},
    }};

{body}

    render() {{
        return html`<div>${{this.count}}</div>`;
    }}
}}
customElements.define('options-component', OptionsComponent);
"#
    )
}

fn compile(body: &str) -> server_split::ServerSplitResult {
    transform_code(&component(body), ServerSplitOptions::default())
}

fn squash(code: &str) -> String {
    code.split_whitespace().collect::<Vec<_>>().join("")
}

#[test]
fn loaders_get_their_own_write_sets() {
    let res = compile(
        r#"
    @loader()
    async loadUser() { this.user = {}; }

    @loader()
    async loadPosts() { this.posts = []; }
"#,
    );
    assert!(!res.has_errors, "{:?}", res.diagnostics);
    let worker = squash(&res.worker_code);
    assert!(
        worker.contains(r#""loadUser":{writes:["user"]}"#),
        "{worker}"
    );
    assert!(
        worker.contains(r#""loadPosts":{writes:["posts"]}"#),
        "{worker}"
    );
}

#[test]
fn loader_dependencies_are_emitted() {
    let res = compile(
        r#"
    @loader({ dependencies: ['count', 'user'] })
    async loadPosts() { this.posts = []; }
"#,
    );
    assert!(!res.has_errors, "{:?}", res.diagnostics);
    let worker = squash(&res.worker_code);
    assert!(
        worker.contains(r#"dependencies:["count","user"]"#),
        "{worker}"
    );
}

#[test]
fn action_revalidate_false_is_emitted() {
    let res = compile(
        r#"
    @action({ revalidate: false })
    async bump(by: number) { this.count += by; }
"#,
    );
    assert!(!res.has_errors, "{:?}", res.diagnostics);
    assert!(squash(&res.worker_code).contains("revalidate:false"));
}

#[test]
fn omitted_options_emit_nothing_extra() {
    let res = compile(
        r#"
    @loader()
    async loadUser() { this.user = {}; }

    @action()
    async bump(by: number) { this.count += by; }
"#,
    );
    let worker = squash(&res.worker_code);
    assert!(!worker.contains("dependencies"));
    assert!(!worker.contains("revalidate"));
}

#[test]
fn non_literal_or_unknown_options_are_rejected() {
    for (decorator, expected) in [
        (
            "@loader({ dependencies: someList })",
            "array of string literals",
        ),
        (
            "@loader({ revalidate: false })",
            "Unknown @loader() option 'revalidate'",
        ),
        (
            "@action({ dependencies: ['x'] })",
            "Unknown @action() option 'dependencies'",
        ),
        (
            "@action({ revalidate: shouldRevalidate })",
            "boolean literal",
        ),
        ("@loader(options)", "object literal"),
    ] {
        let method = if decorator.starts_with("@loader") {
            "async load() { this.user = {}; }"
        } else {
            "async bump(by: number) { this.count += by; }"
        };
        let res = compile(&format!("    {decorator}\n    {method}"));
        let diagnostic = res
            .diagnostics
            .iter()
            .find(|d| d.code == "SE107")
            .unwrap_or_else(|| panic!("expected SE107 for {decorator}: {:?}", res.diagnostics));
        assert!(
            diagnostic.message.contains(expected),
            "{decorator}: {}",
            diagnostic.message
        );
        assert!(res.has_errors);
    }
}

#[test]
fn action_form_gets_the_client_runtime_without_event_bindings() {
    let source = r#"
import { html } from 'lit';
import { action, ServerElement } from '@lit-core/server-elements';

export class FormComponent extends ServerElement {
    static properties = { note: { type: String } };

    @action()
    async save(fields: { note: string }) { this.note = fields.note; }

    render() {
        return html`<form method="post" action=${this.actionUrl('save')}><input name="note"></form>`;
    }
}
customElements.define('form-component', FormComponent);
"#;
    let res = transform_code(source, ServerSplitOptions::default());
    assert!(!res.has_errors, "{:?}", res.diagnostics);
    let client = squash(&res.client_code);
    assert!(client.contains("connectedCallback"), "{client}");
    assert!(client.contains("__litBindEvents"), "{client}");
}

#[test]
fn templates_without_events_or_action_forms_stay_free_of_the_event_runtime() {
    let res = compile(
        r#"
    @action()
    async bump(by: number) { this.count += by; }
"#,
    );
    let client = squash(&res.client_code);
    assert!(!client.contains("connectedCallback"), "{client}");
    assert!(!client.contains("__litBindEvents"), "{client}");
}
