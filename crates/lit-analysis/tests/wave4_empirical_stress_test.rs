use lit_analysis::{
    analyze_lit_module,
    classify::{BailoutReason, ClassificationTier},
    diagnostics::DiagnosticCode,
};
use oxc_allocator::Allocator;

// =========================================================================
// 1. Compound directive expressions: ternary, logical, array, chained, sequence
// =========================================================================

#[test]
fn test_compound_directive_ternary_consequent_and_alternate() {
    let allocator = Allocator::default();

    // 1a. Ternary consequent
    let code_consequent = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';

        class TernaryConsequentComp extends LitElement {
            render() {
                return html`<div>${this.condition ? until(this.promise, 'loading...') : 'fallback'}</div>`;
            }
        }
    "#;
    let res_c = analyze_lit_module(&allocator, code_consequent, "t_c.ts").unwrap();
    assert_eq!(res_c.components.len(), 1);
    match &res_c.components[0].tier {
        ClassificationTier::Bailout { reasons } => {
            assert!(
                reasons.iter().any(|r| matches!(r, BailoutReason::UnsupportedDirective { name, .. } if name == "until")),
                "Expected UnsupportedDirective(until) in ternary consequent, got: {:?}",
                reasons
            );
        }
        other => panic!(
            "Expected Bailout tier for ternary until() in consequent, got: {:?}",
            other
        ),
    }
    assert!(res_c
        .diagnostics
        .iter()
        .any(|d| d.code == DiagnosticCode::LitBailUnsupportedDirective));

    // 1b. Ternary alternate
    let code_alternate = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';

        class TernaryAlternateComp extends LitElement {
            render() {
                return html`<div>${this.ready ? 'ready' : until(this.loader, 'waiting...')}</div>`;
            }
        }
    "#;
    let res_a = analyze_lit_module(&allocator, code_alternate, "t_a.ts").unwrap();
    assert_eq!(res_a.components.len(), 1);
    match &res_a.components[0].tier {
        ClassificationTier::Bailout { reasons } => {
            assert!(
                reasons.iter().any(|r| matches!(r, BailoutReason::UnsupportedDirective { name, .. } if name == "until")),
                "Expected UnsupportedDirective(until) in ternary alternate, got: {:?}",
                reasons
            );
        }
        other => panic!(
            "Expected Bailout tier for ternary until() in alternate, got: {:?}",
            other
        ),
    }

    // 1c. Both branches contain unsupported directives
    let code_both = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';
        import { asyncAppend } from 'lit/directives/async-append.js';

        class TernaryBothComp extends LitElement {
            render() {
                return html`<div>${this.useStream ? asyncAppend(this.stream) : until(this.promise)}</div>`;
            }
        }
    "#;
    let res_b = analyze_lit_module(&allocator, code_both, "t_b.ts").unwrap();
    assert_eq!(res_b.components.len(), 1);
    match &res_b.components[0].tier {
        ClassificationTier::Bailout { reasons } => {
            assert!(
                reasons.iter().any(|r| matches!(r, BailoutReason::UnsupportedDirective { name, .. } if name == "asyncAppend")),
                "Expected asyncAppend reason"
            );
            assert!(
                reasons.iter().any(|r| matches!(r, BailoutReason::UnsupportedDirective { name, .. } if name == "until")),
                "Expected until reason"
            );
        }
        other => panic!(
            "Expected Bailout tier for ternary both branches, got: {:?}",
            other
        ),
    }
}

