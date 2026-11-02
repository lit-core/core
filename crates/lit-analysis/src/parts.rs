use crate::template_ir::{
    AttributePart, AttributePrefix, AttributeValue, TemplateIR, TemplateNode, TemplateParser,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Three-tier minimal marker part addressing taxonomy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PartAddressing {
    /// Element-anchored attribute, property, event, or boolean part (zero DOM markers).
    ElementAnchored {
        path: Vec<u32>,
        target_tag: Option<String>,
        attr_name: Option<String>,
        prefix: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        indices: Option<Vec<usize>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        strings: Option<Vec<String>>,
    },
    /// Sole text child of an element with zero sibling nodes (zero DOM markers).
    SoleTextChild {
        parent_path: Vec<u32>,
        parent_tag: Option<String>,
    },
    /// Range delimited dynamic expression requiring processing instruction or comment markers.
    #[serde(rename = "RangeAddressed", alias = "RangeMarker")]
    RangeMarker {
        name: String,
        start_path: Vec<u32>,
        parent_path: Vec<u32>,
    },
}

impl PartAddressing {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::ElementAnchored { .. } => "element",
            Self::SoleTextChild { .. } => "sole-text",
            Self::RangeMarker { .. } => "range",
        }
    }

    pub fn type_name(&self) -> &'static str {
        match self {
            Self::ElementAnchored { .. } => "ElementAnchored",
            Self::SoleTextChild { .. } => "SoleTextChild",
            Self::RangeMarker { .. } => "RangeAddressed",
        }
    }

    pub fn marker_name(&self) -> Option<&str> {
        match self {
            Self::RangeMarker { name, .. } => Some(name.as_str()),
            _ => None,
        }
    }
}

/// Sound, spec-compliant descriptor for a single dynamic part expression.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PartDescriptor {
    pub index: usize,
    pub path: Vec<u32>,
    pub is_attribute: bool,
    pub target_tag: Option<String>,
    pub addressing: PartAddressing,
}

/// Compute classified DOM part descriptors directly from quasi string slices.
pub fn compute_template_parts<T: AsRef<str>>(
    quasis: &[T],
    expression_count: usize,
) -> Result<Vec<PartDescriptor>, String> {
    if expression_count == 0 {
        return Ok(Vec::new());
    }
    let quasi_strs: Vec<&str> = quasis.iter().map(|q| q.as_ref()).collect();
    let ir = TemplateParser::parse_lit_template(&quasi_strs, expression_count)?;
    classify_parts_from_ir(&ir, expression_count)
}

/// Compute structural DOM child paths for dynamic parts directly from quasi string slices.
pub fn compute_template_paths<T: AsRef<str>>(
    quasis: &[T],
    expression_count: usize,
) -> Result<Vec<Vec<u32>>, String> {
    let parts = compute_template_parts(quasis, expression_count)?;
    Ok(parts.into_iter().map(|p| p.path).collect())
}

/// Classify part descriptors from a parsed TemplateIR tree.
pub fn classify_parts_from_ir(
    ir: &TemplateIR,
    expression_count: usize,
) -> Result<Vec<PartDescriptor>, String> {
    let mut parts_map = HashMap::new();
    collect_parts_from_nodes(&ir.roots, &[], None, &mut parts_map);

    let mut result = Vec::with_capacity(expression_count);
    for i in 0..expression_count {
        let desc = parts_map.remove(&i).ok_or_else(|| {
            format!(
                "Failed to resolve part descriptor for expression index {}",
                i
            )
        })?;
        result.push(desc);
    }
    Ok(result)
}

