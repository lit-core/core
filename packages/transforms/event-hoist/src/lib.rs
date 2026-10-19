pub mod analyzer;
pub mod builder;
pub mod hoister;
pub mod transform;

use crate::transform::{transform_code, EventHoistOptions, EventHoistResult};
use napi_derive::napi;

#[napi]
pub fn transform_event_hoist(
    source: String,
    options: Option<EventHoistOptions>,
) -> EventHoistResult {
    transform_code(&source, options.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transform_event_hoist_ast_builder() {
        let code = r#"
export class MyButton extends LitElement {
    render() {
        return html`<button @click=${this._handleClick}>Click</button>`;
    }
}
"#;
        let res = transform_event_hoist(code.to_string(), None);
        assert_eq!(res.hoisted_events_count, 1);
        assert_eq!(res.events, vec!["click".to_string()]);
        assert!(res.code.contains("__lhDispatch(eventName, event)"));
        assert!(res.code.contains("__lhAction(handler)"));
        assert!(res.code.contains("__initLitEventHoist()"));
        assert!(res.code.contains("connectedCallback()"));
    }
}