#[test]
fn test_compound_directive_logical_expressions() {
    let allocator = Allocator::default();

    // 2a. Logical AND (guard)
    let code_and = r#"
        import { LitElement, html } from 'lit';
        import { asyncAppend } from 'lit/directives/async-append.js';

        class LogicalAndComp extends LitElement {
            render() {
                return html`<ul>${this.show && asyncAppend(this.stream)}</ul>`;
            }
        }
    "#;
    let res_and = analyze_lit_module(&allocator, code_and, "l_and.ts").unwrap();
    assert_eq!(res_and.components.len(), 1);
    assert!(matches!(
        res_and.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));

    // 2b. Logical OR (fallback)
    let code_or = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';

        class LogicalOrComp extends LitElement {
            render() {
                return html`<div>${this.cachedData || until(this.fetchData(), 'fetching')}</div>`;
            }
        }
    "#;
    let res_or = analyze_lit_module(&allocator, code_or, "l_or.ts").unwrap();
    assert_eq!(res_or.components.len(), 1);
    assert!(matches!(
        res_or.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));

    // 2c. Logical Nullish Coalescing (??)
    let code_nullish = r#"
        import { LitElement, html } from 'lit';
        import { asyncReplace } from 'lit/directives/async-replace.js';

        class LogicalNullishComp extends LitElement {
            render() {
                return html`<span>${this.staticValue ?? asyncReplace(this.ticker)}</span>`;
            }
        }
    "#;
    let res_nullish = analyze_lit_module(&allocator, code_nullish, "l_nullish.ts").unwrap();
    assert_eq!(res_nullish.components.len(), 1);
    assert!(matches!(
        res_nullish.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));
}

#[test]
fn test_compound_directive_array_and_parenthesized_and_sequence() {
    let allocator = Allocator::default();

    // 3a. Deeply nested array
    let code_array = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';

        class NestedArrayComp extends LitElement {
            render() {
                return html`<div>${[1, [2, [until(this.p1)]]]}</div>`;
            }
        }
    "#;
    let res_arr = analyze_lit_module(&allocator, code_array, "arr.ts").unwrap();
    assert_eq!(res_arr.components.len(), 1);
    assert!(matches!(
        res_arr.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));

    // 3b. Deeply parenthesized
    let code_paren = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';

        class ParenComp extends LitElement {
            render() {
                return html`<div>${((((until(this.p1)))))}</div>`;
            }
        }
    "#;
    let res_paren = analyze_lit_module(&allocator, code_paren, "paren.ts").unwrap();
    assert_eq!(res_paren.components.len(), 1);
    assert!(matches!(
        res_paren.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));

    // 3c. Sequence expression (comma operator)
    let code_seq = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';

        class SeqComp extends LitElement {
            render() {
                return html`<div>${(console.log('rendering'), until(this.p1))}</div>`;
            }
        }
    "#;
    let res_seq = analyze_lit_module(&allocator, code_seq, "seq.ts").unwrap();
    assert_eq!(res_seq.components.len(), 1);
    assert!(matches!(
        res_seq.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));
}

#[test]
fn test_compound_directive_chained_and_object_expressions() {
    let allocator = Allocator::default();

    // 4a. Object literal containing directive
    let code_obj = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';

        class ObjComp extends LitElement {
            render() {
                return html`<div>${{ content: until(this.p) }}</div>`;
            }
        }
    "#;
    let res_obj = analyze_lit_module(&allocator, code_obj, "obj.ts").unwrap();
    assert_eq!(res_obj.components.len(), 1);
    assert!(matches!(
        res_obj.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));

    // 4b. Variable declaration inside render() holding directive
    let code_var = r#"
        import { LitElement, html } from 'lit';
        import { asyncAppend } from 'lit/directives/async-append.js';

        class VarRenderComp extends LitElement {
            render() {
                const streamPart = asyncAppend(this.myStream);
                return html`<ul>${streamPart}</ul>`;
            }
        }
    "#;
    let res_var = analyze_lit_module(&allocator, code_var, "var_render.ts").unwrap();
    assert_eq!(res_var.components.len(), 1);
    assert!(matches!(
        res_var.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));

    // 4c. Arrow function in template expression
    let code_arrow = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';

        class ArrowDirectiveComp extends LitElement {
            render() {
                return html`<div>${() => until(this.p)}</div>`;
            }
        }
    "#;
    let res_arrow = analyze_lit_module(&allocator, code_arrow, "arrow_dir.ts").unwrap();
    assert_eq!(res_arrow.components.len(), 1);
    assert!(matches!(
        res_arrow.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));

    // 4d. Nested template literal
    let code_nested = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';

        class NestedTplComp extends LitElement {
            render() {
                return html`<div>${html`<span>${until(this.p)}</span>`}</div>`;
            }
        }
    "#;
    let res_nested = analyze_lit_module(&allocator, code_nested, "nested_dir.ts").unwrap();
    assert_eq!(res_nested.components.len(), 1);
    assert!(matches!(
        res_nested.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));
}

