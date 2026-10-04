pub mod analyzer;
pub mod builder;
pub mod masker;
pub mod transform;

use crate::transform::{transform_code, DirtyMaskOptions, DirtyMaskResult};
use napi_derive::napi;

#[napi]
pub fn transform_dirty_mask(source: String, options: Option<DirtyMaskOptions>) -> DirtyMaskResult {
    transform_code(&source, options.unwrap_or_default())
}
