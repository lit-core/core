use html5ever::driver::ParseOpts;
use html5ever::tendril::TendrilSink;
use html5ever::{local_name, namespace_url, ns, parse_fragment, QualName};
use markup5ever_rcdom::{Handle, NodeData, RcDom};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ElementNamespace {
    Html,
    Svg,
    MathML,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AttributePrefix {
    Plain,
    Property, // '.'
    Event,    // '@'
    Boolean,  // '?'
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AttributePart {
    Static(String),
    Expression(usize),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AttributeValue {
    Static(String),
    Dynamic(usize),
    Mixed(Vec<AttributePart>),
    Directive(usize), // whole-attribute directive such as ${ref(r)}
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TemplateAttribute {
    pub name: String,
    pub prefix: AttributePrefix,
    pub value: AttributeValue,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TemplateElement {
    pub tag_name: String,
    pub namespace: ElementNamespace,
    pub attributes: Vec<TemplateAttribute>,
    pub children: Vec<TemplateNode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TemplateSlot {
    pub name: Option<String>,
    pub fallback: Vec<TemplateNode>,
    pub attributes: Vec<TemplateAttribute>,
    pub inspected: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TemplateNode {
    Element(TemplateElement),
    Text(String),
    Expression(usize),
    Comment(String),
    Slot(TemplateSlot),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TemplateIR {
    pub roots: Vec<TemplateNode>,
    pub expression_count: usize,
    pub has_slots: bool,
    pub has_custom_elements: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LexerState {
    Text,
    InsideTag,
    InsideAttributeName,
    AfterEquals,
    InsideQuotedAttr(char),
    InsideUnquotedAttr,
    InsideComment,
}

pub const VOID_ELEMENTS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];

pub fn is_void_element(tag: &str) -> bool {
    VOID_ELEMENTS.iter().any(|&v| v.eq_ignore_ascii_case(tag))
}

pub struct TemplateParser;

impl TemplateParser {
    pub const SVG_CANONICAL_TAGS: &'static [&'static str] = &[
        "altGlyph",
        "altGlyphDef",
        "altGlyphItem",
        "animateColor",
        "animateMotion",
        "animateTransform",
        "clipPath",
        "feBlend",
        "feColorMatrix",
        "feComponentTransfer",
        "feComposite",
        "feConvolveMatrix",
        "feDiffuseLighting",
        "feDisplacementMap",
        "feDistantLight",
        "feDropShadow",
        "feFlood",
        "feFuncA",
        "feFuncB",
        "feFuncG",
        "feFuncR",
        "feGaussianBlur",
        "feImage",
        "feMerge",
        "feMergeNode",
        "feMorphology",
        "feOffset",
        "fePointLight",
        "feSpecularLighting",
        "feSpotLight",
        "feTile",
        "feTurbulence",
        "foreignObject",
        "glyphRef",
        "linearGradient",
        "radialGradient",
        "textPath",
    ];

    pub const SVG_CANONICAL_ATTRS: &'static [&'static str] = &[
        "viewBox",
        "strokeWidth",
        "strokeLinecap",
        "strokeLinejoin",
        "strokeMiterlimit",
        "strokeDasharray",
        "strokeDashoffset",
        "preserveAspectRatio",
        "clipPath",
        "clipRule",
        "fillRule",
        "fillOpacity",
        "strokeOpacity",
        "gradientTransform",
        "gradientUnits",
        "patternUnits",
        "patternContentUnits",
        "spreadMethod",
        "textAnchor",
        "dominantBaseline",
        "alignmentBaseline",
        "colorInterpolation",
        "pointerEvents",
    ];

    pub fn parse_lit_template(
        quasis: &[&str],
        expression_count: usize,
    ) -> Result<TemplateIR, String> {
        let synthetic_html = Self::inject_hole_markers(quasis, expression_count);
        let context_name = QualName::new(None, ns!(html), local_name!("template"));
        let dom = parse_fragment(RcDom::default(), ParseOpts::default(), context_name, vec![])
            .one(synthetic_html.as_str());

        let mut roots = Vec::new();
        let doc_children = dom.document.children.borrow();
        if let Some(html_root) = doc_children.first() {
            for child in html_root.children.borrow().iter() {
                if let Some(node) = Self::convert_rcdom_node(child, quasis) {
                    roots.push(node);
                }
            }
        }

        let mut has_slots = false;
        let mut has_custom_elements = false;
        Self::analyze_tree_flags(&roots, &mut has_slots, &mut has_custom_elements);

        Ok(TemplateIR {
            roots,
            expression_count,
            has_slots,
            has_custom_elements,
        })
    }

    fn inject_hole_markers(quasis: &[&str], expression_count: usize) -> String {
        let mut out = String::new();
        let mut state = LexerState::Text;

        for (i, quasi) in quasis.iter().enumerate() {
            let chars: Vec<char> = quasi.chars().collect();
            let len = chars.len();
            let mut j = 0;

            while j < len {
                let c = chars[j];
                match state {
                    LexerState::Text => {
                        if c == '<' {
                            if j + 3 < len
                                && chars[j + 1] == '!'
                                && chars[j + 2] == '-'
                                && chars[j + 3] == '-'
                            {
                                state = LexerState::InsideComment;
                                out.push_str("<!--");
                                j += 4;
                                continue;
                            } else if j + 1 < len
                                && (chars[j + 1].is_alphabetic()
                                    || chars[j + 1] == '/'
                                    || chars[j + 1] == '!'
                                    || chars[j + 1] == '?'
                                    || chars[j + 1] == '_'
                                    || chars[j + 1] == ':')
                            {
                                state = LexerState::InsideTag;
                            }
                        }
                    }
                    LexerState::InsideComment => {
                        if c == '-' && j + 2 < len && chars[j + 1] == '-' && chars[j + 2] == '>' {
                            state = LexerState::Text;
                            out.push_str("-->");
                            j += 3;
                            continue;
                        }
                    }
                    LexerState::InsideTag => {
                        if c == '>' {
                            state = LexerState::Text;
                        } else if c == '=' {
                            state = LexerState::AfterEquals;
                        } else if c.is_alphanumeric()
                            || c == '-'
                            || c == '_'
                            || c == '.'
                            || c == '@'
                            || c == '?'
                            || c == ':'
                        {
                            state = LexerState::InsideAttributeName;
                        }
                    }
                    LexerState::InsideAttributeName => {
                        if c == '=' {
                            state = LexerState::AfterEquals;
                        } else if c.is_whitespace() {
                            state = LexerState::InsideTag;
                        } else if c == '>' {
                            state = LexerState::Text;
                        }
                    }
                    LexerState::AfterEquals => {
                        if c == '"' {
                            state = LexerState::InsideQuotedAttr('"');
                        } else if c == '\'' {
                            state = LexerState::InsideQuotedAttr('\'');
                        } else if !c.is_whitespace() {
                            state = LexerState::InsideUnquotedAttr;
                        }
                    }
                    LexerState::InsideQuotedAttr(q) => {
                        if c == q {
                            state = LexerState::InsideTag;
                        }
                    }
                    LexerState::InsideUnquotedAttr => {
                        if c.is_whitespace() {
                            state = LexerState::InsideTag;
                        } else if c == '>' {
                            state = LexerState::Text;
                        }
                    }
                }
                out.push(c);
                j += 1;
            }

            if i < expression_count {
                match state {
                    LexerState::InsideQuotedAttr(_) | LexerState::InsideUnquotedAttr => {
                        out.push_str("__lit_hole_");
                        out.push_str(&i.to_string());
                        out.push_str("__");
                    }
                    LexerState::AfterEquals => {
                        out.push_str("\"__lit_hole_");
                        out.push_str(&i.to_string());
                        out.push_str("__\"");
                        state = LexerState::InsideTag;
                    }
                    LexerState::InsideTag | LexerState::InsideAttributeName => {
                        out.push_str(" lit-attr-directive-");
                        out.push_str(&i.to_string());
                        out.push_str("=\"\" ");
                        state = LexerState::InsideTag;
                    }
                    LexerState::Text => {
                        out.push_str("<!--lit-part-");
                        out.push_str(&i.to_string());
                        out.push_str("-->");
                    }
                    LexerState::InsideComment => {
                        out.push_str("__lit_hole_");
                        out.push_str(&i.to_string());
                        out.push_str("__");
                    }
                }
            }
        }

        out
    }

    fn convert_rcdom_node(handle: &Handle, quasis: &[&str]) -> Option<TemplateNode> {
        match handle.data {
            NodeData::Document
            | NodeData::Doctype { .. }
            | NodeData::ProcessingInstruction { .. } => None,
            NodeData::Comment { ref contents } => {
                let text: &str = contents.as_ref();
                if let Some(idx_str) = text.strip_prefix("lit-part-") {
                    if let Ok(idx) = idx_str.parse::<usize>() {
                        return Some(TemplateNode::Expression(idx));
                    }
                }
                Some(TemplateNode::Comment(text.to_string()))
            }
            NodeData::Text { ref contents } => {
                Some(TemplateNode::Text(contents.borrow().to_string()))
            }
            NodeData::Element {
                ref name,
                ref attrs,
                ref template_contents,
                ..
            } => {
                let ns = if name.ns == ns!(svg) {
                    ElementNamespace::Svg
                } else if name.ns == ns!(mathml) {
                    ElementNamespace::MathML
                } else {
                    ElementNamespace::Html
                };
                let tag_name: &str = name.local.as_ref();
                let recovered_tag_name = if ns == ElementNamespace::Svg {
                    Self::recover_svg_element_tag_casing(tag_name)
                } else {
                    tag_name.to_string()
                };

                let raw_attrs: Vec<(String, String)> = attrs
                    .borrow()
                    .iter()
                    .map(|attr| {
                        let attr_name = if let Some(ref prefix) = attr.name.prefix {
                            let mut s =
                                String::with_capacity(prefix.len() + 1 + attr.name.local.len());
                            s.extend(prefix.chars());
                            s.push(':');
                            s.extend(attr.name.local.chars());
                            s
                        } else {
                            attr.name.local.to_string()
                        };
                        (attr_name, attr.value.to_string())
                    })
                    .collect();
                let converted_attributes = Self::convert_attributes(&raw_attrs, quasis, ns);

                let mut children = Vec::new();
                if let Some(ref template_doc) = *template_contents.borrow() {
                    for child in template_doc.children.borrow().iter() {
                        if let Some(child_node) = Self::convert_rcdom_node(child, quasis) {
                            children.push(child_node);
                        }
                    }
                }
                for child in handle.children.borrow().iter() {
                    if let Some(child_node) = Self::convert_rcdom_node(child, quasis) {
                        children.push(child_node);
                    }
                }

                if recovered_tag_name == "slot" {
                    let slot_name = converted_attributes
                        .iter()
                        .find(|a| a.name == "name")
                        .and_then(|a| match &a.value {
                            AttributeValue::Static(s) => Some(s.clone()),
                            _ => None,
                        });

                    let inspected = converted_attributes.iter().any(|a| {
                        a.prefix == AttributePrefix::Event
                            && (a.name == "slotchange" || a.name == "slotChange")
                    });

                    Some(TemplateNode::Slot(TemplateSlot {
                        name: slot_name,
                        fallback: children,
                        attributes: converted_attributes,
                        inspected,
                    }))
                } else {
                    Some(TemplateNode::Element(TemplateElement {
                        tag_name: recovered_tag_name,
                        namespace: ns,
                        attributes: converted_attributes,
                        children,
                    }))
                }
            }
        }
    }

    fn convert_attributes(
        raw_attrs: &[(String, String)],
        quasis: &[&str],
        ns: ElementNamespace,
    ) -> Vec<TemplateAttribute> {
        let mut attributes = Vec::new();

        for (attr_name_raw, attr_val_raw) in raw_attrs {
            if let Some(idx_str) = attr_name_raw.strip_prefix("lit-attr-directive-") {
                if let Ok(idx) = idx_str.parse::<usize>() {
                    attributes.push(TemplateAttribute {
                        name: String::new(),
                        prefix: AttributePrefix::Plain,
                        value: AttributeValue::Directive(idx),
                    });
                    continue;
                }
            }

            let (parts, first_hole_idx) = Self::parse_attribute_value_parts(attr_val_raw);

            if let Some(hole_idx) = first_hole_idx {
                let (prefix, recovered_name) =
                    Self::recover_dynamic_attribute(quasis, hole_idx, attr_name_raw);

                let val = if parts.len() == 1 {
                    if let AttributePart::Expression(idx) = parts[0] {
                        AttributeValue::Dynamic(idx)
                    } else {
                        AttributeValue::Static(attr_val_raw.clone())
                    }
                } else {
                    AttributeValue::Mixed(parts)
                };

                attributes.push(TemplateAttribute {
                    name: recovered_name,
                    prefix,
                    value: val,
                });
            } else {
                let (prefix, raw_name) = if let Some(stripped) = attr_name_raw.strip_prefix('.') {
                    (AttributePrefix::Property, stripped)
                } else if let Some(stripped) = attr_name_raw.strip_prefix('@') {
                    (AttributePrefix::Event, stripped)
                } else if let Some(stripped) = attr_name_raw.strip_prefix('?') {
                    (AttributePrefix::Boolean, stripped)
                } else {
                    (AttributePrefix::Plain, attr_name_raw.as_str())
                };
                let recovered_name = Self::recover_attribute_casing(raw_name, ns);
                attributes.push(TemplateAttribute {
                    name: recovered_name,
                    prefix,
                    value: AttributeValue::Static(attr_val_raw.clone()),
                });
            }
        }

        attributes
    }

    fn parse_attribute_value_parts(raw: &str) -> (Vec<AttributePart>, Option<usize>) {
        let bytes = raw.as_bytes();
        let len = bytes.len();
        let mut parts = Vec::new();
        let mut first_hole_idx = None;
        let mut i = 0;
        let mut last_start = 0;

        const PREFIX: &[u8] = b"__lit_hole_";

        while i < len {
            if bytes[i..].starts_with(PREFIX) {
                if i > last_start {
                    parts.push(AttributePart::Static(raw[last_start..i].to_string()));
                }
                let idx_start = i + PREFIX.len();
                let mut j = idx_start;
                while j < len && bytes[j].is_ascii_digit() {
                    j += 1;
                }
                if j < len && bytes[j..].starts_with(b"__") {
                    let num_str = &raw[idx_start..j];
                    if let Ok(idx) = num_str.parse::<usize>() {
                        parts.push(AttributePart::Expression(idx));
                        if first_hole_idx.is_none() {
                            first_hole_idx = Some(idx);
                        }
                    }
                    i = j + 2;
                    last_start = i;
                    continue;
                }
            }
            i += 1;
        }

        if last_start < len {
            parts.push(AttributePart::Static(raw[last_start..len].to_string()));
        }

        (parts, first_hole_idx)
    }

    pub fn recover_dynamic_attribute(
        quasis: &[&str],
        hole_index: usize,
        fallback_name: &str,
    ) -> (AttributePrefix, String) {
        if hole_index >= quasis.len() {
            return (AttributePrefix::Plain, fallback_name.to_string());
        }

        let quasi = quasis[hole_index];
        let trimmed = quasi.trim_end();
        let without_quote = if let Some(stripped) = trimmed
            .strip_suffix('"')
            .or_else(|| trimmed.strip_suffix('\''))
        {
            stripped.trim_end()
        } else {
            trimmed
        };

        let chars: Vec<char> = without_quote.chars().collect();
        let mut idx = chars.len();

        let mut eq_pos = None;
        while idx > 0 {
            idx -= 1;
            if chars[idx] == '=' {
                eq_pos = Some(idx);
                break;
            }
        }

        let before_attr_eq_chars = if let Some(pos) = eq_pos {
            &chars[..pos]
        } else {
            &chars[..]
        };

        let mut token_chars = Vec::new();
        let mut j = before_attr_eq_chars.len();

        while j > 0 && before_attr_eq_chars[j - 1].is_whitespace() {
            j -= 1;
        }

        while j > 0 {
            let c = before_attr_eq_chars[j - 1];
            if c.is_alphanumeric()
                || c == '-'
                || c == '_'
                || c == '.'
                || c == '@'
                || c == '?'
                || c == ':'
            {
                token_chars.push(c);
                j -= 1;
            } else {
                break;
            }
        }

        token_chars.reverse();
        let token: String = token_chars.into_iter().collect();

        if let Some(stripped) = token.strip_prefix('.') {
            (AttributePrefix::Property, stripped.to_string())
        } else if let Some(stripped) = token.strip_prefix('@') {
            (AttributePrefix::Event, stripped.to_string())
        } else if let Some(stripped) = token.strip_prefix('?') {
            (AttributePrefix::Boolean, stripped.to_string())
        } else if !token.is_empty() {
            (AttributePrefix::Plain, token)
        } else {
            (AttributePrefix::Plain, fallback_name.to_string())
        }
    }

    pub fn recover_svg_element_tag_casing(name: &str) -> String {
        for &canonical in Self::SVG_CANONICAL_TAGS {
            if canonical.eq_ignore_ascii_case(name) {
                return canonical.to_string();
            }
        }
        name.to_string()
    }

    pub fn recover_attribute_casing(name: &str, ns: ElementNamespace) -> String {
        if ns == ElementNamespace::Svg {
            for &canonical in Self::SVG_CANONICAL_ATTRS {
                if canonical.eq_ignore_ascii_case(name) {
                    return canonical.to_string();
                }
            }
        }
        name.to_string()
    }

    fn analyze_tree_flags(
        nodes: &[TemplateNode],
        has_slots: &mut bool,
        has_custom_elements: &mut bool,
    ) {
        for node in nodes {
            match node {
                TemplateNode::Slot(_) => *has_slots = true,
                TemplateNode::Element(el) => {
                    if el.tag_name.contains('-') {
                        *has_custom_elements = true;
                    }
                    Self::analyze_tree_flags(&el.children, has_slots, has_custom_elements);
                }
                _ => {}
            }
        }
    }
}
