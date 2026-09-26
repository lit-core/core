pub mod ast_helpers;
pub mod constructor;
pub mod decorators;
pub mod lit_import_scanner;
pub mod static_properties;
pub mod transform;

use crate::transform::{transform_code, TransformOptions, TransformResult};
use napi_derive::napi;

#[napi]
pub fn transform_lit_props(source: String, options: Option<TransformOptions>) -> TransformResult {
    transform_code(&source, options.unwrap_or_default())
}
