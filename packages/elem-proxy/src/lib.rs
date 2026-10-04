pub mod extractor;
pub mod generator;
pub mod transform;

use crate::transform::{transform_code, ElemProxyOptions, ElemProxyResult};
use napi_derive::napi;

#[napi]
pub fn transform_elem_proxy(source: String, options: Option<ElemProxyOptions>) -> ElemProxyResult {
    transform_code(&source, options.unwrap_or_default())
}
