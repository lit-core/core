pub mod analyzer;
pub mod builder;
pub mod hoister;
pub mod transform;

use crate::transform::{transform_code, EventHoistOptions, EventHoistResult};
use napi_derive::napi;

#[napi]
pub fn transform_event_hoist(
    source: String,
    options: Option<EventHoistOptions>,
) -> EventHoistResult {
    transform_code(&source, options.unwrap_or_default())
}
