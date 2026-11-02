use html5ever::driver::ParseOpts;
use html5ever::tendril::TendrilSink;
use html5ever::{QualName, local_name, namespace_url, ns, parse_document, parse_fragment};
use lit_analysis::parts::{
    PartAddressing, PartDescriptor, classify_parts_from_ir, extract_attribute_strings,
};
use lit_analysis::template_ir::{
    AttributePart, AttributePrefix, AttributeValue, ElementNamespace, OrderedAttrs, TemplateNode,
    TemplateParser, is_void_element,
};
use markup5ever_rcdom::{Handle, NodeData, RcDom};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Deserialize)]
pub struct RawDescriptorPart {
    #[serde(rename = "type")]
    pub part_type: usize,
    #[serde(default)]
    pub index: Option<isize>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub strings: Option<Vec<String>>,
    #[serde(rename = "ctorType", default)]
    pub ctor_type: Option<usize>,
}

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
#[serde(rename_all = "camelCase")]
pub struct SsrMarkerSite {
    pub name: String,
    pub index: usize,
    pub parent_path: Vec<u32>,
    pub start_path: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SsrOpcode {
    #[serde(rename = "open", rename_all = "camelCase")]
    OpenElement {
        tag: String,
        #[serde(
            rename = "isCustomElement",
            default,
            skip_serializing_if = "std::ops::Not::not"
        )]
        is_custom_element: bool,
        #[serde(rename = "isVoid", default, skip_serializing_if = "std::ops::Not::not")]
        is_void: bool,
        #[serde(
            rename = "isSelfClosing",
            default,
            skip_serializing_if = "std::ops::Not::not"
        )]
        is_self_closing: bool,
        #[serde(
            default = "default_element_namespace",
            skip_serializing_if = "is_html_namespace"
        )]
        namespace: ElementNamespace,
        #[serde(
            rename = "staticAttrs",
            default,
            skip_serializing_if = "OrderedAttrs::is_empty"
        )]
        static_attrs: OrderedAttrs,
        #[serde(
            rename = "dynamicAttrs",
            default,
            skip_serializing_if = "Vec::is_empty"
        )]
        dynamic_attrs: Vec<SsrDynamicAttribute>,
        #[serde(
            rename = "closeIndex",
            default,
            skip_serializing_if = "Option::is_none"
        )]
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
#[serde(rename_all = "camelCase")]
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

fn is_full_html_document(input: &str) -> bool {
    let trimmed = input.trim_start();
    if trimmed.len() >= 9 && trimmed[..9].eq_ignore_ascii_case("<!doctype") {
        return true;
    }
    if trimmed.len() >= 5 && trimmed[..5].eq_ignore_ascii_case("<html") {
        let next = trimmed[5..].chars().next();
        return matches!(next, None | Some('>') | Some('/'))
            || next.is_some_and(|c| c.is_ascii_whitespace());
    }
    false
}

pub fn extract_module_script_srcs(html: &str) -> Vec<String> {
    let dom = if is_full_html_document(html) {
        parse_document(RcDom::default(), ParseOpts::default()).one(html)
    } else {
        let context_name = QualName::new(None, ns!(html), local_name!("template"));
        parse_fragment(RcDom::default(), ParseOpts::default(), context_name, vec![]).one(html)
    };

    let mut srcs = Vec::new();
    collect_module_scripts(&dom.document.children.borrow(), &mut srcs);
    srcs
}