#[test]
fn test_supported_directives_do_not_bailout() {
    let allocator = Allocator::default();
    let code = r#"
        import { LitElement, html } from 'lit';
        import { classMap } from 'lit/directives/class-map.js';
        import { styleMap } from 'lit/directives/style-map.js';
        import { ifDefined } from 'lit/directives/if-defined.js';
        import { repeat } from 'lit/directives/repeat.js';

        class SupportedDirectivesComp extends LitElement {
            render() {
                const classes = { active: true };
                const styles = { color: 'red' };
                return html`
                    <div
                        class=${classMap(classes)}
                        style=${styleMap(styles)}
                        title=${ifDefined(this.tip)}
                    >
                        ${repeat(this.items || [], (i) => i.id, (i) => html`<li>${i.name}</li>`)}
                    </div>
                `;
            }
        }
    "#;
    let res = analyze_lit_module(&allocator, code, "supported_dir.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    // Supported directives should NOT trigger Bailout
    assert_ne!(
        res.components[0].tier,
        ClassificationTier::Bailout { reasons: vec![] },
        "Supported directives must not trigger Bailout"
    );
    assert!(!matches!(
        res.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));
}

// =========================================================================
// 2. Escaping `this` statements in methods: return, const/let, assignment, ternary
// =========================================================================

#[test]
fn test_escaping_this_in_return_statement() {
    let allocator = Allocator::default();
    let code = r#"
        import { LitElement, html } from 'lit';

        class ReturnEscapeComp extends LitElement {
            attachToManager() {
                return globalManager.register(this);
            }

            render() {
                return html`<div>safe render</div>`;
            }
        }
    "#;
    let res = analyze_lit_module(&allocator, code, "ret_escape.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    match &res.components[0].tier {
        ClassificationTier::Bailout { reasons } => {
            assert!(
                reasons.iter().any(|r| matches!(r, BailoutReason::UnresolvableThisEscape { expression, .. } if expression == "register")),
                "Expected UnresolvableThisEscape(register), got: {:?}",
                reasons
            );
        }
        other => panic!("Expected Bailout tier, got: {:?}", other),
    }
    assert!(res
        .diagnostics
        .iter()
        .any(|d| d.code == DiagnosticCode::LitBailEscapingThis));
}

#[test]
fn test_escaping_this_parenthesized() {
    let allocator = Allocator::default();
    let code = r#"
        import { LitElement, html } from 'lit';

        class ParenEscapeComp extends LitElement {
            setup() {
                register((this));
            }

            render() {
                return html`<div>safe render</div>`;
            }
        }
    "#;
    let res = analyze_lit_module(&allocator, code, "paren_escape.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    // Observe actual classification tier
    println!("register((this)) tier: {:?}", res.components[0].tier);
}

#[test]
fn test_escaping_this_ternary_arg() {
    let allocator = Allocator::default();
    let code = r#"
        import { LitElement, html } from 'lit';

        class TernaryArgEscapeComp extends LitElement {
            setup() {
                register(cond ? this : null);
            }

            render() {
                return html`<div>safe render</div>`;
            }
        }
    "#;
    let res = analyze_lit_module(&allocator, code, "ternary_arg_escape.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    println!(
        "register(cond ? this : null) tier: {:?}",
        res.components[0].tier
    );
}

#[test]
fn test_escaping_this_logical_arg() {
    let allocator = Allocator::default();
    let code = r#"
        import { LitElement, html } from 'lit';

        class LogicalArgEscapeComp extends LitElement {
            setup() {
                register(fallback || this);
            }

            render() {
                return html`<div>safe render</div>`;
            }
        }
    "#;
    let res = analyze_lit_module(&allocator, code, "logical_arg_escape.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    println!(
        "register(fallback || this) tier: {:?}",
        res.components[0].tier
    );
}

#[test]
fn test_escaping_this_array_arg() {
    let allocator = Allocator::default();
    let code = r#"
        import { LitElement, html } from 'lit';

        class ArrayArgEscapeComp extends LitElement {
            setup() {
                register([this]);
            }

            render() {
                return html`<div>safe render</div>`;
            }
        }
    "#;
    let res = analyze_lit_module(&allocator, code, "array_arg_escape.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    println!("register([this]) tier: {:?}", res.components[0].tier);
}

#[test]
fn test_escaping_this_object_arg() {
    let allocator = Allocator::default();
    let code = r#"
        import { LitElement, html } from 'lit';

        class ObjectArgEscapeComp extends LitElement {
            setup() {
                register({ host: this });
            }

            render() {
                return html`<div>safe render</div>`;
            }
        }
    "#;
    let res = analyze_lit_module(&allocator, code, "object_arg_escape.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    println!(
        "register({{ host: this }}) tier: {:?}",
        res.components[0].tier
    );
}

#[test]
fn test_escaping_this_in_variable_declaration() {
    let allocator = Allocator::default();
    let code = r#"
        import { LitElement, html } from 'lit';

        class VarEscapeComp extends LitElement {
            connectedCallback() {
                super.connectedCallback();
                const token = registry.subscribe(this);
            }

            render() {
                return html`<div>safe render</div>`;
            }
        }
    "#;
    let res = analyze_lit_module(&allocator, code, "var_escape.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    assert!(matches!(
        res.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));
    assert!(res
        .diagnostics
        .iter()
        .any(|d| d.code == DiagnosticCode::LitBailEscapingThis));
}

#[test]
fn test_escaping_this_in_assignment_expression() {
    let allocator = Allocator::default();
    let code = r#"
        import { LitElement, html } from 'lit';

        class AssignEscapeComp extends LitElement {
            initialize() {
                let handle;
                handle = externalTracker.track(this);
            }

            render() {
                return html`<div>safe render</div>`;
            }
        }
    "#;
    let res = analyze_lit_module(&allocator, code, "assign_escape.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    assert!(matches!(
        res.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));
    assert!(res
        .diagnostics
        .iter()
        .any(|d| d.code == DiagnosticCode::LitBailEscapingThis));
}

#[test]
fn test_escaping_this_in_ternary_expression() {
    let allocator = Allocator::default();
    let code = r#"
        import { LitElement, html } from 'lit';

        class TernaryEscapeComp extends LitElement {
            sync() {
                this.active ? externalNotify(this) : null;
            }

            render() {
                return html`<div>safe render</div>`;
            }
        }
    "#;
    let res = analyze_lit_module(&allocator, code, "ternary_escape.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    assert!(matches!(
        res.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));
    assert!(res
        .diagnostics
        .iter()
        .any(|d| d.code == DiagnosticCode::LitBailEscapingThis));
}

