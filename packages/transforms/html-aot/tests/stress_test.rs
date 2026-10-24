use html_aot::transform_html_aot;
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

#[test]
fn test_predeclared_identifiers_collision_avoidance() {
    let code = r#"
import { html } from 'lit';

const b_1 = "user_b1";
const A_1 = "user_A1";
const P_1 = "user_P1";
const B_1 = "user_B1";
const E_1 = "user_E1";
const litHtmlPrivate_1 = "user_litHtmlPrivate_1";
const lit_template_1 = "user_lit_template_1";

export const myTemplate = html`
  <div 
    id=${id}
    attr=${attrVal} 
    .prop=${propVal} 
    ?bool=${boolVal} 
    @click=${clickHandler}
  >${childVal}</div>
`;
"#;

    let res = transform_html_aot(code.to_string(), None);
    assert_eq!(res.templates_count, 1);

    // Verify allocated identifiers are bumped to _2
    assert!(
        res.code.contains("const b_2 = (i) => i;"),
        "expected b_2 brand function, got:\n{}",
        res.code
    );
    assert!(
        res.code.contains("import * as litHtmlPrivate_2 from"),
        "expected litHtmlPrivate_2 import, got:\n{}",
        res.code
    );
    assert!(
        res.code.contains("AttributePart: A_2"),
        "expected AttributePart: A_2, got:\n{}",
        res.code
    );
    assert!(
        res.code.contains("PropertyPart: P_2"),
        "expected PropertyPart: P_2, got:\n{}",
        res.code
    );
    assert!(
        res.code.contains("BooleanAttributePart: B_2"),
        "expected BooleanAttributePart: B_2, got:\n{}",
        res.code
    );
    assert!(
        res.code.contains("EventPart: E_2"),
        "expected EventPart: E_2, got:\n{}",
        res.code
    );
    assert!(
        res.code.contains("const lit_template_2 ="),
        "expected lit_template_2 descriptor, got:\n{}",
        res.code
    );

    // Verify user pre-declarations are preserved untouched
    assert!(res.code.contains("const b_1 = \"user_b1\";"));
    assert!(res.code.contains("const A_1 = \"user_A1\";"));
    assert!(res.code.contains("const P_1 = \"user_P1\";"));
    assert!(res.code.contains("const B_1 = \"user_B1\";"));
    assert!(res.code.contains("const E_1 = \"user_E1\";"));
    assert!(
        res.code
            .contains("const litHtmlPrivate_1 = \"user_litHtmlPrivate_1\";")
    );
    assert!(
        res.code
            .contains("const lit_template_1 = \"user_lit_template_1\";")
    );

    // Verify generated code is syntactically valid via oxc_parser
    let allocator = Allocator::default();
    let parsed = Parser::new(
        &allocator,
        &res.code,
        SourceType::default().with_module(true),
    )
    .parse();
    assert!(
        parsed.diagnostics.is_empty(),
        "generated code has syntax errors: {:?}",
        parsed.diagnostics
    );
}

#[test]
fn test_escalated_double_collision_avoidance() {
    let code = r#"
import { html } from 'lit';

const b_1 = 1, b_2 = 2;
const A_1 = 1, A_2 = 2;
const P_1 = 1, P_2 = 2;
const B_1 = 1, B_2 = 2;
const E_1 = 1, E_2 = 2;
const litHtmlPrivate_1 = 1, litHtmlPrivate_2 = 2;
const lit_template_1 = 1, lit_template_2 = 2;

export const myTemplate = html`
  <div 
    attr=${attrVal} 
    .prop=${propVal} 
    ?bool=${boolVal} 
    @click=${clickHandler}
  >${childVal}</div>
`;
"#;

    let res = transform_html_aot(code.to_string(), None);
    assert_eq!(res.templates_count, 1);

    // Verify allocated identifiers are bumped to _3
    assert!(
        res.code.contains("const b_3 = (i) => i;"),
        "expected b_3 brand function, got:\n{}",
        res.code
    );
    assert!(
        res.code.contains("import * as litHtmlPrivate_3 from"),
        "expected litHtmlPrivate_3 import, got:\n{}",
        res.code
    );
    assert!(
        res.code.contains("AttributePart: A_3"),
        "expected AttributePart: A_3, got:\n{}",
        res.code
    );
    assert!(
        res.code.contains("PropertyPart: P_3"),
        "expected PropertyPart: P_3, got:\n{}",
        res.code
    );
    assert!(
        res.code.contains("BooleanAttributePart: B_3"),
        "expected BooleanAttributePart: B_3, got:\n{}",
        res.code
    );
    assert!(
        res.code.contains("EventPart: E_3"),
        "expected EventPart: E_3, got:\n{}",
        res.code
    );
    assert!(
        res.code.contains("const lit_template_3 ="),
        "expected lit_template_3 descriptor, got:\n{}",
        res.code
    );

    // Verify AST syntax validity
    let allocator = Allocator::default();
    let parsed = Parser::new(
        &allocator,
        &res.code,
        SourceType::default().with_module(true),
    )
    .parse();
    assert!(
        parsed.diagnostics.is_empty(),
        "generated code has syntax errors: {:?}",
        parsed.diagnostics
    );
}

