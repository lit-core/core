pub mod analyzer;
pub mod builder;
pub mod masker;
pub mod transform;

use crate::transform::{DirtyMaskOptions, DirtyMaskResult, transform_code};
use napi_derive::napi;

#[napi]
pub fn transform_dirty_mask(source: String, options: Option<DirtyMaskOptions>) -> DirtyMaskResult {
    transform_code(&source, options.unwrap_or_default())
}
