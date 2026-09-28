#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BindingKind {
    Attribute,
    BooleanAttribute,
    Property,
    Event,
    Text,
}

#[derive(Debug, Clone)]
pub struct BindingSite {
    pub kind: BindingKind,
    pub name: Option<String>,
    pub path: Vec<usize>,
    pub expression_index: usize,
    pub expr_str: String,
}

#[derive(Debug, Clone)]
pub struct ParsedTemplate {
    pub html: String,
    pub bindings: Vec<BindingSite>,
}

#[derive(Debug, Clone)]
enum DomNode {
    Element {
        tag: String,
        static_attrs: String,
        children: Vec<DomNode>,
        bindings: Vec<(BindingKind, String, usize, String)>, // (kind, name, expr_idx, expr_str)
    },
    Text(String),
    Marker {
        expr_idx: usize,
        expr_str: String,
    },
    Comment(String),
}

/// Parses an HTML tagged template literal given its static string slices (quasis)
/// and expressions (as code strings).
pub fn parse_html_template(quasis: &[&str], expressions: &[&str]) -> ParsedTemplate {
    if quasis.is_empty() {
        return ParsedTemplate {
            html: String::new(),
            bindings: Vec::new(),
        };
    }

    // Pass 1: Analyze each expression boundary to determine if it is an attribute/event binding
    // or a child text binding.
    // Build an annotated intermediate representation.
    let mut combined = String::new();
    let num_exprs = expressions.len();

    // Store pending attribute bindings to attach to elements during tokenization
    // expr_idx -> (is_attr, kind, name)
    let mut expr_meta: Vec<(bool, BindingKind, String)> = Vec::with_capacity(num_exprs);

    for (i, quasi) in quasis.iter().enumerate() {
        combined.push_str(quasi);

        if i < num_exprs {
            let expr_str = expressions[i];
            // Check preceding text in `combined` to determine if we are inside a tag attribute
            let trimmed = combined.trim_end();
            let is_in_tag = is_inside_tag(&combined);

            if is_in_tag {
                // Find attribute name preceding `=`
                let (kind, attr_name) = extract_attribute_binding(trimmed);
                expr_meta.push((true, kind, attr_name.clone()));
                // Insert a placeholder attribute so HTML remains valid
                combined.push_str(&format!("\"__LIT_EXP_{}__\"", i));
            } else {
                // Child text position: insert marker comment
                expr_meta.push((false, BindingKind::Text, String::new()));
                combined.push_str(&format!("<!--__LIT_EXP_{}__-->", i));
            }
            let _ = expr_str;
        }
    }

    // Pass 2: Parse the combined string into a DOM tree
    let root_nodes = parse_html_to_tree(&combined, expressions, &expr_meta);

    // Pass 3: Walk DOM tree, compute node paths, and generate clean HTML
    let mut bindings = Vec::new();
    let mut clean_html = String::new();

    for (child_idx, node) in root_nodes.iter().enumerate() {
        let current_path = vec![child_idx];
        collect_bindings_and_html(node, &current_path, &mut bindings, &mut clean_html);
    }

    // Sort bindings by expression_index
    bindings.sort_by_key(|b| b.expression_index);

    ParsedTemplate {
        html: clean_html,
        bindings,
    }
}

fn is_inside_tag(s: &str) -> bool {
    let last_open = s.rfind('<');
    let last_close = s.rfind('>');
    match (last_open, last_close) {
        (Some(o), Some(c)) => o > c,
        (Some(_), None) => true,
        _ => false,
    }
}

fn extract_attribute_binding(trimmed: &str) -> (BindingKind, String) {
    let without_eq = trimmed
        .strip_suffix('=')
        .or_else(|| trimmed.strip_suffix("=\""))
        .or_else(|| trimmed.strip_suffix("='"))
        .unwrap_or(trimmed);

    let token = without_eq
        .split(|c: char| c.is_whitespace() || c == '<' || c == '>')
        .filter(|s| !s.is_empty())
        .next_back()
        .unwrap_or("");

    if let Some(ev) = token.strip_prefix('@') {
        (BindingKind::Event, ev.to_string())
    } else if let Some(b) = token.strip_prefix('?') {
        (BindingKind::BooleanAttribute, b.to_string())
    } else if let Some(p) = token.strip_prefix('.') {
        (BindingKind::Property, p.to_string())
    } else {
        (BindingKind::Attribute, token.to_string())
    }
}