#[test]
fn test_allowed_this_references_do_not_bailout() {
    let allocator = Allocator::default();
    let code = r#"
        import { LitElement, html } from 'lit';

        class AllowedThisComp extends LitElement {
            setupObservers() {
                this.internalHelper(this);
                const observer = new ResizeObserver(() => {});
                observer.observe(this);
                observer.unobserve(this);
                const isContained = document.body.contains(this);
                const styles = window.getComputedStyle(this);
            }

            internalHelper(selfRef) {
                return selfRef;
            }

            render() {
                return html`<div>All this uses are allowed</div>`;
            }
        }
    "#;
    let res = analyze_lit_module(&allocator, code, "allowed_this.ts").unwrap();
    assert_eq!(res.components.len(), 1);
    // Allowed this calls should NOT trigger bailout; they qualify for Tier 1
    assert_eq!(
        res.components[0].tier,
        ClassificationTier::Tier1Hosted,
        "Allowed observer/contains/getComputedStyle/internal this calls must not trigger Bailout"
    );
    assert!(!res
        .diagnostics
        .iter()
        .any(|d| d.code == DiagnosticCode::LitBailEscapingThis));
}

// =========================================================================
// 3. Minified booleans in static formAssociated and delegatesFocus
// =========================================================================

#[test]
fn test_minified_booleans_form_associated_exhaustive() {
    let allocator = Allocator::default();

    // !0 -> true -> Tier 2
    let code_not_0 = r#"
        import { LitElement, html } from 'lit';
        class FormNot0 extends LitElement {
            static formAssociated = !0;
            render() { return html`<input />`; }
        }
    "#;
    let res_not_0 = analyze_lit_module(&allocator, code_not_0, "f_not_0.js").unwrap();
    assert_eq!(
        res_not_0.components[0].tier,
        ClassificationTier::Tier2HostedWithFacade
    );

    // !1 -> false -> Tier 0
    let code_not_1 = r#"
        import { LitElement, html } from 'lit';
        class FormNot1 extends LitElement {
            static formAssociated = !1;
            render() { return html`<input />`; }
        }
    "#;
    let res_not_1 = analyze_lit_module(&allocator, code_not_1, "f_not_1.js").unwrap();
    assert_eq!(res_not_1.components[0].tier, ClassificationTier::Tier0Pure);

    // !!1 -> true -> Tier 2
    let code_double_not_1 = r#"
        import { LitElement, html } from 'lit';
        class FormDoubleNot1 extends LitElement {
            static formAssociated = !!1;
            render() { return html`<input />`; }
        }
    "#;
    let res_double_not_1 =
        analyze_lit_module(&allocator, code_double_not_1, "f_dnot_1.js").unwrap();
    assert_eq!(
        res_double_not_1.components[0].tier,
        ClassificationTier::Tier2HostedWithFacade
    );

    // void 0 -> undefined (falsy) -> Tier 0
    let code_void_0 = r#"
        import { LitElement, html } from 'lit';
        class FormVoid0 extends LitElement {
            static formAssociated = void 0;
            render() { return html`<input />`; }
        }
    "#;
    let res_void_0 = analyze_lit_module(&allocator, code_void_0, "f_void_0.js").unwrap();
    assert_eq!(res_void_0.components[0].tier, ClassificationTier::Tier0Pure);

    // !void 0 -> true -> Tier 2
    let code_not_void_0 = r#"
        import { LitElement, html } from 'lit';
        class FormNotVoid0 extends LitElement {
            static formAssociated = !void 0;
            render() { return html`<input />`; }
        }
    "#;
    let res_not_void_0 =
        analyze_lit_module(&allocator, code_not_void_0, "f_not_void_0.js").unwrap();
    assert_eq!(
        res_not_void_0.components[0].tier,
        ClassificationTier::Tier2HostedWithFacade
    );
}

