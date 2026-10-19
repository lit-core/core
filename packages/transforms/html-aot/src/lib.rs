pub mod parser;
pub mod transform;

use crate::transform::{transform_code, HtmlAotOptions, HtmlAotResult};
use napi_derive::napi;

#[napi]
pub fn transform_html_aot(source: String, options: Option<HtmlAotOptions>) -> HtmlAotResult {
    transform_code(&source, options.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transform_html_aot_ast_builder() {
        let code = r#"
import { html } from 'lit';
const tmpl = html`<div class="btn" id=${id}>${label}</div>`;
"#;
        let res = transform_html_aot(code.to_string(), None);
        assert_eq!(res.templates_count, 1);
        assert!(res.code.contains("const b_1 = (i) => i;"));
        assert!(res.code.contains("lit_template_1"));
        assert!(res.code.contains("lit-html/private-ssr-support.js"));
    }
}
