use server_split::{ServerSplitOptions, transform_code};

#[test]
fn test_isolation_proof_clean() {
    let source = r#"
import { LitElement, html } from 'lit';
import { loader, action } from '@lit-core/server-elements';

export class SafeComponent extends LitElement {
    static properties = {
        title: { type: String },
    };

    @loader()
    async load(tenantId: string) {
        this.title = `Tenant ${tenantId}`;
    }

    render() {
        return html`<h1>${this.title}</h1>`;
    }
}
"#;

    let res = transform_code(source, ServerSplitOptions::default());
    assert!(res.is_server_element);
    assert!(!res.has_errors);
    assert!(res.diagnostics.is_empty());
}

#[test]
fn test_isolation_proof_node_builtin_leak() {
    let source = r#"
import { LitElement, html } from 'lit';
import { loader } from '@lit-core/server-elements';
import { readFileSync } from 'fs';

export class LeakyComponent extends LitElement {
    static properties = {
        data: { type: String },
    };

    @loader()
    async load() {
        this.data = readFileSync('secret.txt', 'utf-8');
    }

    render() {
        return html`<div>${readFileSync('header.txt', 'utf-8')}</div>`;
    }
}
"#;

    let res = transform_code(source, ServerSplitOptions::default());
    assert!(res.is_server_element);
    assert!(res.has_errors);
    let se101 = res.diagnostics.iter().find(|d| d.code == "SE101");
    assert!(
        se101.is_some(),
        "Expected SE101 diagnostic for leaked node builtin"
    );
    assert!(se101.unwrap().message.contains("readFileSync"));
}

#[test]
fn test_isolation_proof_server_package_leak() {
    let source = r#"
import { LitElement, html } from 'lit';
import { loader } from '@lit-core/server-elements';
import { queryDatabase } from '@db/postgres.server';

export class DbComponent extends LitElement {
    static properties = {
        items: { type: Array },
    };

    @loader()
    async load() {
        this.items = queryDatabase('SELECT * FROM items');
    }

    render() {
        queryDatabase('SELECT title');
        return html`<div>Items</div>`;
    }
}
"#;

    let res = transform_code(source, ServerSplitOptions::default());
    assert!(res.is_server_element);
    assert!(res.has_errors);
    let se101 = res.diagnostics.iter().find(|d| d.code == "SE101");
    assert!(
        se101.is_some(),
        "Expected SE101 diagnostic for leaked .server package"
    );
}