#[test]
fn test_minified_booleans_delegates_focus_exhaustive() {
    let allocator = Allocator::default();

    // !0 -> true -> Tier 2
    let code_not_0 = r#"
        import { LitElement, html } from 'lit';
        class FocusNot0 extends LitElement {
            static shadowRootOptions = { delegatesFocus: !0 };
            render() { return html`<button>Go</button>`; }
        }
    "#;
    let res_not_0 = analyze_lit_module(&allocator, code_not_0, "foc_not_0.js").unwrap();
    assert!(
        res_not_0.components[0]
            .shadow_root_options
            .as_ref()
            .unwrap()
            .delegates_focus
    );
    assert_eq!(
        res_not_0.components[0].tier,
        ClassificationTier::Tier2HostedWithFacade
    );

    // !1 -> false -> Tier 0
    let code_not_1 = r#"
        import { LitElement, html } from 'lit';
        class FocusNot1 extends LitElement {
            static shadowRootOptions = { delegatesFocus: !1 };
            render() { return html`<button>Go</button>`; }
        }
    "#;
    let res_not_1 = analyze_lit_module(&allocator, code_not_1, "foc_not_1.js").unwrap();
    assert!(
        !res_not_1.components[0]
            .shadow_root_options
            .as_ref()
            .unwrap()
            .delegates_focus
    );
    assert_eq!(res_not_1.components[0].tier, ClassificationTier::Tier0Pure);

    // !!1 -> true -> Tier 2
    let code_dnot_1 = r#"
        import { LitElement, html } from 'lit';
        class FocusDnot1 extends LitElement {
            static shadowRootOptions = { delegatesFocus: !!1 };
            render() { return html`<button>Go</button>`; }
        }
    "#;
    let res_dnot_1 = analyze_lit_module(&allocator, code_dnot_1, "foc_dnot_1.js").unwrap();
    assert!(
        res_dnot_1.components[0]
            .shadow_root_options
            .as_ref()
            .unwrap()
            .delegates_focus
    );
    assert_eq!(
        res_dnot_1.components[0].tier,
        ClassificationTier::Tier2HostedWithFacade
    );

    // void 0 -> false -> Tier 0
    let code_void_0 = r#"
        import { LitElement, html } from 'lit';
        class FocusVoid0 extends LitElement {
            static shadowRootOptions = { delegatesFocus: void 0 };
            render() { return html`<button>Go</button>`; }
        }
    "#;
    let res_void_0 = analyze_lit_module(&allocator, code_void_0, "foc_void_0.js").unwrap();
    assert!(
        !res_void_0.components[0]
            .shadow_root_options
            .as_ref()
            .unwrap()
            .delegates_focus
    );
    assert_eq!(res_void_0.components[0].tier, ClassificationTier::Tier0Pure);

    // !void 0 -> true -> Tier 2
    let code_not_void_0 = r#"
        import { LitElement, html } from 'lit';
        class FocusNotVoid0 extends LitElement {
            static shadowRootOptions = { delegatesFocus: !void 0 };
            render() { return html`<button>Go</button>`; }
        }
    "#;
    let res_not_void_0 =
        analyze_lit_module(&allocator, code_not_void_0, "foc_not_void_0.js").unwrap();
    assert!(
        res_not_void_0.components[0]
            .shadow_root_options
            .as_ref()
            .unwrap()
            .delegates_focus
    );
    assert_eq!(
        res_not_void_0.components[0].tier,
        ClassificationTier::Tier2HostedWithFacade
    );
}

