pub mod ast_helpers;
pub mod import_scanner;
pub mod transform;

use crate::transform::{transform_code, DirectivesOptions, DirectivesResult};
use napi_derive::napi;

#[napi]
pub fn transform_directives(
    source: String,
    options: Option<DirectivesOptions>,
) -> DirectivesResult {
    transform_code(&source, options.unwrap_or_default())
}
