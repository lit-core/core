#![cfg(feature = "template-ir")]

use lit_analysis::analyze_lit_module;
use lit_analysis::classify::ClassificationTier;
use oxc_allocator::Allocator;

#[test]
fn test_tier_0_pure_classification() {
    let source = r#"
        import { LitElement, html } from 'lit';

        class LeafIcon extends LitElement {
            render() {
                return html`<svg><path d="M0 0h24v24H0z"/></svg>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "leaf.js").unwrap();
    assert_eq!(result.components.len(), 1);
    assert_eq!(result.components[0].tier, ClassificationTier::Tier0Pure);
}

#[test]
fn test_tier_1_hosted_classification() {
    let source = r#"
        import { LitElement, html, property } from 'lit';

        class StatefulButton extends LitElement {
            @property({ type: Boolean }) disabled = false;

            render() {
                return html`<button ?disabled=${this.disabled}>Click</button>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "btn.js").unwrap();
    assert_eq!(result.components.len(), 1);
    assert_eq!(result.components[0].tier, ClassificationTier::Tier1Hosted);
}

#[test]
fn test_tier_2_facade_classification() {
    let source = r#"
        import { LitElement, html } from 'lit';

        class TabsComponent extends LitElement {
            handleSlotChange() {}

            render() {
                return html`<div class="tabs"><slot @slotchange=${this.handleSlotChange}></slot></div>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "tabs.js").unwrap();
    assert_eq!(result.components.len(), 1);
    assert_eq!(
        result.components[0].tier,
        ClassificationTier::Tier2HostedWithFacade
    );
}

#[test]
fn test_bailout_unsupported_directive() {
    let source = r#"
        import { LitElement, html } from 'lit';
        import { until } from 'lit/directives/until.js';

        class AsyncComponent extends LitElement {
            render() {
                return html`<div>${until(Promise.resolve('loaded'), html`<span>loading</span>`)}</div>`;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "async.js").unwrap();
    assert_eq!(result.components.len(), 1);
    match &result.components[0].tier {
        ClassificationTier::Bailout { reasons } => {
            assert!(!reasons.is_empty());
        }
        other => panic!("Expected Bailout tier, got {:?}", other),
    }
    assert!(result
        .diagnostics
        .iter()
        .any(|d| d.code == lit_analysis::DiagnosticCode::LitBailUnsupportedDirective));
}