#[test]
fn test_multiple_templates_with_predeclared_descriptors() {
    let code = r#"
import { html } from 'lit';

const lit_template_1 = "user_tmpl_1";
const lit_template_2 = "user_tmpl_2";

export const t1 = html`<span class="first">${val1}</span>`;
export const t2 = html`<span class="second">${val2}</span>`;
export const t3 = html`<span class="third">${val3}</span>`;
"#;

    let res = transform_html_aot(code.to_string(), None);
    assert_eq!(res.templates_count, 3);

    // Descriptors should be lit_template_3, lit_template_4, lit_template_5
    assert!(res.code.contains("const lit_template_3 ="));
    assert!(res.code.contains("const lit_template_4 ="));
    assert!(res.code.contains("const lit_template_5 ="));

    // User variables preserved
    assert!(res.code.contains("const lit_template_1 = \"user_tmpl_1\";"));
    assert!(res.code.contains("const lit_template_2 = \"user_tmpl_2\";"));

    // Syntax validation
    let allocator = Allocator::default();
    let parsed = Parser::new(
        &allocator,
        &res.code,
        SourceType::default().with_module(true),
    )
    .parse();
    assert!(
        parsed.diagnostics.is_empty(),
        "generated code has syntax errors: {:?}",
        parsed.diagnostics
    );
}

#[test]
fn test_mixed_declaration_kinds_collision() {
    let code = r#"
import { html } from 'lit';
import { litHtmlPrivate_1 } from './dummy.js';

export const b_1 = 100;
let A_1 = 200;
var P_1 = 300;
function B_1() { return 400; }
class E_1 {}

export const tmpl = html`<button @click=${click} ?disabled=${disabled}>Label</button>`;
"#;

    let res = transform_html_aot(code.to_string(), None);
    assert_eq!(res.templates_count, 1);

    // Should avoid b_1, B_1, E_1, litHtmlPrivate_1
    assert!(res.code.contains("const b_2 = (i) => i;"));
    assert!(res.code.contains("import * as litHtmlPrivate_2 from"));
    assert!(res.code.contains("BooleanAttributePart: B_2"));
    assert!(res.code.contains("EventPart: E_2"));

    // Syntax validation
    let allocator = Allocator::default();
    let parsed = Parser::new(
        &allocator,
        &res.code,
        SourceType::default().with_module(true),
    )
    .parse();
    assert!(
        parsed.diagnostics.is_empty(),
        "generated code has syntax errors: {:?}",
        parsed.diagnostics
    );
}

#[test]
fn test_nested_scope_unresolved_reference_collision_avoidance() {
    let code = r#"
import { html } from 'lit';

function helper() {
    console.log(b_1);
}

class Component {
    render() {
        return litHtmlPrivate_1;
    }
}

export const tmpl = html`<div>${label}</div>`;
"#;

    let res = transform_html_aot(code.to_string(), None);
    assert_eq!(res.templates_count, 1);

    // Verify allocated identifiers avoid the unresolved b_1 and litHtmlPrivate_1
    assert!(
        res.code.contains("const b_2 = (i) => i;"),
        "expected b_2 brand function, got:\n{}",
        res.code
    );
    assert!(
        !res.code.contains("const b_1 = (i) => i;"),
        "b_1 should NOT be chosen as brand name:\n{}",
        res.code
    );
}

#[test]
fn test_template_expression_unresolved_reference_collision_avoidance() {
    let code = r#"
import { html } from 'lit';

export const tmpl = html`<div>${b_1} ${lit_template_1}</div>`;
"#;

    let res = transform_html_aot(code.to_string(), None);
    assert_eq!(res.templates_count, 1);

    // Verify allocated identifiers avoid b_1 and lit_template_1 from expressions
    assert!(
        res.code.contains("const b_2 = (i) => i;"),
        "expected b_2 brand function, got:\n{}",
        res.code
    );
    assert!(
        res.code.contains("const lit_template_2 ="),
        "expected lit_template_2 descriptor, got:\n{}",
        res.code
    );
    assert!(
        !res.code.contains("const b_1 = (i) => i;"),
        "b_1 should not shadow expression reference"
    );
    assert!(
        !res.code.contains("const lit_template_1 ="),
        "lit_template_1 should not shadow expression reference"
    );
}
