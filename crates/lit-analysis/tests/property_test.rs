use lit_analysis::analyze_lit_module;
use lit_analysis::property::PropertyType;
use oxc_allocator::Allocator;

#[test]
fn test_property_model_extraction() {
    let source = r#"
        import { LitElement, property } from 'lit';

        class MyComponent extends LitElement {
            @property({ type: String, reflect: true }) variant = 'primary';
            @property({ type: Number }) count = 42;
            @property({ type: Boolean, attribute: false }) active;

            constructor() {
                super();
                this.active = !0; // minified boolean
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "component.ts").unwrap();
    assert_eq!(result.components.len(), 1);

    let comp = &result.components[0];
    let variant = comp
        .properties
        .iter()
        .find(|p| p.name == "variant")
        .unwrap();
    assert_eq!(variant.property_type, PropertyType::String);
    assert!(variant.reflect);
    assert_eq!(variant.attribute, Some("variant".to_string()));
    assert_eq!(variant.default_value, Some("\"primary\"".to_string()));

    let count = comp.properties.iter().find(|p| p.name == "count").unwrap();
    assert_eq!(count.property_type, PropertyType::Number);
    assert_eq!(count.default_value, Some("42".to_string()));

    let active = comp.properties.iter().find(|p| p.name == "active").unwrap();
    assert_eq!(active.property_type, PropertyType::Boolean);
    assert_eq!(
        active.attribute, None,
        "attribute: false should disable attribute mapping"
    );
    assert_eq!(active.default_value, Some("true".to_string()));
}

#[test]
fn test_static_properties_declarations() {
    let source = r#"
        import { LitElement } from 'lit';

        class StaticComponent extends LitElement {
            static properties = {
                disabled: { type: Boolean, reflect: true },
                label: { type: String, attribute: 'aria-label' },
            };

            constructor() {
                super();
                this.disabled = false;
            }
        }
    "#;

    let allocator = Allocator::default();
    let result = analyze_lit_module(&allocator, source, "static.js").unwrap();
    assert_eq!(result.components.len(), 1);

    let comp = &result.components[0];
    let disabled = comp
        .properties
        .iter()
        .find(|p| p.name == "disabled")
        .unwrap();
    assert_eq!(disabled.property_type, PropertyType::Boolean);
    assert!(disabled.reflect);
    assert_eq!(disabled.default_value, Some("false".to_string()));

    let label = comp.properties.iter().find(|p| p.name == "label").unwrap();
    assert_eq!(label.property_type, PropertyType::String);
    assert_eq!(label.attribute, Some("aria-label".to_string()));
}
