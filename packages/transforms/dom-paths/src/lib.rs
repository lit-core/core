pub mod parser;
pub mod transform;

use crate::parser::compute_template_paths;
use crate::transform::{transform_code, DomPathsOptions, DomPathsResult};
use napi_derive::napi;

#[napi]
pub fn transform_dom_paths(source: String, options: Option<DomPathsOptions>) -> DomPathsResult {
    transform_code(&source, options.unwrap_or_default())
}

#[napi]
pub fn compute_dom_paths(
    template_strings: Vec<String>,
    normalize_whitespace: Option<bool>,
) -> Vec<Vec<u32>> {
    compute_template_paths(&template_strings, normalize_whitespace.unwrap_or(true))
}
