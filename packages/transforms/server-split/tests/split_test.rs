use server_split::{ServerSplitOptions, transform_code};

#[test]
fn test_uncompiled_passthrough() {
    let source = "export class PlainClass { hello() { return 'world'; } }";
    let res = transform_code(source, ServerSplitOptions::default());
    assert!(!res.is_server_element);
    assert_eq!(res.client_code, source);
    assert_eq!(res.worker_code, source);
    assert!(res.actions.is_empty());
    assert!(res.loaders.is_empty());
}

#[test]
fn test_basic_server_element_split() {
    let source = r#"
import { LitElement, html } from 'lit';
import { loader, action } from '@lit-core/server-elements';

export class CounterElement extends LitElement {
    static properties = {
        count: { type: Number },
    };

    @loader()
    async initialCount(start: number) {
        this.count = start;
    }

    @action()
    async increment(amount: number) {
        this.count += amount;
    }

    render() {
        return html`<span>${this.count}</span>`;
    }
}
"#;

    let res = transform_code(source, ServerSplitOptions::default());
    assert!(res.is_server_element);
    assert!(!res.has_errors);
    assert_eq!(res.class_name, Some("CounterElement".to_string()));

    // Worker checks
    assert!(
        res.worker_code
            .contains("class CounterElement extends LitElement")
    );
    assert!(
        res.worker_code
            .contains("async initialCount(start: number)")
    );
    assert!(res.worker_code.contains("async increment(amount: number)"));
    assert!(res.worker_code.contains("render()"));
    assert!(res.worker_code.contains("CounterElement.__lit_actions ="));
    assert!(res.worker_code.contains("CounterElement.__lit_loaders ="));
    assert!(res.worker_code.contains("__lit_validate_increment"));
    assert!(!res.worker_code.contains("@loader()"));
    assert!(!res.worker_code.contains("@action()"));

    // Client checks (zero-Lit HTMLElement)
    assert!(
        res.client_code
            .contains("import { __litActionRpc } from \"@lit-core/server-elements/client\";")
    );
    assert!(
        res.client_code
            .contains("class CounterElement extends HTMLElement")
    );
    assert!(res.client_code.contains("constructor()"));
    assert!(res.client_code.contains("super();"));
    assert!(res.client_code.contains("async increment(amount: number)"));
    assert!(res.client_code.contains("__litActionRpc(this,"));
    assert!(!res.client_code.contains("initialCount"));
    assert!(!res.client_code.contains("render()"));
    assert!(!res.client_code.contains("from \"lit\""));

    assert_eq!(res.actions.len(), 1);
    assert_eq!(res.actions[0].name, "increment");
    assert_eq!(res.loaders.len(), 1);
    assert_eq!(res.loaders[0].name, "initialCount");
}

#[test]
fn test_custom_element_tag_detection() {
    let source = r#"
import { LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { action } from '@lit-core/server-elements';

@customElement('my-counter')
export class MyCounter extends LitElement {
    static properties = { count: { type: Number } };

    @action()
    async reset() {
        this.count = 0;
    }
}
"#;

    let res = transform_code(source, ServerSplitOptions::default());
    assert!(res.is_server_element);
    assert_eq!(res.tag_name, Some("my-counter".to_string()));
}
