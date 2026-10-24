pub mod parser;
pub mod transform;

use crate::transform::{HtmlAotOptions, HtmlAotResult, transform_code};
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

    #[test]
    fn test_ignores_shadowed_or_unimported_html() {
        let code = r#"
const html = (strings, ...values) => strings.join("");
const tmpl = html`<div>${label}</div>`;
"#;
        let res = transform_html_aot(code.to_string(), None);
        assert_eq!(res.templates_count, 0);
        assert!(!res.code.contains("const b_1"));
    }

    #[test]
    fn test_aliased_lit_html_import() {
        let code = r#"
import { html as myHtml } from 'lit';
const tmpl = myHtml`<div class="btn">${label}</div>`;
"#;
        let res = transform_html_aot(code.to_string(), None);
        assert_eq!(res.templates_count, 1);
        assert!(res.code.contains("lit_template_1"));
    }

    #[test]
    fn test_namespace_lit_html_import() {
        let code = r#"
import * as lit from 'lit';
const tmpl = lit.html`<div class="btn">${label}</div>`;
"#;
        let res = transform_html_aot(code.to_string(), None);
        assert_eq!(res.templates_count, 1);
        assert!(res.code.contains("lit_template_1"));
    }

    #[test]
    fn test_scope_collision_avoidance() {
        let code = r#"
import { html } from 'lit';
const b_1 = "occupied";
const lit_template_1 = "occupied";
const tmpl = html`<div class="btn">${label}</div>`;
"#;
        let res = transform_html_aot(code.to_string(), None);
        assert_eq!(res.templates_count, 1);
        assert!(res.code.contains("const b_2 = (i) => i;"));
        assert!(res.code.contains("lit_template_2"));
        assert!(!res.code.contains("const b_1 = (i) => i;"));
    }

    #[test]
    fn test_ambient_unresolved_reference_collision_avoidance() {
        let code = r#"
import { html } from 'lit';
console.log(b_1, lit_template_1);
export const tmpl = html`<div class="btn">${label}</div>`;
"#;
        let res = transform_html_aot(code.to_string(), None);
        assert_eq!(res.templates_count, 1);
        assert!(res.code.contains("const b_2 = (i) => i;"));
        assert!(res.code.contains("const lit_template_2 ="));
        assert!(!res.code.contains("const b_1 = (i) => i;"));
        assert!(!res.code.contains("const lit_template_1 ="));
    }
}
