pub mod collapser;
pub mod visitor;

use crate::visitor::{collapse_code, CollapseOptions, CollapseResult};
use napi_derive::napi;

#[napi]
pub fn collapse_template_whitespace(
    source: String,
    options: Option<CollapseOptions>,
) -> CollapseResult {
    collapse_code(&source, options.unwrap_or_default())
}

#[napi]
pub fn minify_html_templates(source: String, options: Option<CollapseOptions>) -> CollapseResult {
    collapse_code(&source, options.unwrap_or_default())
}

#[napi]
pub fn minify_lit_templates(source: String, options: Option<CollapseOptions>) -> CollapseResult {
    collapse_code(&source, options.unwrap_or_default())
}

#[napi]
pub fn collapse_lit_templates(source: String, options: Option<CollapseOptions>) -> CollapseResult {
    collapse_code(&source, options.unwrap_or_default())
}
