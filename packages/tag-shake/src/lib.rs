pub mod detector;
pub mod options;
pub mod resolver;
pub mod scanner;
pub mod transformer;

use napi_derive::napi;
use options::{TagShakeOptions, TagShakeResult};

#[napi]
pub fn scan_tags(source: String, filename: Option<String>) -> Vec<String> {
    scanner::scan_custom_element_tags(&source, filename.as_deref())
}

#[napi]
pub fn transform_tag_shake(source: String, options: Option<TagShakeOptions>) -> TagShakeResult {
    transformer::transform_code(&source, options.unwrap_or_default())
}
