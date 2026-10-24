pub mod analyzer;
pub mod builder;
pub mod finder;
pub mod transform;

use crate::transform::{MemoizeOptions, MemoizeResult, transform_code};
use napi_derive::napi;

#[napi]
pub fn transform_memoize(source: String, options: Option<MemoizeOptions>) -> MemoizeResult {
    transform_code(&source, options.unwrap_or_default())
}