fn parse_html_to_tree(
    html: &str,
    expressions: &[&str],
    expr_meta: &[(bool, BindingKind, String)],
) -> Vec<DomNode> {
    let mut chars = html.char_indices().peekable();
    let mut stack: Vec<(
        String,
        String,
        Vec<DomNode>,
        Vec<(BindingKind, String, usize, String)>,
    )> = Vec::new();
    let mut top_nodes: Vec<DomNode> = Vec::new();

    let void_elements: [&str; 14] = [
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param",
        "source", "track", "wbr",
    ];

    let mut text_buf = String::new();

    let flush_text = |buf: &mut String,
                      stack: &mut Vec<(
        String,
        String,
        Vec<DomNode>,
        Vec<(BindingKind, String, usize, String)>,
    )>,
                      top: &mut Vec<DomNode>| {
        if !buf.is_empty() {
            let node = DomNode::Text(std::mem::take(buf));
            if let Some((_, _, children, _)) = stack.last_mut() {
                children.push(node);
            } else {
                top.push(node);
            }
        }
    };

    while let Some(&(idx, ch)) = chars.peek() {
        if ch == '<' {
            let rest = &html[idx..];

            // Check for comment <!--...-->
            if rest.starts_with("<!--") {
                flush_text(&mut text_buf, &mut stack, &mut top_nodes);

                if let Some(end_comment) = rest.find("-->") {
                    let comment_content = &rest[4..end_comment];
                    if comment_content.starts_with("__LIT_EXP_") && comment_content.ends_with("__")
                    {
                        let num_str = &comment_content[10..comment_content.len() - 2];
                        if let Ok(exp_idx) = num_str.parse::<usize>() {
                            let expr_str =
                                expressions.get(exp_idx).copied().unwrap_or("").to_string();
                            let marker = DomNode::Marker {
                                expr_idx: exp_idx,
                                expr_str,
                            };
                            if let Some((_, _, children, _)) = stack.last_mut() {
                                children.push(marker);
                            } else {
                                top_nodes.push(marker);
                            }
                        }
                    } else {
                        let comment = DomNode::Comment(comment_content.to_string());
                        if let Some((_, _, children, _)) = stack.last_mut() {
                            children.push(comment);
                        } else {
                            top_nodes.push(comment);
                        }
                    }

                    // Advance past comment
                    let advance_by = end_comment + 3;
                    for _ in 0..advance_by {
                        chars.next();
                    }
                    continue;
                }
            }

            // Check for closing tag </tag>
            if rest.starts_with("</") {
                flush_text(&mut text_buf, &mut stack, &mut top_nodes);
                if let Some(close_idx) = rest.find('>') {
                    let tag_name = rest[2..close_idx].trim().to_ascii_lowercase();
                    // Pop from stack until matching tag
                    if let Some(pos) = stack.iter().rposition(|(t, _, _, _)| *t == tag_name) {
                        while stack.len() > pos + 1 {
                            let (t, attrs, children, bindings) = stack.pop().unwrap();
                            let elem = DomNode::Element {
                                tag: t,
                                static_attrs: attrs,
                                children,
                                bindings,
                            };
                            if let Some((_, _, parent_children, _)) = stack.last_mut() {
                                parent_children.push(elem);
                            } else {
                                top_nodes.push(elem);
                            }
                        }
                        let (t, attrs, children, bindings) = stack.pop().unwrap();
                        let elem = DomNode::Element {
                            tag: t,
                            static_attrs: attrs,
                            children,
                            bindings,
                        };
                        if let Some((_, _, parent_children, _)) = stack.last_mut() {
                            parent_children.push(elem);
                        } else {
                            top_nodes.push(elem);
                        }
                    }

                    let advance_by = close_idx + 1;
                    for _ in 0..advance_by {
                        chars.next();
                    }
                    continue;
                }
            }

            // Opening tag <tag ...>
            let tag_content_end = find_tag_end(rest);
            if let Some(end_idx) = tag_content_end {
                flush_text(&mut text_buf, &mut stack, &mut top_nodes);
                let tag_raw = &rest[1..end_idx];
                let is_self_closing = tag_raw.ends_with('/');
                let tag_body = if is_self_closing {
                    &tag_raw[..tag_raw.len() - 1]
                } else {
                    tag_raw
                };

                let trimmed_body = tag_body.trim();
                let tag_name = trimmed_body
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase();

                let static_attrs = clean_static_attributes(trimmed_body, tag_name.len());

                // Scan for __LIT_EXP_X__ in tag_body
                let mut elem_bindings = Vec::new();
                for (expr_idx, &(is_attr, ref kind, ref name)) in expr_meta.iter().enumerate() {
                    if is_attr && tag_body.contains(&format!("__LIT_EXP_{}__", expr_idx)) {
                        let expr_str = expressions.get(expr_idx).copied().unwrap_or("").to_string();
                        elem_bindings.push((kind.clone(), name.clone(), expr_idx, expr_str));
                    }
                }

                let is_void = void_elements.contains(&tag_name.as_str()) || is_self_closing;

                if is_void {
                    let elem = DomNode::Element {
                        tag: tag_name,
                        static_attrs,
                        children: Vec::new(),
                        bindings: elem_bindings,
                    };
                    if let Some((_, _, children, _)) = stack.last_mut() {
                        children.push(elem);
                    } else {
                        top_nodes.push(elem);
                    }
                } else {
                    stack.push((tag_name, static_attrs, Vec::new(), elem_bindings));
                }

                let advance_by = end_idx + 1;
                for _ in 0..advance_by {
                    chars.next();
                }
                continue;
            }
        }

        text_buf.push(ch);
        chars.next();
    }

    flush_text(&mut text_buf, &mut stack, &mut top_nodes);

    // Unwind any unclosed tags
    while let Some((t, attrs, children, bindings)) = stack.pop() {
        let elem = DomNode::Element {
            tag: t,
            static_attrs: attrs,
            children,
            bindings,
        };
        if let Some((_, _, parent_children, _)) = stack.last_mut() {
            parent_children.push(elem);
        } else {
            top_nodes.push(elem);
        }
    }

    top_nodes
}

