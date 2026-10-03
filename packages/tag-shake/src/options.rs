use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagShakeOptions {
    pub used_tags: Option<Vec<String>>,
    pub filename: Option<String>,
    pub sourcemap: Option<bool>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagShakeResult {
    pub code: String,
    pub map: Option<String>,
    pub removed_tags: Vec<String>,
    pub preserved_tags: Vec<String>,
    pub shaken_registrations_count: u32,
    pub pruned_imports_count: u32,
    pub is_empty: bool,
}
