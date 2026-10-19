use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct TransformOptions {
    pub mode: Option<String>,
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
}

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct ClassifyOptions {
    pub mode: Option<String>,
    pub filename: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClassificationResult {
    pub mode: String,
    pub component_name: String,
    pub tag_name: Option<String>,
    pub reason: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransformResult {
    pub code: String,
    pub map: Option<String>,
    pub vanilla_count: u32,
    pub micro_count: u32,
    pub classifications: Vec<ClassificationResult>,
}
