use server_split::{ServerSplitOptions, transform_code};

#[test]
fn test_validator_primitives_and_unions() {
    let source = r#"
import { LitElement } from 'lit';
import { action } from '@lit-core/server-elements';

export class FormElement extends LitElement {
    static properties = {
        status: { type: String },
    };

    @action()
    async submit(name: string, age: number, active: boolean, role: 'admin' | 'user') {
        this.status = `${name}-${role}`;
    }
}
"#;

    let res = transform_code(source, ServerSplitOptions::default());
    assert!(res.is_server_element);
    assert!(!res.has_errors);
    assert!(res.worker_code.contains("__lit_validate_submit(args)"));
    assert!(res.worker_code.contains("typeof p0 !== \"string\""));
    assert!(res.worker_code.contains("!Number.isFinite(p1)"));
    assert!(res.worker_code.contains("typeof p2 !== \"boolean\""));
    assert!(
        res.worker_code
            .contains("p3 !== \"admin\" && p3 !== \"user\"")
    );
}

#[test]
fn test_validator_missing_type_annotation_se105() {
    let source = r#"
import { LitElement } from 'lit';
import { action } from '@lit-core/server-elements';

export class UntypedActionElement extends LitElement {
    @action()
    async submit(rawArg) {
        // no type
    }
}
"#;

    let res = transform_code(source, ServerSplitOptions::default());
    assert!(res.is_server_element);
    assert!(res.has_errors);
    let se105 = res.diagnostics.iter().find(|d| d.code == "SE105");
    assert!(
        se105.is_some(),
        "Expected SE105 for untyped action parameter"
    );
}

#[test]
fn test_validator_unsupported_complex_type_se102() {
    let source = r#"
import { LitElement } from 'lit';
import { action } from '@lit-core/server-elements';

export class FunctionParamElement extends LitElement {
    @action()
    async run(callback: () => void) {
        callback();
    }
}
"#;

    let res = transform_code(source, ServerSplitOptions::default());
    assert!(res.is_server_element);
    assert!(res.has_errors);
    let se102 = res.diagnostics.iter().find(|d| d.code == "SE102");
    assert!(
        se102.is_some(),
        "Expected SE102 for unsupported function parameter type"
    );
}