fn collect_parts_from_nodes(
    nodes: &[TemplateNode],
    current_path: &[u32],
    parent_tag: Option<&str>,
    parts: &mut HashMap<usize, PartDescriptor>,
) {
    for (child_idx, node) in nodes.iter().enumerate() {
        let mut child_path = current_path.to_vec();
        child_path.push(child_idx as u32);

        match node {
            TemplateNode::Element(el) => {
                for attr in &el.attributes {
                    match &attr.value {
                        AttributeValue::Dynamic(idx) | AttributeValue::Directive(idx) => {
                            let prefix_str = match attr.prefix {
                                AttributePrefix::Boolean => Some("?".to_string()),
                                AttributePrefix::Property => Some(".".to_string()),
                                AttributePrefix::Event => Some("@".to_string()),
                                AttributePrefix::Plain => None,
                            };
                            parts.insert(
                                *idx,
                                PartDescriptor {
                                    index: *idx,
                                    path: child_path.clone(),
                                    is_attribute: true,
                                    target_tag: Some(el.tag_name.clone()),
                                    addressing: PartAddressing::ElementAnchored {
                                        path: child_path.clone(),
                                        target_tag: Some(el.tag_name.clone()),
                                        attr_name: Some(attr.name.clone()),
                                        prefix: prefix_str,
                                        indices: None,
                                        strings: None,
                                    },
                                },
                            );
                        }
                        AttributeValue::Mixed(part_list) => {
                            let attr_strings = extract_attribute_strings(part_list);
                            let expr_indices: Vec<usize> = part_list
                                .iter()
                                .filter_map(|p| match p {
                                    AttributePart::Expression(idx) => Some(*idx),
                                    _ => None,
                                })
                                .collect();
                            for p in part_list {
                                if let AttributePart::Expression(idx) = p {
                                    parts.insert(
                                        *idx,
                                        PartDescriptor {
                                            index: *idx,
                                            path: child_path.clone(),
                                            is_attribute: true,
                                            target_tag: Some(el.tag_name.clone()),
                                            addressing: PartAddressing::ElementAnchored {
                                                path: child_path.clone(),
                                                target_tag: Some(el.tag_name.clone()),
                                                attr_name: Some(attr.name.clone()),
                                                prefix: None,
                                                indices: Some(expr_indices.clone()),
                                                strings: Some(attr_strings.clone()),
                                            },
                                        },
                                    );
                                }
                            }
                        }
                        AttributeValue::Static(_) => {}
                    }
                }
                collect_parts_from_nodes(&el.children, &child_path, Some(&el.tag_name), parts);
            }
            TemplateNode::Expression(idx) => {
                let is_sole_child = parent_tag.is_some() && nodes.len() == 1;
                let addressing = if is_sole_child {
                    PartAddressing::SoleTextChild {
                        parent_path: current_path.to_vec(),
                        parent_tag: parent_tag.map(|s| s.to_string()),
                    }
                } else {
                    PartAddressing::RangeMarker {
                        name: format!("p{}", idx),
                        start_path: child_path.clone(),
                        parent_path: current_path.to_vec(),
                    }
                };

                parts.insert(
                    *idx,
                    PartDescriptor {
                        index: *idx,
                        path: child_path,
                        is_attribute: false,
                        target_tag: parent_tag.map(|s| s.to_string()),
                        addressing,
                    },
                );
            }
            TemplateNode::Slot(slot) => {
                for attr in &slot.attributes {
                    match &attr.value {
                        AttributeValue::Dynamic(idx) | AttributeValue::Directive(idx) => {
                            let prefix_str = match attr.prefix {
                                AttributePrefix::Boolean => Some("?".to_string()),
                                AttributePrefix::Property => Some(".".to_string()),
                                AttributePrefix::Event => Some("@".to_string()),
                                AttributePrefix::Plain => None,
                            };
                            parts.insert(
                                *idx,
                                PartDescriptor {
                                    index: *idx,
                                    path: child_path.clone(),
                                    is_attribute: true,
                                    target_tag: Some("slot".to_string()),
                                    addressing: PartAddressing::ElementAnchored {
                                        path: child_path.clone(),
                                        target_tag: Some("slot".to_string()),
                                        attr_name: Some(attr.name.clone()),
                                        prefix: prefix_str,
                                        indices: None,
                                        strings: None,
                                    },
                                },
                            );
                        }
                        AttributeValue::Mixed(part_list) => {
                            let attr_strings = extract_attribute_strings(part_list);
                            let expr_indices: Vec<usize> = part_list
                                .iter()
                                .filter_map(|p| match p {
                                    AttributePart::Expression(idx) => Some(*idx),
                                    _ => None,
                                })
                                .collect();
                            for p in part_list {
                                if let AttributePart::Expression(idx) = p {
                                    parts.insert(
                                        *idx,
                                        PartDescriptor {
                                            index: *idx,
                                            path: child_path.clone(),
                                            is_attribute: true,
                                            target_tag: Some("slot".to_string()),
                                            addressing: PartAddressing::ElementAnchored {
                                                path: child_path.clone(),
                                                target_tag: Some("slot".to_string()),
                                                attr_name: Some(attr.name.clone()),
                                                prefix: None,
                                                indices: Some(expr_indices.clone()),
                                                strings: Some(attr_strings.clone()),
                                            },
                                        },
                                    );
                                }
                            }
                        }
                        AttributeValue::Static(_) => {}
                    }
                }
                collect_parts_from_nodes(&slot.fallback, &child_path, Some("slot"), parts);
            }
            TemplateNode::Text(_) | TemplateNode::Comment(_) => {}
        }
    }
}

pub fn extract_attribute_strings(parts: &[AttributePart]) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current_static = String::new();
    for p in parts {
        match p {
            AttributePart::Static(s) => {
                current_static.push_str(s);
            }
            AttributePart::Expression(_) => {
                strings.push(std::mem::take(&mut current_static));
            }
        }
    }
    strings.push(current_static);
    strings
}