fn clean_static_attributes(tag_body: &str, tag_name_len: usize) -> String {
    if tag_name_len >= tag_body.len() {
        return String::new();
    }
    let raw_attrs = &tag_body[tag_name_len..];
    let mut result = String::new();
    let mut in_quote = None;
    let mut current_token = String::new();

    for ch in raw_attrs.chars() {
        match ch {
            '"' | '\'' => {
                current_token.push(ch);
                if in_quote == Some(ch) {
                    in_quote = None;
                } else if in_quote.is_none() {
                    in_quote = Some(ch);
                }
            }
            ' ' | '\t' | '\n' | '\r' if in_quote.is_none() => {
                if !current_token.is_empty() {
                    if !current_token.contains("__LIT_EXP_") {
                        if !result.is_empty() {
                            result.push(' ');
                        }
                        result.push_str(&current_token);
                    }
                    current_token.clear();
                }
            }
            _ => {
                current_token.push(ch);
            }
        }
    }
    if !current_token.is_empty() && !current_token.contains("__LIT_EXP_") {
        if !result.is_empty() {
            result.push(' ');
        }
        result.push_str(&current_token);
    }
    result.trim().to_string()
}

fn find_tag_end(s: &str) -> Option<usize> {
    let mut in_quote = None;
    for (i, ch) in s.char_indices() {
        if i == 0 {
            continue;
        }
        match ch {
            '"' | '\'' => {
                if in_quote == Some(ch) {
                    in_quote = None;
                } else if in_quote.is_none() {
                    in_quote = Some(ch);
                }
            }
            '>' if in_quote.is_none() => return Some(i),
            _ => {}
        }
    }
    None
}

fn collect_bindings_and_html(
    node: &DomNode,
    path: &[usize],
    bindings: &mut Vec<BindingSite>,
    html: &mut String,
) {
    match node {
        DomNode::Element {
            tag,
            static_attrs,
            children,
            bindings: elem_bindings,
        } => {
            // Record element bindings (attributes, properties, events)
            for (kind, name, expr_idx, expr_str) in elem_bindings {
                bindings.push(BindingSite {
                    kind: kind.clone(),
                    name: Some(name.clone()),
                    path: path.to_vec(),
                    expression_index: *expr_idx,
                    expr_str: expr_str.clone(),
                });
            }

            html.push('<');
            html.push_str(tag);
            if !static_attrs.is_empty() {
                html.push(' ');
                html.push_str(static_attrs);
            }
            html.push('>');

            for (child_idx, child) in children.iter().enumerate() {
                let mut child_path = path.to_vec();
                child_path.push(child_idx);
                collect_bindings_and_html(child, &child_path, bindings, html);
            }

            let void_elements: [&str; 14] = [
                "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
                "param", "source", "track", "wbr",
            ];
            if !void_elements.contains(&tag.as_str()) {
                html.push_str("</");
                html.push_str(tag);
                html.push('>');
            }
        }
        DomNode::Text(text) => {
            html.push_str(text);
        }
        DomNode::Marker { expr_idx, expr_str } => {
            bindings.push(BindingSite {
                kind: BindingKind::Text,
                name: None,
                path: path.to_vec(),
                expression_index: *expr_idx,
                expr_str: expr_str.clone(),
            });
            // Output a placeholder comment in template HTML
            html.push_str("<!---->");
        }
        DomNode::Comment(comment) => {
            html.push_str("<!--");
            html.push_str(comment);
            html.push_str("-->");
        }
    }
}
