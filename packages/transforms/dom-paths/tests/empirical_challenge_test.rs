use dom_paths::transform::{DomPathsOptions, transform_code};

#[test]
fn test_lifecycle_preservation_first_updated_will_update_updated() {
    let source = r#"
        import { LitElement, html } from 'lit';

        export class LifecycleComponent extends LitElement {
            static properties = { count: { type: Number } };

            firstUpdated(changedProperties) {
                console.log('firstUpdated', changedProperties);
            }

            willUpdate(changedProperties) {
                console.log('willUpdate', changedProperties);
            }

            updated(changedProperties) {
                console.log('updated', changedProperties);
            }

            render() {
                return html`<div><p>${this.count}</p></div>`;
            }
        }
    "#;

    let res = transform_code(source, DomPathsOptions::default());
    assert_eq!(
        res.components_count, 1,
        "Must transform component with lifecycle methods"
    );
    assert_eq!(res.paths_count, 1, "Must extract 1 part path");
    assert!(
        res.code.contains("static __litPartPaths = ["),
        "Must inject static __litPartPaths"
    );
    assert!(
        res.code.contains("update(changedProperties)"),
        "Must inject fast update method"
    );
    assert!(
        !res.code.contains("this.updated?.(changedProperties)"),
        "Must not invoke this.updated inside update() to prevent double invocation"
    );
    assert!(
        !res.code.contains("this.__litDomNodes"),
        "Must not retain DOM nodes on this.__litDomNodes"
    );
}

#[test]
fn test_dead_code_pruning_on_custom_update() {
    let source = r#"
        import { LitElement, html } from 'lit';

        export class CustomUpdateComp extends LitElement {
            static properties = { count: { type: Number } };

            update(changedProperties) {
                super.update(changedProperties);
            }

            render() {
                return html`<div><p>${this.count}</p></div>`;
            }
        }
    "#;

    let res = transform_code(source, DomPathsOptions::default());
    assert_eq!(
        res.components_count, 0,
        "Must bail out when user defines update()"
    );
    assert_eq!(res.paths_count, 0, "Must not count paths on bailout");
    assert!(
        !res.code.contains("static __litPartPaths"),
        "Must not inject static __litPartPaths dead code on bailout"
    );
}

#[test]
fn test_dead_code_pruning_on_non_sole_child_unsupported_template() {
    let source = r#"
        import { LitElement, html } from 'lit';

        export class SiblingTextComp extends LitElement {
            static properties = { count: { type: Number } };

            render() {
                return html`<div><p>Count: ${this.count} items</p></div>`;
            }
        }
    "#;

    let res = transform_code(source, DomPathsOptions::default());
    assert_eq!(
        res.components_count, 0,
        "Must bail out on non-sole-child expression"
    );
    assert_eq!(res.paths_count, 0, "Must not count paths on bailout");
    assert!(
        !res.code.contains("static __litPartPaths"),
        "Must not inject static __litPartPaths dead code when parts are unsupported"
    );
}

#[test]
fn test_dead_code_pruning_on_attribute_and_event_expressions() {
    let source = r#"
        import { LitElement, html } from 'lit';

        export class ButtonComp extends LitElement {
            static properties = { active: { type: Boolean } };

            render() {
                return html`<button ?disabled=${!this.active} @click=${this.handleClick}>Click</button>`;
            }
        }
    "#;

    let res = transform_code(source, DomPathsOptions::default());
    assert_eq!(
        res.components_count, 0,
        "Must bail out on attribute/event parts"
    );
    assert_eq!(res.paths_count, 0, "Must not count paths on bailout");
    assert!(
        !res.code.contains("static __litPartPaths"),
        "Must not inject static __litPartPaths dead code for attribute parts"
    );
}

#[test]
fn test_dead_code_pruning_on_undeclared_reactive_property() {
    let source = r#"
        import { LitElement, html } from 'lit';

        export class UndeclaredPropComp extends LitElement {
            static properties = { otherProp: { type: String } };

            render() {
                return html`<div><p>${this.undeclaredValue}</p></div>`;
            }
        }
    "#;

    let res = transform_code(source, DomPathsOptions::default());
    assert_eq!(
        res.components_count, 0,
        "Must bail out when expression uses undeclared property"
    );
    assert_eq!(res.paths_count, 0, "Must not count paths on bailout");
    assert!(
        !res.code.contains("static __litPartPaths"),
        "Must not inject static __litPartPaths dead code for undeclared property"
    );
}

#[test]
fn test_heap_retention_leak_elimination_stack_nodes() {
    let source = r#"
        import { LitElement, html } from 'lit';

        export class LeakFreeComp extends LitElement {
            static properties = { title: { type: String } };

            render() {
                return html`<h1>${this.title}</h1>`;
            }
        }
    "#;

    let res = transform_code(source, DomPathsOptions::default());
    assert_eq!(res.components_count, 1);
    assert_eq!(res.paths_count, 1);
    // Must contain ephemeral const __nodes = [];
    assert!(
        res.code.contains("const __nodes = [];"),
        "Must use stack-allocated local array for resolved nodes"
    );
    // Must NOT contain this.__litDomNodes anywhere
    assert!(
        !res.code.contains("__litDomNodes"),
        "Must not contain any reference to __litDomNodes on this or constructor"
    );
}

#[test]
fn test_bailout_on_reflected_property_in_static_properties() {
    let source = r#"
        import { LitElement, html } from 'lit';

        export class ReflectedComp extends LitElement {
            static properties = {
                active: { type: Boolean, reflect: true },
                count: { type: Number },
            };

            render() {
                return html`<div><p>${this.count}</p></div>`;
            }
        }
    "#;

    let res = transform_code(source, DomPathsOptions::default());
    assert_eq!(
        res.components_count, 0,
        "Must bail out on reflected property"
    );
    assert_eq!(res.paths_count, 0, "Must not count paths on bailout");
    assert!(
        !res.code.contains("static __litPartPaths"),
        "Must not inject static paths on bailout"
    );
}

#[test]
fn test_bailout_on_reflected_property_in_decorator() {
    let source = r#"
        import { LitElement, html } from 'lit';
        import { property } from 'lit/decorators.js';

        export class ReflectedDecoratorComp extends LitElement {
            @property({ type: Boolean, reflect: true })
            active = false;

            @property({ type: Number })
            count = 0;

            render() {
                return html`<div><p>${this.count}</p></div>`;
            }
        }
    "#;

    let res = transform_code(source, DomPathsOptions::default());
    assert_eq!(
        res.components_count, 0,
        "Must bail out on reflected decorator property"
    );
    assert_eq!(res.paths_count, 0, "Must not count paths on bailout");
    assert!(
        !res.code.contains("static __litPartPaths"),
        "Must not inject static paths on bailout"
    );
}