// =========================================================================
// 4. Non-Lit inheritance guards
// =========================================================================

#[test]
fn test_non_lit_inheritance_guards_comprehensive() {
    let allocator = Allocator::default();

    // Module with non-Lit classes and pure Lit component
    let mixed_source = r#"
        import { LitElement, html } from 'lit';
        import { BaseService } from './services.js';
        import { Logger } from 'external-logger';

        export class AppService extends BaseService {
            execute() { return 'done'; }
        }

        export class RemoteLogger extends Logger {
            send(payload) { console.log(payload); }
        }

        export class PlainDataStructure {
            constructor() { this.items = []; }
        }

        export class RealLeafIcon extends LitElement {
            render() {
                return html`<svg><circle cx="5" cy="5" r="5"/></svg>`;
            }
        }
    "#;
    let res = analyze_lit_module(&allocator, mixed_source, "mixed_guards.js").unwrap();
    assert_eq!(
        res.components.len(),
        1,
        "Only the real Lit component must enter components list"
    );
    assert_eq!(res.components[0].class_name, "RealLeafIcon");
    assert_eq!(res.components[0].tier, ClassificationTier::Tier0Pure);
    assert_eq!(res.manifest.components.len(), 1);
    assert_eq!(res.manifest.components[0].class_name, "RealLeafIcon");
    assert!(res
        .diagnostics
        .iter()
        .all(|d| d.code != DiagnosticCode::LitBailUnresolvableInheritance));

    // Unknown external base class with NO Lit markers -> completely ignored
    let unproven_no_markers = r#"
        import { UnknownWidget } from 'third-party-widget';

        export class MyWidget extends UnknownWidget {
            doSomething() { return 42; }
        }
    "#;
    let res_no_markers =
        analyze_lit_module(&allocator, unproven_no_markers, "no_markers.js").unwrap();
    assert_eq!(res_no_markers.components.len(), 0);
    assert_eq!(res_no_markers.manifest.components.len(), 0);
    assert!(res_no_markers.diagnostics.is_empty());

    // Unknown external base class WITH Lit markers -> enters manifest as CrossModuleSubclass and emits LIT108
    let unproven_with_markers = r#"
        import { html } from 'lit';
        import { CustomBase } from './custom-base.js';

        export class MySubComponent extends CustomBase {
            render() {
                return html`<div>Subclass markup</div>`;
            }
        }
    "#;
    let res_with_markers =
        analyze_lit_module(&allocator, unproven_with_markers, "with_markers.js").unwrap();
    assert_eq!(res_with_markers.components.len(), 1);
    assert_eq!(res_with_markers.components[0].class_name, "MySubComponent");
    assert_eq!(
        res_with_markers.components[0].super_class,
        Some("CustomBase".to_string())
    );
    let diag = res_with_markers
        .diagnostics
        .iter()
        .find(|d| d.code == DiagnosticCode::LitBailUnresolvableInheritance);
    assert!(
        diag.is_some(),
        "Must emit LIT108 diagnostic for cross-module subclass requiring cross-module manifest"
    );
}

