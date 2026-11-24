use server_split::{ServerSplitOptions, transform_code};

fn diagnostics_for(property: &str) -> Vec<(String, String)> {
    let source = format!(
        r#"
import {{ LitElement, html }} from 'lit';
import {{ state }} from 'lit/decorators.js';
import {{ action }} from '@lit-core/server-elements';
export class StateTypeComponent extends LitElement {{
    {property}
    @action()
    async save() {{ this.n = 1; }}
    @state() n = 0;
    render() {{ return html`<p>${{this.n}}</p>`; }}
}}
customElements.define('state-type-component', StateTypeComponent);
"#
    );
    transform_code(&source, ServerSplitOptions::default())
        .diagnostics
        .into_iter()
        .map(|d| (d.code, d.message))
        .collect()
}

fn flagged(property: &str) -> Option<String> {
    diagnostics_for(property)
        .into_iter()
        .find(|(code, _)| code == "SE109")
        .map(|(_, message)| message)
}

#[test]
fn collections_and_dates_are_flagged_with_the_property_name() {
    for (declaration, kind) in [
        ("@state() tags: Set<string> = new Set();", "Set"),
        ("@state() byId: Map<string, number> = new Map();", "Map"),
        ("@state() at: Date = new Date(0);", "Date"),
    ] {
        let message = flagged(declaration).unwrap_or_else(|| panic!("{declaration} not flagged"));
        assert!(message.contains(kind), "{message}");
    }
}

#[test]
fn the_type_is_found_inside_arrays_unions_and_object_types() {
    for declaration in [
        "@state() lists: Set<string>[] = [];",
        "@state() maybe: Map<string, number> | null = null;",
        "@state() shape: { when: Date } = { when: new Date(0) };",
        "@state() pair: [string, Set<number>] = ['a', new Set()];",
        "@state() callback: () => void = () => {};",
    ] {
        assert!(flagged(declaration).is_some(), "{declaration} not flagged");
    }
}

#[test]
fn plain_data_types_pass() {
    for declaration in [
        "@state() tags: string[] = [];",
        "@state() byId: Record<string, number> = {};",
        "@state() entries: Array<[string, number]> = [];",
        "@state() when: string | null = null;",
        "@state() nested: { a: number[]; b: { c: boolean } } = { a: [], b: { c: false } };",
    ] {
        assert!(flagged(declaration).is_none(), "{declaration} flagged");
    }
}

#[test]
fn a_field_that_is_not_reactive_is_left_alone() {
    assert!(flagged("private cache: Map<string, number> = new Map();").is_none());
}

#[test]
fn the_original_source_is_checked_before_decorator_lowering_strips_the_annotations() {
    let source = r#"
import { LitElement, html } from 'lit';
import { state } from 'lit/decorators.js';
import { action } from '@lit-core/server-elements';
export class FromOriginal extends LitElement {
    static properties = { viaStatic: { type: Object } };
    declare viaStatic: Map<string, number>;
    @state() tags: Set<string> = new Set();
    @state() fine: string[] = [];
    private cache: Map<string, number> = new Map();
    @action()
    async save() { this.fine = []; }
    render() { return html`<p></p>`; }
}
customElements.define('from-original', FromOriginal);
"#;
    let found = server_split::state_types::check_source(source, "component.ts");
    let names: Vec<&str> = found
        .iter()
        .filter(|d| d.code == "SE109")
        .map(|d| d.message.as_str())
        .collect();
    assert_eq!(names.len(), 2, "{names:?}");
    assert!(names.iter().any(|m| m.contains("'tags'")), "{names:?}");
    assert!(names.iter().any(|m| m.contains("'viaStatic'")), "{names:?}");
}

#[test]
fn a_class_without_server_methods_is_not_checked() {
    let source = r#"
import { LitElement } from 'lit';
import { state } from 'lit/decorators.js';
export class Plain extends LitElement {
    @state() tags: Set<string> = new Set();
}
"#;
    assert!(server_split::state_types::check_source(source, "plain.ts").is_empty());
}
