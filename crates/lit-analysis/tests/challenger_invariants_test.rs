use lit_analysis::{
    analyze_lit_module,
    classify::{BailoutReason, ClassificationTier},
    diagnostics::DiagnosticCode,
};
use oxc_allocator::Allocator;

// =========================================================================
// 1. Minified booleans in static formAssociated and delegatesFocus
// =========================================================================

#[test]
fn test_form_associated_minified_boolean_truthy() {
    let source = r#"
        import { LitElement, html } from 'lit';

        class MinifiedFormElement extends LitElement {
            static formAssociated = !0;

            render() {
                return html`<input type="text" />`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "form-el.js").unwrap();
    assert_eq!(result.components.len(), 1);
    assert_eq!(
        result.components[0].tier,
        ClassificationTier::Tier2HostedWithFacade,
        "static formAssociated = !0 must trigger Tier 2 facade classification"
    );
}

#[test]
fn test_form_associated_boolean_literal_truthy() {
    let source = r#"
        import { LitElement, html } from 'lit';

        class StandardFormElement extends LitElement {
            static formAssociated = true;

            render() {
                return html`<input type="checkbox" />`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "std-form.js").unwrap();
    assert_eq!(result.components.len(), 1);
    assert_eq!(
        result.components[0].tier,
        ClassificationTier::Tier2HostedWithFacade,
        "static formAssociated = true must trigger Tier 2 facade classification"
    );
}

#[test]
fn test_form_associated_minified_double_not_truthy() {
    let source = r#"
        import { LitElement, html } from 'lit';

        class DoubleNotFormElement extends LitElement {
            static formAssociated = !!1;

            render() {
                return html`<input type="radio" />`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "double-not-form.js").unwrap();
    assert_eq!(result.components.len(), 1);
    assert_eq!(
        result.components[0].tier,
        ClassificationTier::Tier2HostedWithFacade,
        "static formAssociated = !!1 must trigger Tier 2 facade classification"
    );
}

#[test]
fn test_form_associated_falsy_booleans() {
    let source_not_one = r#"
        import { LitElement, html } from 'lit';

        class NotFormAssociated extends LitElement {
            static formAssociated = !1;

            render() {
                return html`<span>Not a form</span>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source_not_one, "not-form.js").unwrap();
    assert_eq!(result.components.len(), 1);
    assert_eq!(
        result.components[0].tier,
        ClassificationTier::Tier0Pure,
        "static formAssociated = !1 must NOT trigger Tier 2 (should qualify as Tier 0 pure)"
    );

    let source_false = r#"
        import { LitElement, html } from 'lit';

        class ExplicitFalseForm extends LitElement {
            static formAssociated = false;

            render() {
                return html`<span>Not a form</span>`;
            }
        }
    "#;

    let result_false = analyze_lit_module(&allocator, source_false, "false-form.js").unwrap();
    assert_eq!(result_false.components.len(), 1);
    assert_eq!(
        result_false.components[0].tier,
        ClassificationTier::Tier0Pure,
        "static formAssociated = false must NOT trigger Tier 2"
    );
}

#[test]
fn test_delegates_focus_minified_boolean() {
    let source_true = r#"
        import { LitElement, html } from 'lit';

        class FocusDelegateEl extends LitElement {
            static shadowRootOptions = { delegatesFocus: !0, mode: 'open' };

            render() {
                return html`<button>Inner</button>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source_true, "focus.js").unwrap();
    assert_eq!(result.components.len(), 1);
    let comp = &result.components[0];
    assert!(
        comp.shadow_root_options.as_ref().unwrap().delegates_focus,
        "delegatesFocus: !0 must extract delegates_focus as true"
    );
    assert_eq!(
        comp.tier,
        ClassificationTier::Tier2HostedWithFacade,
        "delegatesFocus: !0 must trigger Tier 2 facade classification"
    );

    let source_false = r#"
        import { LitElement, html } from 'lit';

        class NoFocusDelegateEl extends LitElement {
            static shadowRootOptions = { delegatesFocus: !1, mode: 'open' };

            render() {
                return html`<button>Inner</button>`;
            }
        }
    "#;

    let result_false = analyze_lit_module(&allocator, source_false, "no-focus.js").unwrap();
    assert_eq!(result_false.components.len(), 1);
    let comp_false = &result_false.components[0];
    assert!(
        !comp_false
            .shadow_root_options
            .as_ref()
            .unwrap()
            .delegates_focus,
        "delegatesFocus: !1 must extract delegates_focus as false"
    );
    assert_eq!(
        comp_false.tier,
        ClassificationTier::Tier0Pure,
        "delegatesFocus: !1 must NOT trigger Tier 2"
    );
}

// =========================================================================
// 2. Aliased directive imports bailout (LIT101)
// =========================================================================

#[test]
fn test_aliased_directive_until_bailout() {
    let source = r#"
        import { LitElement, html } from 'lit';
        import { until as u } from 'lit/directives/until.js';

        class AsyncComponent extends LitElement {
            render() {
                return html`<div>${u(Promise.resolve('content'), html`<span>loading...</span>`)}</div>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "aliased-until.js").unwrap();
    assert_eq!(result.components.len(), 1);

    let comp = &result.components[0];
    match &comp.tier {
        ClassificationTier::Bailout { reasons } => {
            assert!(
                reasons.iter().any(|r| matches!(
                    r,
                    BailoutReason::UnsupportedDirective { name, .. } if name == "until"
                )),
                "Expected BailoutReason::UnsupportedDirective with name 'until', got {:?}",
                reasons
            );
        }
        other => panic!("Expected Bailout tier, got {:?}", other),
    }

    let diag = result
        .diagnostics
        .iter()
        .find(|d| d.code == DiagnosticCode::LitBailUnsupportedDirective)
        .expect("Must emit LIT101 diagnostic for aliased until directive");
    assert_eq!(diag.code.as_str(), "LIT101");
    assert!(
        diag.universal_lit_hint.contains("@lit/task"),
        "Diagnostic must suggest Universal Lit alternative @lit/task"
    );
}

#[test]
fn test_aliased_directive_async_append_bailout() {
    let source = r#"
        import { LitElement, html } from 'lit';
        import { asyncAppend as aa } from 'lit/directives/async-append.js';

        class StreamList extends LitElement {
            render() {
                return html`<ul>${aa(this.stream)}</ul>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "aliased-append.js").unwrap();
    assert_eq!(result.components.len(), 1);

    let comp = &result.components[0];
    match &comp.tier {
        ClassificationTier::Bailout { reasons } => {
            assert!(
                reasons.iter().any(|r| matches!(
                    r,
                    BailoutReason::UnsupportedDirective { name, .. } if name == "asyncAppend"
                )),
                "Expected BailoutReason::UnsupportedDirective with name 'asyncAppend', got {:?}",
                reasons
            );
        }
        other => panic!("Expected Bailout tier, got {:?}", other),
    }

    assert!(result
        .diagnostics
        .iter()
        .any(|d| d.code == DiagnosticCode::LitBailUnsupportedDirective));
}

#[test]
fn test_aliased_directive_async_replace_bailout() {
    let source = r#"
        import { LitElement, html } from 'lit';
        import { asyncReplace as ar } from 'lit/directives/async-replace.js';

        class LiveTicker extends LitElement {
            render() {
                return html`<span>${ar(this.ticker)}</span>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "aliased-replace.js").unwrap();
    assert_eq!(result.components.len(), 1);

    let comp = &result.components[0];
    match &comp.tier {
        ClassificationTier::Bailout { reasons } => {
            assert!(
                reasons.iter().any(|r| matches!(
                    r,
                    BailoutReason::UnsupportedDirective { name, .. } if name == "asyncReplace"
                )),
                "Expected BailoutReason::UnsupportedDirective with name 'asyncReplace', got {:?}",
                reasons
            );
        }
        other => panic!("Expected Bailout tier, got {:?}", other),
    }
}

#[test]
fn test_deeply_nested_aliased_directive_bailout() {
    let source = r#"
        import { LitElement, html } from 'lit';
        import { until as _u } from 'lit/directives/until.js';

        class DeepComponent extends LitElement {
            render() {
                return html`
                    <div class="container">
                        <header>Header</header>
                        <main>
                            <section>
                                <article>${_u(fetchData(), html`<em>wait</em>`)}</article>
                            </section>
                        </main>
                    </div>
                `;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "deep-until.js").unwrap();
    assert_eq!(result.components.len(), 1);
    assert!(matches!(
        result.components[0].tier,
        ClassificationTier::Bailout { .. }
    ));
}

// =========================================================================
// 3. Non-Lit class inheritance guards
// =========================================================================

#[test]
fn test_standard_non_lit_classes_ignored() {
    let source = r#"
        import { BaseService } from './services.js';
        import { Logger } from 'external-logger';

        export class UserService extends BaseService {
            fetchUser(id) {
                return { id, name: 'Alice' };
            }
        }

        export class AuditLogger extends Logger {
            log(msg) {
                console.log(msg);
            }
        }

        export class PlainData {
            constructor() {
                this.timestamp = Date.now();
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "services.js").unwrap();
    assert_eq!(
        result.components.len(),
        0,
        "Non-Lit classes extending third-party bases must be completely ignored"
    );
    assert_eq!(
        result.manifest.components.len(),
        0,
        "Module manifest must have 0 components for non-Lit classes"
    );
    assert!(
        result.diagnostics.is_empty(),
        "No diagnostics should be emitted for ordinary non-Lit classes"
    );
}

#[test]
fn test_non_lit_classes_mixed_with_lit_component() {
    let source = r#"
        import { LitElement, html } from 'lit';
        import { EventEmitter } from 'events';

        export class EventHub extends EventEmitter {
            broadcast(evt) { this.emit('msg', evt); }
        }

        export class MyRealButton extends LitElement {
            render() {
                return html`<button>Click me</button>`;
            }
        }

        export class HelperUtil {
            static compute(x) { return x * 2; }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "mixed.js").unwrap();
    assert_eq!(
        result.components.len(),
        1,
        "Only the real Lit component must enter the components list"
    );
    assert_eq!(result.components[0].class_name, "MyRealButton");
    assert_eq!(result.components[0].tier, ClassificationTier::Tier0Pure);
}

#[test]
fn test_cross_module_lit_subclass_with_lit_markers() {
    let source = r#"
        import { html } from 'lit';
        import { BaseComponent } from './base-component.js';

        export class SubButton extends BaseComponent {
            render() {
                return html`<button>Subclass</button>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "sub-button.js").unwrap();
    assert_eq!(
        result.components.len(),
        1,
        "Cross-module subclass with Lit markers (render returning html) must enter manifest"
    );

    let comp = &result.components[0];
    assert_eq!(comp.class_name, "SubButton");
    assert_eq!(comp.super_class, Some("BaseComponent".to_string()));

    let diag = result
        .diagnostics
        .iter()
        .find(|d| d.code == DiagnosticCode::LitBailUnresolvableInheritance)
        .expect("Must emit LIT108 diagnostic for unresolvable external inheritance");
    assert_eq!(diag.code.as_str(), "LIT108");
}

// =========================================================================
// 4. hasChanged callback extraction
// =========================================================================

#[test]
fn test_has_changed_in_decorator_property_and_state() {
    let source = r#"
        import { LitElement, property, state } from 'lit';

        class ComponentWithHasChanged extends LitElement {
            @property({
                type: String,
                hasChanged: (newVal, oldVal) => newVal?.trim() !== oldVal?.trim()
            })
            filter = '';

            @state({
                hasChanged: (n, o) => n > o
            })
            threshold = 0;
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "decorators-haschanged.ts").unwrap();
    assert_eq!(result.components.len(), 1);

    let comp = &result.components[0];
    let filter = comp
        .properties
        .iter()
        .find(|p| p.name == "filter")
        .expect("filter property must be extracted");
    assert!(
        filter.has_changed.is_some(),
        "filter.has_changed must be Some"
    );
    let filter_hc = filter.has_changed.as_ref().unwrap();
    assert!(
        filter_hc.contains("newVal?.trim() !== oldVal?.trim()"),
        "Extracted hasChanged must preserve function expression: got '{}'",
        filter_hc
    );

    let threshold = comp
        .properties
        .iter()
        .find(|p| p.name == "threshold")
        .expect("threshold state property must be extracted");
    assert!(
        threshold.has_changed.is_some(),
        "threshold.has_changed must be Some"
    );
    let thresh_hc = threshold.has_changed.as_ref().unwrap();
    assert!(
        thresh_hc.contains("n > o"),
        "Extracted hasChanged must preserve function expression: got '{}'",
        thresh_hc
    );
}

#[test]
fn test_has_changed_in_static_properties() {
    let source = r#"
        import { LitElement } from 'lit';

        function customEquality(a, b) {
            return JSON.stringify(a) === JSON.stringify(b);
        }

        class StaticPropsWithHasChanged extends LitElement {
            static properties = {
                data: {
                    type: Object,
                    hasChanged: customEquality
                },
                count: {
                    type: Number,
                    hasChanged(newVal, oldVal) {
                        return newVal !== oldVal;
                    }
                },
                plain: {
                    type: Boolean
                }
            };
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "static-haschanged.js").unwrap();
    assert_eq!(result.components.len(), 1);

    let comp = &result.components[0];
    let data = comp
        .properties
        .iter()
        .find(|p| p.name == "data")
        .expect("data property must be extracted");
    assert_eq!(
        data.has_changed,
        Some("customEquality".to_string()),
        "data.has_changed must be the identifier 'customEquality'"
    );

    let count = comp
        .properties
        .iter()
        .find(|p| p.name == "count")
        .expect("count property must be extracted");
    assert!(
        count.has_changed.is_some(),
        "count.has_changed must be Some"
    );
    let count_hc = count.has_changed.as_ref().unwrap();
    assert!(
        count_hc.contains("hasChanged(newVal, oldVal)"),
        "Method shorthand hasChanged must be preserved: got '{}'",
        count_hc
    );

    let plain = comp
        .properties
        .iter()
        .find(|p| p.name == "plain")
        .expect("plain property must be extracted");
    assert_eq!(
        plain.has_changed, None,
        "Property without hasChanged must have None"
    );
}

// =========================================================================
// 5. 4-Tier classification invariants & purity stress tests
// =========================================================================

#[test]
fn test_tier_0_pure_with_static_styles() {
    let source = r#"
        import { LitElement, html, css } from 'lit';

        class StaticIcon extends LitElement {
            static styles = css`
                :host { display: inline-block; width: 16px; height: 16px; }
                svg { fill: currentColor; }
            `;

            render() {
                return html`<svg viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "icon.js").unwrap();
    assert_eq!(result.components.len(), 1);
    assert_eq!(
        result.components[0].tier,
        ClassificationTier::Tier0Pure,
        "Leaf icon with static styles and pure render must be Tier 0"
    );
    assert!(
        result
            .diagnostics
            .iter()
            .any(|d| d.code == DiagnosticCode::LitInfoTier0Pure),
        "Tier 0 component must emit LIT202 info diagnostic"
    );
}

#[test]
fn test_tier_0_disqualified_by_this_access() {
    let source = r#"
        import { LitElement, html } from 'lit';

        class StatefulRender extends LitElement {
            render() {
                return html`<div>${this.computeLabel()}</div>`;
            }

            computeLabel() {
                return "dynamic";
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "this-access.js").unwrap();
    assert_eq!(result.components.len(), 1);
    assert_eq!(
        result.components[0].tier,
        ClassificationTier::Tier1Hosted,
        "Component accessing this in render or defining methods must be disqualified from Tier 0 to Tier 1"
    );
}

#[test]
fn test_tier_0_disqualified_by_lifecycle_method() {
    let source = r#"
        import { LitElement, html } from 'lit';

        class LifecycleComponent extends LitElement {
            connectedCallback() {
                super.connectedCallback();
            }

            render() {
                return html`<span>Hello</span>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "lifecycle.js").unwrap();
    assert_eq!(result.components.len(), 1);
    assert_eq!(
        result.components[0].tier,
        ClassificationTier::Tier1Hosted,
        "Component implementing connectedCallback must be disqualified from Tier 0 to Tier 1"
    );
}
