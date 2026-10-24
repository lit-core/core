pub mod builder;
pub mod extractor;
pub mod transform;

use crate::transform::{ElemProxyOptions, ElemProxyResult, transform_code};
use napi_derive::napi;

#[napi]
pub fn transform_elem_proxy(source: String, options: Option<ElemProxyOptions>) -> ElemProxyResult {
    transform_code(&source, options.unwrap_or_default())
}
