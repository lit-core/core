pub mod ast_helpers;
pub mod prune;
pub mod transform;
pub mod utils;

use crate::transform::{DirectivesOptions, DirectivesResult, transform_code};
use napi_derive::napi;

#[napi]
pub fn transform_directives(
    source: String,
    options: Option<DirectivesOptions>,
) -> DirectivesResult {
    transform_code(&source, options.unwrap_or_default())
}
