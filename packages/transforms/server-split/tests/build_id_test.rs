use server_split::{ServerSplitOptions, compute_build_id, transform_code};

fn source(extra: &str) -> String {
    format!(
        r#"
import {{ LitElement, html }} from 'lit';
import {{ action }} from '@lit-core/server-elements';
export class BuildIdComponent extends LitElement {{
    static properties = {{ n: {{ type: Number }} }};
    @action()
    async save() {{ this.n = 1; {extra} }}
    render() {{ return html`<p>${{this.n}}</p>`; }}
}}
customElements.define('build-id-component', BuildIdComponent);
"#
    )
}

/// The `__litBuildId` literal stamped on an output, or none when the output does not carry one.
fn stamped_id(code: &str) -> Option<String> {
    let after = code.split("__litBuildId").nth(1)?;
    let start = after.find('"')? + 1;
    let end = start + after[start..].find('"')?;
    Some(after[start..end].to_string())
}

#[test]
fn an_unconfigured_build_id_is_derived_from_the_source_not_a_shared_default() {
    let res = transform_code(&source(""), ServerSplitOptions::default());
    assert!(!res.has_errors, "{:?}", res.diagnostics);
    let id = stamped_id(&res.worker_code).expect("worker output carries a build id");
    assert_ne!(id, "dev");
    assert_eq!(id.len(), 16);
    assert_eq!(id, compute_build_id(&source("")));
}

#[test]
fn the_client_and_worker_outputs_carry_the_same_id() {
    let res = transform_code(&source(""), ServerSplitOptions::default());
    assert_eq!(stamped_id(&res.client_code), stamped_id(&res.worker_code));
    assert!(stamped_id(&res.client_code).is_some());
}

#[test]
fn the_same_source_always_gets_the_same_id() {
    let a = transform_code(&source(""), ServerSplitOptions::default());
    let b = transform_code(&source(""), ServerSplitOptions::default());
    assert_eq!(stamped_id(&a.worker_code), stamped_id(&b.worker_code));
}

#[test]
fn changing_the_source_changes_the_id_so_pages_from_the_old_build_are_refused() {
    let before = transform_code(&source(""), ServerSplitOptions::default());
    let after = transform_code(&source("this.n = 2;"), ServerSplitOptions::default());
    assert_ne!(
        stamped_id(&before.worker_code),
        stamped_id(&after.worker_code)
    );
}

#[test]
fn an_explicit_build_id_wins() {
    let options = ServerSplitOptions {
        build_id: Some("release-42".to_string()),
        ..ServerSplitOptions::default()
    };
    let res = transform_code(&source(""), options);
    assert_eq!(stamped_id(&res.worker_code).as_deref(), Some("release-42"));
    assert_eq!(stamped_id(&res.client_code).as_deref(), Some("release-42"));
}
