pub mod parser;
pub mod transform;

use crate::transform::{transform_code, HtmlAotOptions, HtmlAotResult};
use napi_derive::napi;

#[napi]
pub fn transform_html_aot(source: String, options: Option<HtmlAotOptions>) -> HtmlAotResult {
    transform_code(&source, options.unwrap_or_default())
}