// =========================================================================
// 5. 4-Tier classification invariants
// =========================================================================

#[test]
fn test_four_tier_classification_invariants() {
    let allocator = Allocator::default();

    // Tier 0: Pure stateless leaf
    let t0_code = r#"
        import { LitElement, html, css } from 'lit';
        class LeafBadge extends LitElement {
            static styles = css`:host { display: inline-block; }`;
            render() {
                return html`<span>Pure Badge</span>`;
            }
        }
    "#;
    let res_t0 = analyze_lit_module(&allocator, t0_code, "t0.js").unwrap();
    assert_eq!(res_t0.components[0].tier, ClassificationTier::Tier0Pure);
    assert!(res_t0
        .diagnostics
        .iter()
        .any(|d| d.code == DiagnosticCode::LitInfoTier0Pure));

    // Tier 1: Reactive property
    let t1_code = r#"
        import { LitElement, html, property } from 'lit';
        class ButtonWithProp extends LitElement {
            @property({ type: String })
            label = 'Click';

            render() {
                return html`<button>${this.label}</button>`;
            }
        }
    "#;
    let res_t1 = analyze_lit_module(&allocator, t1_code, "t1.ts").unwrap();
    assert_eq!(res_t1.components[0].tier, ClassificationTier::Tier1Hosted);

    // Tier 2: Inspected slot with @slotchange
    let t2_code = r#"
        import { LitElement, html } from 'lit';
        class SlotTabs extends LitElement {
            render() {
                return html`<slot @slotchange=${this.handleSlotChange}></slot>`;
            }
            handleSlotChange() {}
        }
    "#;
    let res_t2 = analyze_lit_module(&allocator, t2_code, "t2.js").unwrap();
    assert_eq!(
        res_t2.components[0].tier,
        ClassificationTier::Tier2HostedWithFacade
    );

    // Bailout: Unsupported directive until()
    let bail_code = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';
        class BailComp extends LitElement {
            render() {
                return html`<div>${until(this.p)}</div>`;
            }
        }
    "#;
    let res_bail = analyze_lit_module(&allocator, bail_code, "bail.js").unwrap();
    assert!(matches!(
        res_bail.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));
    assert!(res_bail
        .diagnostics
        .iter()
        .any(|d| d.code == DiagnosticCode::LitBailUnsupportedDirective));
}
