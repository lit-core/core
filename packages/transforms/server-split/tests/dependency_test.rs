use server_split::{ServerSplitOptions, transform_code};

#[test]
fn test_render_invoking_loader_se104() {
    let source = r#"
import { LitElement, html } from 'lit';
import { loader } from '@lit-core/server-elements';

export class InvalidRenderComponent extends LitElement {
    static properties = {
        data: { type: String },
    };

    @loader()
    async fetchData(id: string) {
        this.data = id;
    }

    render() {
        this.fetchData('123');
        return html`<div>${this.data}</div>`;
    }
}
"#;

    let res = transform_code(source, ServerSplitOptions::default());
    assert!(res.is_server_element);
    assert!(res.has_errors);
    let se104 = res.diagnostics.iter().find(|d| d.code == "SE104");
    assert!(
        se104.is_some(),
        "Expected SE104 for render() invoking @loader()"
    );
}

#[test]
fn test_undeclared_reactive_property_se103() {
    let source = r#"
import { LitElement, html } from 'lit';
import { loader } from '@lit-core/server-elements';

export class UndeclaredPropComponent extends LitElement {
    // missing static properties count

    @loader()
    async init() {
        this.count = 42;
    }

    render() {
        return html`<div>Ready</div>`;
    }
}
"#;

    let res = transform_code(source, ServerSplitOptions::default());
    assert!(res.is_server_element);
    let se103 = res.diagnostics.iter().find(|d| d.code == "SE103");
    assert!(
        se103.is_some(),
        "Expected SE103 warning for undeclared property write"
    );
    assert_eq!(se103.unwrap().severity, "warning");
}
