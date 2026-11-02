use lit_analysis::parts::{
    PartAddressing, PartDescriptor, classify_parts_from_ir, extract_attribute_strings,
};
use lit_analysis::template_ir::{
    AttributePart, AttributePrefix, AttributeValue, ElementNamespace, OrderedAttrs, TemplateNode,
    TemplateParser, is_void_element,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SsrDynamicAttribute {
    #[serde(rename = "attribute")]
    Attribute {
        name: String,
        index: usize,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        indices: Option<Vec<usize>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        strings: Option<Vec<String>>,
    },
    #[serde(rename = "boolean")]
    Boolean { name: String, index: usize },
    #[serde(rename = "property")]
    Property {
        name: String,
        index: usize,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        indices: Option<Vec<usize>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        strings: Option<Vec<String>>,
    },
    #[serde(rename = "event")]
    Event { name: String, index: usize },
    #[serde(rename = "directive")]
    Directive { index: usize },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SsrMarkerSite {
    pub name: String,
    pub index: usize,
    pub parent_path: Vec<u32>,
    pub start_path: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SsrOpcode {
    #[serde(rename = "open")]
    OpenElement {
        tag: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        is_custom_element: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        is_void: bool,
        #[serde(
            default = "default_element_namespace",
            skip_serializing_if = "is_html_namespace"
        )]
        namespace: ElementNamespace,
        #[serde(default, skip_serializing_if = "OrderedAttrs::is_empty")]
        static_attrs: OrderedAttrs,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        dynamic_attrs: Vec<SsrDynamicAttribute>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        close_index: Option<usize>,
    },

    #[serde(rename = "close")]
    CloseElement { tag: String },

    #[serde(rename = "text")]
    Text { value: String },

    #[serde(rename = "comment")]
    Comment { value: String },

    #[serde(rename = "part")]
    DynamicPart { index: usize },

    #[serde(rename = "marker-start")]
    RangeMarkerStart {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        h: Option<String>,
    },

    #[serde(rename = "marker-end")]
    RangeMarkerEnd,
}

fn default_element_namespace() -> ElementNamespace {
    ElementNamespace::Html
}

fn is_html_namespace(ns: &ElementNamespace) -> bool {
    matches!(ns, ElementNamespace::Html)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SsrTemplatePlan {
    pub v: u8,
    pub h: String,
    pub opcodes: Vec<SsrOpcode>,
    pub marker_sites: Vec<SsrMarkerSite>,
    pub parts: Vec<PartDescriptor>,
}

pub fn compute_template_id(quasis: &[&str]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"lit-template:v2:");
    hasher.update(&(quasis.len() as u32).to_le_bytes());
    for q in quasis {
        hasher.update(&(q.len() as u32).to_le_bytes());
        hasher.update(q.as_bytes());
    }
    let hex = hasher.finalize().to_hex();
    hex[..16].to_string()
}

impl SsrTemplatePlan {
    pub fn build(quasis: &[String], expression_count: usize) -> Option<Self> {
        let quasi_strs: Vec<&str> = quasis.iter().map(|s| s.as_str()).collect();
        let ir = TemplateParser::parse_lit_template(&quasi_strs, expression_count).ok()?;
        if has_binding_inside_inert_template(&ir.roots) {
            return None;
        }
        let parts = classify_parts_from_ir(&ir, expression_count).ok()?;
        let template_id = compute_template_id(&quasi_strs);

        let mut opcodes = Vec::new();
        let mut marker_sites = Vec::new();

        build_opcodes_from_nodes(
            &ir.roots,
            &parts,
            &template_id,
            &mut opcodes,
            &mut marker_sites,
            false,
        );

        Some(SsrTemplatePlan {
            v: 2,
            h: template_id,
            opcodes,
            marker_sites,
            parts,
        })
    }
}

fn node_tree_has_dynamic_binding(nodes: &[TemplateNode]) -> bool {
    for node in nodes {
        match node {
            TemplateNode::Expression(_) => return true,
            TemplateNode::Element(el) => {
                for attr in &el.attributes {
                    if !matches!(attr.value, AttributeValue::Static(_)) {
                        return true;
                    }
                }
                if node_tree_has_dynamic_binding(&el.children) {
                    return true;
                }
            }
            TemplateNode::Slot(slot) => {
                for attr in &slot.attributes {
                    if !matches!(attr.value, AttributeValue::Static(_)) {
                        return true;
                    }
                }
                if node_tree_has_dynamic_binding(&slot.fallback) {
                    return true;
                }
            }
            TemplateNode::Text(_) | TemplateNode::Comment(_) => {}
        }
    }
    false
}

fn has_binding_inside_inert_template(nodes: &[TemplateNode]) -> bool {
    for node in nodes {
        match node {
            TemplateNode::Element(el) => {
                if el.tag_name.eq_ignore_ascii_case("template") {
                    let is_dsd = el.attributes.iter().any(|attr| {
                        matches!(attr.value, AttributeValue::Static(_))
                            && (attr.name.eq_ignore_ascii_case("shadowrootmode")
                                || attr.name.eq_ignore_ascii_case("shadowroot"))
                    });
                    if !is_dsd && node_tree_has_dynamic_binding(&el.children) {
                        return true;
                    }
                }
                if has_binding_inside_inert_template(&el.children) {
                    return true;
                }
            }
            TemplateNode::Slot(slot) => {
                if has_binding_inside_inert_template(&slot.fallback) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn escape_html_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
    }
    out
}

fn build_opcodes_from_nodes(
    nodes: &[TemplateNode],
    parts: &[PartDescriptor],
    template_id: &str,
    opcodes: &mut Vec<SsrOpcode>,
    marker_sites: &mut Vec<SsrMarkerSite>,
    in_raw_text: bool,
) {
    for node in nodes {
        match node {
            TemplateNode::Element(el) => {
                let is_void = is_void_element(&el.tag_name);
                let is_custom_element = el.tag_name.contains('-');
                let is_raw_text = el.tag_name.eq_ignore_ascii_case("script")
                    || el.tag_name.eq_ignore_ascii_case("style");

                let mut static_attrs = OrderedAttrs::new();
                let mut dynamic_attrs = Vec::new();

                for attr in &el.attributes {
                    match &attr.value {
                        AttributeValue::Static(val) => {
                            let prefix_str = match attr.prefix {
                                AttributePrefix::Boolean => "?",
                                AttributePrefix::Property => ".",
                                AttributePrefix::Event => "@",
                                AttributePrefix::Plain => "",
                            };
                            let key = if prefix_str.is_empty() {
                                attr.name.clone()
                            } else {
                                format!("{}{}", prefix_str, attr.name)
                            };
                            static_attrs.insert(key, val.clone());
                        }
                        AttributeValue::Dynamic(idx) => {
                            let dyn_attr = match attr.prefix {
                                AttributePrefix::Boolean => SsrDynamicAttribute::Boolean {
                                    name: attr.name.clone(),
                                    index: *idx,
                                },
                                AttributePrefix::Property => SsrDynamicAttribute::Property {
                                    name: attr.name.clone(),
                                    index: *idx,
                                    indices: None,
                                    strings: None,
                                },
                                AttributePrefix::Event => SsrDynamicAttribute::Event {
                                    name: attr.name.clone(),
                                    index: *idx,
                                },
                                AttributePrefix::Plain => SsrDynamicAttribute::Attribute {
                                    name: attr.name.clone(),
                                    index: *idx,
                                    indices: None,
                                    strings: None,
                                },
                            };
                            dynamic_attrs.push(dyn_attr);
                        }
                        AttributeValue::Directive(idx) => {
                            dynamic_attrs.push(SsrDynamicAttribute::Directive { index: *idx });
                        }
                        AttributeValue::Mixed(part_list) => {
                            let strings = extract_attribute_strings(part_list);
                            let expr_indices: Vec<usize> = part_list
                                .iter()
                                .filter_map(|p| match p {
                                    AttributePart::Expression(idx) => Some(*idx),
                                    _ => None,
                                })
                                .collect();
                            let first_idx = expr_indices.first().copied().unwrap_or(0);
                            let dyn_attr = match attr.prefix {
                                AttributePrefix::Property => SsrDynamicAttribute::Property {
                                    name: attr.name.clone(),
                                    index: first_idx,
                                    indices: Some(expr_indices),
                                    strings: Some(strings),
                                },
                                AttributePrefix::Boolean => SsrDynamicAttribute::Boolean {
                                    name: attr.name.clone(),
                                    index: first_idx,
                                },
                                AttributePrefix::Event => SsrDynamicAttribute::Event {
                                    name: attr.name.clone(),
                                    index: first_idx,
                                },
                                AttributePrefix::Plain => SsrDynamicAttribute::Attribute {
                                    name: attr.name.clone(),
                                    index: first_idx,
                                    indices: Some(expr_indices),
                                    strings: Some(strings),
                                },
                            };
                            dynamic_attrs.push(dyn_attr);
                        }
                    }
                }

                let open_idx = opcodes.len();
                opcodes.push(SsrOpcode::OpenElement {
                    tag: el.tag_name.clone(),
                    is_custom_element,
                    is_void,
                    namespace: el.namespace,
                    static_attrs,
                    dynamic_attrs,
                    close_index: None,
                });

                if !is_void {
                    build_opcodes_from_nodes(
                        &el.children,
                        parts,
                        template_id,
                        opcodes,
                        marker_sites,
                        in_raw_text || is_raw_text,
                    );
                    let close_idx = opcodes.len();
                    if let SsrOpcode::OpenElement { close_index, .. } = &mut opcodes[open_idx] {
                        *close_index = Some(close_idx);
                    }
                    opcodes.push(SsrOpcode::CloseElement {
                        tag: el.tag_name.clone(),
                    });
                }
            }
            TemplateNode::Text(val) => {
                let text_val = if in_raw_text {
                    val.clone()
                } else {
                    escape_html_text(val)
                };
                opcodes.push(SsrOpcode::Text { value: text_val });
            }
            TemplateNode::Comment(val) => {
                opcodes.push(SsrOpcode::Comment { value: val.clone() });
            }
            TemplateNode::Expression(idx) => {
                if let Some(desc) = parts.get(*idx) {
                    match &desc.addressing {
                        PartAddressing::SoleTextChild { .. } => {
                            opcodes.push(SsrOpcode::DynamicPart { index: *idx });
                        }
                        PartAddressing::RangeMarker {
                            name,
                            start_path,
                            parent_path,
                        } => {
                            opcodes.push(SsrOpcode::RangeMarkerStart {
                                name: name.clone(),
                                h: Some(template_id.to_string()),
                            });
                            opcodes.push(SsrOpcode::DynamicPart { index: *idx });
                            opcodes.push(SsrOpcode::RangeMarkerEnd);
                            marker_sites.push(SsrMarkerSite {
                                name: name.clone(),
                                index: *idx,
                                parent_path: parent_path.clone(),
                                start_path: start_path.clone(),
                            });
                        }
                        PartAddressing::ElementAnchored { .. } => {
                            // Element-anchored attributes are placed on OpenElement
                        }
                    }
                } else {
                    opcodes.push(SsrOpcode::DynamicPart { index: *idx });
                }
            }
            TemplateNode::Slot(slot) => {
                let mut static_attrs = OrderedAttrs::new();
                let mut dynamic_attrs = Vec::new();
                for attr in &slot.attributes {
                    match &attr.value {
                        AttributeValue::Static(val) => {
                            static_attrs.insert(attr.name.clone(), val.clone());
                        }
                        AttributeValue::Dynamic(idx) => {
                            let dyn_attr = match attr.prefix {
                                AttributePrefix::Boolean => SsrDynamicAttribute::Boolean {
                                    name: attr.name.clone(),
                                    index: *idx,
                                },
                                AttributePrefix::Property => SsrDynamicAttribute::Property {
                                    name: attr.name.clone(),
                                    index: *idx,
                                    indices: None,
                                    strings: None,
                                },
                                AttributePrefix::Event => SsrDynamicAttribute::Event {
                                    name: attr.name.clone(),
                                    index: *idx,
                                },
                                AttributePrefix::Plain => SsrDynamicAttribute::Attribute {
                                    name: attr.name.clone(),
                                    index: *idx,
                                    indices: None,
                                    strings: None,
                                },
                            };
                            dynamic_attrs.push(dyn_attr);
                        }
                        AttributeValue::Directive(idx) => {
                            dynamic_attrs.push(SsrDynamicAttribute::Directive { index: *idx });
                        }
                        AttributeValue::Mixed(part_list) => {
                            let strings = extract_attribute_strings(part_list);
                            let expr_indices: Vec<usize> = part_list
                                .iter()
                                .filter_map(|p| match p {
                                    AttributePart::Expression(idx) => Some(*idx),
                                    _ => None,
                                })
                                .collect();
                            let first_idx = expr_indices.first().copied().unwrap_or(0);
                            let dyn_attr = match attr.prefix {
                                AttributePrefix::Property => SsrDynamicAttribute::Property {
                                    name: attr.name.clone(),
                                    index: first_idx,
                                    indices: Some(expr_indices),
                                    strings: Some(strings),
                                },
                                AttributePrefix::Boolean => SsrDynamicAttribute::Boolean {
                                    name: attr.name.clone(),
                                    index: first_idx,
                                },
                                AttributePrefix::Event => SsrDynamicAttribute::Event {
                                    name: attr.name.clone(),
                                    index: first_idx,
                                },
                                AttributePrefix::Plain => SsrDynamicAttribute::Attribute {
                                    name: attr.name.clone(),
                                    index: first_idx,
                                    indices: Some(expr_indices),
                                    strings: Some(strings),
                                },
                            };
                            dynamic_attrs.push(dyn_attr);
                        }
                    }
                }
                let open_idx = opcodes.len();
                opcodes.push(SsrOpcode::OpenElement {
                    tag: "slot".to_string(),
                    is_custom_element: false,
                    is_void: false,
                    namespace: ElementNamespace::Html,
                    static_attrs,
                    dynamic_attrs,
                    close_index: None,
                });
                build_opcodes_from_nodes(
                    &slot.fallback,
                    parts,
                    template_id,
                    opcodes,
                    marker_sites,
                    in_raw_text,
                );
                let close_idx = opcodes.len();
                if let SsrOpcode::OpenElement { close_index, .. } = &mut opcodes[open_idx] {
                    *close_index = Some(close_idx);
                }
                opcodes.push(SsrOpcode::CloseElement {
                    tag: "slot".to_string(),
                });
            }
        }
    }
}