fn collect_module_scripts(nodes: &[Handle], srcs: &mut Vec<String>) {
    for handle in nodes {
        if let NodeData::Element {
            ref name,
            ref attrs,
            ref template_contents,
            ..
        } = handle.data
        {
            if name.local.as_ref().eq_ignore_ascii_case("script") {
                let borrowed = attrs.borrow();
                let mut is_module = false;
                let mut src_val: Option<String> = None;
                for attr in borrowed.iter() {
                    if attr.name.local.as_ref().eq_ignore_ascii_case("type")
                        && attr.value.trim().eq_ignore_ascii_case("module")
                    {
                        is_module = true;
                    } else if attr.name.local.as_ref().eq_ignore_ascii_case("src") {
                        let s = attr.value.trim();
                        if !s.is_empty() {
                            src_val = Some(s.to_string());
                        }
                    }
                }
                if is_module && let Some(src) = src_val {
                    srcs.push(src);
                }
            }
            if let Some(ref tpl_doc) = *template_contents.borrow() {
                collect_module_scripts(&tpl_doc.children.borrow(), srcs);
            }
            collect_module_scripts(&handle.children.borrow(), srcs);
        }
    }
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

    pub fn build_from_html_document(html: &str) -> Option<Self> {
        let mut opcodes = Vec::new();
        if is_full_html_document(html) {
            let dom = parse_document(RcDom::default(), ParseOpts::default()).one(html);
            walk_static_dom_nodes(&dom.document.children.borrow(), false, &mut opcodes);
        } else {
            let context_name = QualName::new(None, ns!(html), local_name!("template"));
            let dom = parse_fragment(RcDom::default(), ParseOpts::default(), context_name, vec![])
                .one(html);
            let doc_children = dom.document.children.borrow();
            if let Some(html_root) = doc_children.first() {
                walk_static_dom_nodes(&html_root.children.borrow(), false, &mut opcodes);
            }
        }

        let mut hasher = blake3::Hasher::new();
        hasher.update(b"lit-document-plan:v2:");
        hasher.update(html.as_bytes());
        let hex = hasher.finalize().to_hex();
        let template_id = hex[..16].to_string();

        Some(SsrTemplatePlan {
            v: 2,
            h: template_id,
            opcodes,
            marker_sites: Vec::new(),
            parts: Vec::new(),
        })
    }

    pub fn build_from_descriptor(h: &str, parts_json: &str) -> Option<Self> {
        let raw_parts: Vec<RawDescriptorPart> = serde_json::from_str(parts_json).ok()?;
        let mut attr_parts_by_elem: HashMap<usize, Vec<(usize, RawDescriptorPart)>> =
            HashMap::new();
        let mut child_parts_by_index: HashMap<usize, Vec<(usize, RawDescriptorPart)>> =
            HashMap::new();
        let mut child_parts_in_order: Vec<(usize, RawDescriptorPart)> = Vec::new();

        for (val_idx, p) in raw_parts.into_iter().enumerate() {
            match p.part_type {
                1 => {
                    let idx = p.index?;
                    if idx < 0 || p.name.as_deref().unwrap_or("").is_empty() {
                        return None;
                    }
                    attr_parts_by_elem
                        .entry(idx as usize)
                        .or_default()
                        .push((val_idx, p));
                }
                6 => {
                    let idx = p.index?;
                    if idx < 0 {
                        return None;
                    }
                    attr_parts_by_elem
                        .entry(idx as usize)
                        .or_default()
                        .push((val_idx, p));
                }
                2 | 7 => {
                    if let Some(idx) = p.index {
                        if idx < 0 {
                            return None;
                        }
                        child_parts_by_index
                            .entry(idx as usize)
                            .or_default()
                            .push((val_idx, p.clone()));
                    }
                    child_parts_in_order.push((val_idx, p));
                }
                _ => return None,
            }
        }

        let context_name = QualName::new(None, ns!(html), local_name!("template"));
        let dom =
            parse_fragment(RcDom::default(), ParseOpts::default(), context_name, vec![]).one(h);

        let mut ctx = DescriptorWalkContext {
            node_index: -1,
            attr_parts: &attr_parts_by_elem,
            child_parts_by_index: &child_parts_by_index,
            child_parts_in_order: &child_parts_in_order,
            consumed_attr_elems: HashSet::new(),
            consumed_child_parts: HashSet::new(),
            child_part_counter: 0,
            in_raw_text: false,
        };
        let mut opcodes = Vec::new();

        let doc_children = dom.document.children.borrow();
        if let Some(html_root) = doc_children.first() {
            let root_children = html_root.children.borrow();
            walk_descriptor_nodes(&root_children, &mut ctx, &mut opcodes).ok()?;
        }

        if ctx.consumed_attr_elems.len() != attr_parts_by_elem.len()
            || ctx.consumed_child_parts.len() != child_parts_in_order.len()
        {
            return None;
        }

        let mut hasher = blake3::Hasher::new();
        hasher.update(b"lit-descriptor-plan:v2:");
        hasher.update(h.as_bytes());
        let hex = hasher.finalize().to_hex();
        let template_id = hex[..16].to_string();

        Some(SsrTemplatePlan {
            v: 2,
            h: template_id,
            opcodes,
            marker_sites: Vec::new(),
            parts: Vec::new(),
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
            TemplateNode::Slot(slot) if has_binding_inside_inert_template(&slot.fallback) => {
                return true;
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
                    is_self_closing: false,
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
                    is_self_closing: false,
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

fn walk_static_dom_nodes(nodes: &[Handle], in_raw_text: bool, opcodes: &mut Vec<SsrOpcode>) {
    for handle in nodes {
        match handle.data {
            NodeData::Document => {
                walk_static_dom_nodes(&handle.children.borrow(), in_raw_text, opcodes);
            }
            NodeData::Doctype { ref name, .. } => {
                opcodes.push(SsrOpcode::Text {
                    value: format!("<!DOCTYPE {}>", name),
                });
            }
            NodeData::Text { ref contents } => {
                let text = contents.borrow().to_string();
                if !text.is_empty() {
                    let val = if in_raw_text {
                        text
                    } else {
                        escape_html_text(&text)
                    };
                    opcodes.push(SsrOpcode::Text { value: val });
                }
            }
            NodeData::Comment { ref contents } => {
                opcodes.push(SsrOpcode::Comment {
                    value: contents.to_string(),
                });
            }
            NodeData::ProcessingInstruction {
                ref target,
                ref contents,
            } => {
                let data = contents.as_ref();
                let pi = if data.is_empty() {
                    format!("<?{}>", target)
                } else {
                    format!("<?{} {}>", target, data)
                };
                opcodes.push(SsrOpcode::Text { value: pi });
            }
            NodeData::Element {
                ref name,
                ref attrs,
                ref template_contents,
                ..
            } => {
                let tag_name: &str = name.local.as_ref();
                let is_void = is_void_element(tag_name);
                let is_custom_element = tag_name.contains('-');
                let is_raw = tag_name.eq_ignore_ascii_case("script")
                    || tag_name.eq_ignore_ascii_case("style");

                let namespace = if name.ns == ns!(svg) {
                    ElementNamespace::Svg
                } else if name.ns == ns!(mathml) {
                    ElementNamespace::MathML
                } else {
                    ElementNamespace::Html
                };

                let recovered_tag_name = if namespace == ElementNamespace::Svg {
                    TemplateParser::recover_svg_element_tag_casing(tag_name)
                } else {
                    tag_name.to_string()
                };

                let mut static_attrs = OrderedAttrs::new();
                for attr in attrs.borrow().iter() {
                    let raw_attr_name = if let Some(ref prefix) = attr.name.prefix {
                        format!("{}:{}", prefix, attr.name.local)
                    } else {
                        attr.name.local.to_string()
                    };
                    let attr_name =
                        TemplateParser::recover_attribute_casing(&raw_attr_name, namespace);
                    static_attrs.insert(attr_name, attr.value.to_string());
                }

                let open_idx = opcodes.len();
                opcodes.push(SsrOpcode::OpenElement {
                    tag: recovered_tag_name.clone(),
                    is_custom_element,
                    is_void,
                    is_self_closing: false,
                    namespace,
                    static_attrs,
                    dynamic_attrs: Vec::new(),
                    close_index: None,
                });

                if !is_void {
                    if let Some(ref template_doc) = *template_contents.borrow() {
                        walk_static_dom_nodes(
                            &template_doc.children.borrow(),
                            in_raw_text || is_raw,
                            opcodes,
                        );
                    }
                    walk_static_dom_nodes(
                        &handle.children.borrow(),
                        in_raw_text || is_raw,
                        opcodes,
                    );
                    let close_idx = opcodes.len();
                    if let SsrOpcode::OpenElement { close_index, .. } = &mut opcodes[open_idx] {
                        *close_index = Some(close_idx);
                    }
                    opcodes.push(SsrOpcode::CloseElement {
                        tag: recovered_tag_name,
                    });
                }
            }
        }
    }
}

struct DescriptorWalkContext<'a> {
    node_index: isize,
    attr_parts: &'a HashMap<usize, Vec<(usize, RawDescriptorPart)>>,
    child_parts_by_index: &'a HashMap<usize, Vec<(usize, RawDescriptorPart)>>,
    child_parts_in_order: &'a [(usize, RawDescriptorPart)],
    consumed_attr_elems: HashSet<usize>,
    consumed_child_parts: HashSet<usize>,
    child_part_counter: usize,
    in_raw_text: bool,
}

impl<'a> DescriptorWalkContext<'a> {
    fn resolve_next_child_part(&mut self, current_idx: usize) -> Result<usize, ()> {
        let mut val_idx = None;
        if let Some(candidates) = self.child_parts_by_index.get(&current_idx) {
            for (v_idx, _) in candidates {
                if !self.consumed_child_parts.contains(v_idx) {
                    val_idx = Some(*v_idx);
                    break;
                }
            }
        }
        if val_idx.is_none() {
            while self.child_part_counter < self.child_parts_in_order.len()
                && self
                    .consumed_child_parts
                    .contains(&self.child_parts_in_order[self.child_part_counter].0)
            {
                self.child_part_counter += 1;
            }
            if self.child_part_counter < self.child_parts_in_order.len() {
                let candidate = &self.child_parts_in_order[self.child_part_counter];
                // Only fall back to positional matching when the descriptor part omitted an explicit node index.
                if candidate.1.index.is_none() {
                    val_idx = Some(candidate.0);
                    self.child_part_counter += 1;
                }
            }
        }
        match val_idx {
            Some(idx) => {
                self.consumed_child_parts.insert(idx);
                Ok(idx)
            }
            None => Err(()),
        }
    }
}

fn walk_descriptor_nodes(
    nodes: &[Handle],
    ctx: &mut DescriptorWalkContext,
    opcodes: &mut Vec<SsrOpcode>,
) -> Result<(), ()> {
    for handle in nodes {
        match handle.data {
            NodeData::Document | NodeData::Doctype { .. } => {}
            NodeData::Text { ref contents } => {
                let text = contents.borrow().to_string();
                if !text.is_empty() {
                    let val = if ctx.in_raw_text {
                        text
                    } else {
                        escape_html_text(&text)
                    };
                    opcodes.push(SsrOpcode::Text { value: val });
                }
            }
            NodeData::Comment { ref contents } => {
                ctx.node_index += 1;
                let comment_str: &str = contents.as_ref();
                if comment_str == "?" || comment_str.starts_with('?') {
                    let current_idx = ctx.node_index as usize;
                    let idx = ctx.resolve_next_child_part(current_idx)?;
                    opcodes.push(SsrOpcode::DynamicPart { index: idx });
                } else {
                    opcodes.push(SsrOpcode::Comment {
                        value: comment_str.to_string(),
                    });
                }
            }
            NodeData::ProcessingInstruction { .. } => {
                ctx.node_index += 1;
                let current_idx = ctx.node_index as usize;
                let idx = ctx.resolve_next_child_part(current_idx)?;
                opcodes.push(SsrOpcode::DynamicPart { index: idx });
            }
            NodeData::Element {
                ref name,
                ref attrs,
                ref template_contents,
                ..
            } => {
                ctx.node_index += 1;
                let elem_idx = ctx.node_index as usize;
                let tag_name: &str = name.local.as_ref();
                let is_void = is_void_element(tag_name);
                let is_custom_element = tag_name.contains('-');
                let is_raw_text = tag_name.eq_ignore_ascii_case("script")
                    || tag_name.eq_ignore_ascii_case("style");

                let namespace = if name.ns == ns!(svg) {
                    ElementNamespace::Svg
                } else if name.ns == ns!(mathml) {
                    ElementNamespace::MathML
                } else {
                    ElementNamespace::Html
                };

                let recovered_tag_name = if namespace == ElementNamespace::Svg {
                    TemplateParser::recover_svg_element_tag_casing(tag_name)
                } else {
                    tag_name.to_string()
                };

                let mut static_attrs = OrderedAttrs::new();
                for attr in attrs.borrow().iter() {
                    let raw_attr_name = if let Some(ref prefix) = attr.name.prefix {
                        format!("{}:{}", prefix, attr.name.local)
                    } else {
                        attr.name.local.to_string()
                    };
                    let attr_name =
                        TemplateParser::recover_attribute_casing(&raw_attr_name, namespace);
                    static_attrs.insert(attr_name, attr.value.to_string());
                }

                let mut dynamic_attrs = Vec::new();
                if let Some(parts_for_elem) = ctx.attr_parts.get(&elem_idx) {
                    ctx.consumed_attr_elems.insert(elem_idx);
                    for (val_idx, part) in parts_for_elem {
                        if part.part_type == 6 {
                            dynamic_attrs.push(SsrDynamicAttribute::Directive { index: *val_idx });
                            continue;
                        }
                        let name = part.name.clone().unwrap_or_default();
                        let ctor_type = part.ctor_type.unwrap_or_else(|| {
                            if name.starts_with('?') {
                                4
                            } else if name.starts_with('@') {
                                5
                            } else if name.starts_with('.') {
                                3
                            } else {
                                1
                            }
                        });

                        let clean_name = if name.starts_with('?')
                            || name.starts_with('@')
                            || name.starts_with('.')
                        {
                            name[1..].to_string()
                        } else {
                            name.clone()
                        };

                        let dyn_attr = match ctor_type {
                            4 => SsrDynamicAttribute::Boolean {
                                name: clean_name,
                                index: *val_idx,
                            },
                            5 => SsrDynamicAttribute::Event {
                                name: clean_name,
                                index: *val_idx,
                            },
                            3 => SsrDynamicAttribute::Property {
                                name: clean_name,
                                index: *val_idx,
                                indices: None,
                                strings: part.strings.clone(),
                            },
                            _ => {
                                if let Some(ref strings) = part.strings {
                                    SsrDynamicAttribute::Attribute {
                                        name: clean_name,
                                        index: *val_idx,
                                        indices: None,
                                        strings: Some(strings.clone()),
                                    }
                                } else {
                                    SsrDynamicAttribute::Attribute {
                                        name: clean_name,
                                        index: *val_idx,
                                        indices: None,
                                        strings: None,
                                    }
                                }
                            }
                        };
                        dynamic_attrs.push(dyn_attr);
                    }
                }

                let open_idx = opcodes.len();
                opcodes.push(SsrOpcode::OpenElement {
                    tag: recovered_tag_name.clone(),
                    is_custom_element,
                    is_void,
                    is_self_closing: false,
                    namespace,
                    static_attrs,
                    dynamic_attrs,
                    close_index: None,
                });

                if !is_void {
                    let prev_raw = ctx.in_raw_text;
                    ctx.in_raw_text = prev_raw || is_raw_text;
                    if let Some(ref template_doc) = *template_contents.borrow() {
                        let children = template_doc.children.borrow();
                        walk_descriptor_nodes(&children, ctx, opcodes)?;
                    }
                    let children = handle.children.borrow();
                    walk_descriptor_nodes(&children, ctx, opcodes)?;
                    ctx.in_raw_text = prev_raw;

                    let close_idx = opcodes.len();
                    if let SsrOpcode::OpenElement { close_index, .. } = &mut opcodes[open_idx] {
                        *close_index = Some(close_idx);
                    }
                    opcodes.push(SsrOpcode::CloseElement {
                        tag: recovered_tag_name,
                    });
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compile_lit_descriptor_with_less_than_in_attribute() {
        let h = "<div title=\"a < b\"><?></div>";
        let parts_json = r#"[{"type": 2, "index": 1}]"#;
        let plan = SsrTemplatePlan::build_from_descriptor(h, parts_json).expect("plan must build");

        assert_eq!(plan.opcodes.len(), 3);
        match &plan.opcodes[0] {
            SsrOpcode::OpenElement {
                tag,
                static_attrs,
                close_index,
                ..
            } => {
                assert_eq!(tag, "div");
                assert_eq!(static_attrs.get("title").map(|s| s.as_str()), Some("a < b"));
                assert_eq!(*close_index, Some(2));
            }
            _ => panic!("Expected OpenElement"),
        }
        match &plan.opcodes[1] {
            SsrOpcode::DynamicPart { index } => {
                assert_eq!(*index, 0);
            }
            _ => panic!("Expected DynamicPart"),
        }
        match &plan.opcodes[2] {
            SsrOpcode::CloseElement { tag } => {
                assert_eq!(tag, "div");
            }
            _ => panic!("Expected CloseElement"),
        }
    }

    #[test]
    fn test_compile_lit_descriptor_with_comments_and_void() {
        let h = "<!-- intro --><input type=\"text\" value=\"hi\"/><?>";
        let parts_json = r#"[{"type": 2, "index": 2}]"#;
        let plan = SsrTemplatePlan::build_from_descriptor(h, parts_json).expect("plan must build");

        assert_eq!(plan.opcodes.len(), 3);
        match &plan.opcodes[0] {
            SsrOpcode::Comment { value } => assert_eq!(value, " intro "),
            _ => panic!("Expected Comment"),
        }
        match &plan.opcodes[1] {
            SsrOpcode::OpenElement { tag, is_void, .. } => {
                assert_eq!(tag, "input");
                assert!(is_void);
            }
            _ => panic!("Expected OpenElement"),
        }
        match &plan.opcodes[2] {
            SsrOpcode::DynamicPart { index } => assert_eq!(*index, 0),
            _ => panic!("Expected DynamicPart"),
        }
    }

    #[test]
    fn test_descriptor_bails_on_unmatched_markers_or_parts() {
        // Marker with no matching part must bail instead of guessing saturating_sub(1)
        assert!(SsrTemplatePlan::build_from_descriptor("<div><?></div>", "[]").is_none());
        // Part index out of bounds must bail
        assert!(
            SsrTemplatePlan::build_from_descriptor(
                "<div>hello</div>",
                r#"[{"type":1,"index":9,"name":"id"}]"#
            )
            .is_none()
        );
        // Invalid JSON must bail
        assert!(SsrTemplatePlan::build_from_descriptor("<div></div>", "{not-json").is_none());
    }
}
