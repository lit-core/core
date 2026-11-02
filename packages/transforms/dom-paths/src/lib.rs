pub mod parser;
pub mod transform;

use crate::parser::{
    PartAddressing, PartDescriptor, compute_template_parts, compute_template_paths,
};
use crate::transform::{DomPathsOptions, DomPathsResult, transform_code};
use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NapiPartAddressing {
    pub r#type: String,
    pub kind: String,
    pub path: Option<Vec<u32>>,
    pub target_tag: Option<String>,
    pub attr_name: Option<String>,
    pub prefix: Option<String>,
    pub indices: Option<Vec<u32>>,
    pub strings: Option<Vec<String>>,
    pub parent_path: Option<Vec<u32>>,
    pub parent_tag: Option<String>,
    pub name: Option<String>,
    pub start_path: Option<Vec<u32>>,
}

impl From<PartAddressing> for NapiPartAddressing {
    fn from(addr: PartAddressing) -> Self {
        match addr {
            PartAddressing::ElementAnchored {
                path,
                target_tag,
                attr_name,
                prefix,
                indices,
                strings,
            } => Self {
                r#type: "ElementAnchored".to_string(),
                kind: "element".to_string(),
                path: Some(path),
                target_tag,
                attr_name,
                prefix,
                indices: indices.map(|list| list.into_iter().map(|i| i as u32).collect()),
                strings,
                parent_path: None,
                parent_tag: None,
                name: None,
                start_path: None,
            },
            PartAddressing::SoleTextChild {
                parent_path,
                parent_tag,
            } => Self {
                r#type: "SoleTextChild".to_string(),
                kind: "sole-text".to_string(),
                path: None,
                target_tag: None,
                attr_name: None,
                prefix: None,
                indices: None,
                strings: None,
                parent_path: Some(parent_path),
                parent_tag,
                name: None,
                start_path: None,
            },
            PartAddressing::RangeMarker {
                name,
                start_path,
                parent_path,
            } => Self {
                r#type: "RangeAddressed".to_string(),
                kind: "range".to_string(),
                path: None,
                target_tag: None,
                attr_name: None,
                prefix: None,
                indices: None,
                strings: None,
                parent_path: Some(parent_path),
                parent_tag: None,
                name: Some(name),
                start_path: Some(start_path),
            },
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NapiPartDescriptor {
    pub path: Vec<u32>,
    pub is_attribute: bool,
    pub target_tag: Option<String>,
    pub addressing: NapiPartAddressing,
}

impl From<PartDescriptor> for NapiPartDescriptor {
    fn from(p: PartDescriptor) -> Self {
        Self {
            path: p.path,
            is_attribute: p.is_attribute,
            target_tag: p.target_tag,
            addressing: NapiPartAddressing::from(p.addressing),
        }
    }
}

#[napi]
pub fn transform_dom_paths(source: String, options: Option<DomPathsOptions>) -> DomPathsResult {
    transform_code(&source, options.unwrap_or_default())
}

#[napi]
pub fn compute_dom_paths(
    template_strings: Vec<String>,
    normalize_whitespace: Option<bool>,
) -> Vec<Vec<u32>> {
    compute_template_paths(&template_strings, normalize_whitespace.unwrap_or(true))
}

#[napi]
pub fn compute_dom_parts(
    template_strings: Vec<String>,
    normalize_whitespace: Option<bool>,
) -> Vec<NapiPartDescriptor> {
    compute_template_parts(&template_strings, normalize_whitespace.unwrap_or(true))
        .into_iter()
        .map(NapiPartDescriptor::from)
        .collect()
}
