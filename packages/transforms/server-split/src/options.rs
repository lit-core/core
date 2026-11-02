use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct ServerSplitOptions {
    pub filename: Option<String>,
    pub sourcemap: Option<bool>,
    pub action_route_prefix: Option<String>,
    pub emit_zero_lit_client: Option<bool>,
    pub build_id: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ParamValidationMeta {
    pub name: String,
    pub ts_type: String,
    pub optional: bool,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActionMetadata {
    pub name: String,
    pub hash: String,
    pub params: Vec<ParamValidationMeta>,
    pub written_properties: Vec<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoaderMetadata {
    pub name: String,
    pub written_properties: Vec<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerSplitDiagnostic {
    pub code: String,
    pub severity: String,
    pub message: String,
    pub start: u32,
    pub end: u32,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServerSplitResult {
    pub is_server_element: bool,
    pub tag_name: Option<String>,
    pub class_name: Option<String>,
    pub client_code: String,
    pub worker_code: String,
    pub actions: Vec<ActionMetadata>,
    pub loaders: Vec<LoaderMetadata>,
    pub diagnostics: Vec<ServerSplitDiagnostic>,
    pub has_errors: bool,
    pub zero_lit: bool,
    pub build_id: Option<String>,
    pub client_map: Option<String>,
    pub worker_map: Option<String>,
}
