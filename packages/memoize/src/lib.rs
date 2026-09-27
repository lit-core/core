pub mod transform;

use crate::transform::{transform_code, MemoizeOptions, MemoizeResult};
use napi_derive::napi;

#[napi]
pub fn transform_memoize(source: String, options: Option<MemoizeOptions>) -> MemoizeResult {
    transform_code(&source, options.unwrap_or_default())
}
