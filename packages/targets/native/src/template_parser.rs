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
        bindings: Vec<(BindingKind, String, usize)>, // (kind, name, expr_idx)
    },
    Text(String),
    Marker {
        expr_idx: usize,
    },
    Comment(String),
}

/// Parses an HTML tagged template literal given its static string slices (quasis)
/// and expression count.
pub fn parse_html_template(quasis: &[&str], num_expressions: usize) -> Option<ParsedTemplate> {
    if quasis.is_empty() {
        return Some(ParsedTemplate {
            html: String::new(),
            bindings: Vec::new(),
        });
    }

    // Pass 1: Analyze each expression boundary to determine if it is an attribute/event binding
    // or a child text binding using a quote- and comment-aware state machine.
    let mut combined = String::new();
    let num_exprs = num_expressions;

    // Store pending attribute bindings to attach to elements during tokenization
    // expr_idx -> (is_attr, kind, name)
    let mut expr_meta: Vec<(bool, BindingKind, String)> = Vec::with_capacity(num_exprs);
    let mut current_state = HtmlParserState::Text;

    for (i, quasi) in quasis.iter().enumerate() {
        current_state = advance_html_state(current_state, quasi);
        combined.push_str(quasi);

        if i < num_exprs {
            let is_in_tag = is_inside_tag_state(current_state);

            if is_in_tag {
                let trimmed = combined.trim_end();

                // Guard against dynamic tag names:
                // e.g. `<${this.tag}>` or `</${this.tag}>`
                if trimmed.ends_with('<') || trimmed.ends_with("</") {
                    return None;
                }
                if let Some(last_lt) = trimmed.rfind('<') {
                    let after_lt = &trimmed[last_lt..];
                    if !after_lt.contains(char::is_whitespace) && !after_lt.contains('=') {
                        return None;
                    }
                }

                // Guard against dynamic attribute names: expression inside tag must be preceded by '='
                let (has_eq, without_eq) = if let Some(s) = trimmed.strip_suffix("=\"") {
                    (true, s)
                } else if let Some(s) = trimmed.strip_suffix("='") {
                    (true, s)
                } else if let Some(s) = trimmed.strip_suffix('=') {
                    (true, s)
                } else {
                    (false, trimmed)
                };

                if !has_eq {
                    return None;
                }

                // Find attribute name preceding `=`
                let (kind, attr_name) = extract_attribute_binding(without_eq);
                if attr_name.is_empty()
                    || attr_name.contains('<')
                    || attr_name.contains('>')
                    || attr_name.contains('/')
                    || attr_name.contains('"')
                    || attr_name.contains('\'')
                {
                    return None;
                }

                expr_meta.push((true, kind, attr_name.clone()));
                combined.push_str("\"__LIT_EXP__\"");
            } else {
                // Child text position: insert marker comment
                expr_meta.push((false, BindingKind::Text, String::new()));
                combined.push_str("<!--?-->");
            }
        }
    }

    // Pass 2: Parse the combined string into a DOM tree
    let root_nodes = parse_html_to_tree(&combined, &expr_meta);

    // Pass 3: Walk DOM tree, compute node paths, and generate clean HTML
    let mut bindings = Vec::new();
    let mut clean_html = String::new();

    for (child_idx, node) in root_nodes.iter().enumerate() {
        let current_path = vec![child_idx];
        collect_bindings_and_html(node, &current_path, &mut bindings, &mut clean_html);
    }

    // Guard against malformed or empty attribute/event/prop binding names
    for b in &bindings {
        if b.kind != BindingKind::Text {
            match &b.name {
                Some(n) if n.is_empty() => return None,
                None => return None,
                _ => {}
            }
        }
    }

    // Sort bindings by expression_index
    bindings.sort_by_key(|b| b.expression_index);

    Some(ParsedTemplate {
        html: clean_html,
        bindings,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HtmlParserState {
    Text,
    Tag,
    AttrDouble,
    AttrSingle,
    AttrUnquoted,
    Comment,
}

fn advance_html_state(mut state: HtmlParserState, s: &str) -> HtmlParserState {
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        match state {
            HtmlParserState::Comment => {
                if i + 2 < len && chars[i] == '-' && chars[i + 1] == '-' && chars[i + 2] == '>' {
                    i += 3;
                    state = HtmlParserState::Text;
                } else {
                    i += 1;
                }
            }
            HtmlParserState::AttrDouble => {
                if chars[i] == '"' {
                    state = HtmlParserState::Tag;
                }
                i += 1;
            }
            HtmlParserState::AttrSingle => {
                if chars[i] == '\'' {
                    state = HtmlParserState::Tag;
                }
                i += 1;
            }
            HtmlParserState::AttrUnquoted => {
                if chars[i].is_whitespace() || chars[i] == '>' {
                    state = if chars[i] == '>' {
                        HtmlParserState::Text
                    } else {
                        HtmlParserState::Tag
                    };
                }
                i += 1;
            }
            HtmlParserState::Tag => {
                let ch = chars[i];
                if ch == '"' {
                    state = HtmlParserState::AttrDouble;
                    i += 1;
                } else if ch == '\'' {
                    state = HtmlParserState::AttrSingle;
                    i += 1;
                } else if ch == '='
                    && i + 1 < len
                    && !chars[i + 1].is_whitespace()
                    && chars[i + 1] != '\''
                    && chars[i + 1] != '"'
                {
                    state = HtmlParserState::AttrUnquoted;
                    i += 1;
                } else if ch == '>' {
                    state = HtmlParserState::Text;
                    i += 1;
                } else {
                    i += 1;
                }
            }
            HtmlParserState::Text => {
                if i + 3 < len
                    && chars[i] == '<'
                    && chars[i + 1] == '!'
                    && chars[i + 2] == '-'
                    && chars[i + 3] == '-'
                {
                    state = HtmlParserState::Comment;
                    i += 4;
                } else if chars[i] == '<' {
                    state = HtmlParserState::Tag;
                    i += 1;
                } else {
                    i += 1;
                }
            }
        }
    }

    state
}

fn is_inside_tag_state(state: HtmlParserState) -> bool {
    matches!(
        state,
        HtmlParserState::Tag
            | HtmlParserState::AttrDouble
            | HtmlParserState::AttrSingle
            | HtmlParserState::AttrUnquoted
    )
}

fn extract_attribute_binding(trimmed: &str) -> (BindingKind, String) {
    let without_eq = trimmed
        .strip_suffix('=')
        .or_else(|| trimmed.strip_suffix("=\""))
        .or_else(|| trimmed.strip_suffix("='"))
        .unwrap_or(trimmed);

    let token = without_eq
        .split(|c: char| c.is_whitespace() || c == '<' || c == '>')
        .rfind(|s| !s.is_empty())
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

type StackFrame = (
    String,
    String,
    Vec<DomNode>,
    Vec<(BindingKind, String, usize)>,
);

fn parse_html_to_tree(html: &str, expr_meta: &[(bool, BindingKind, String)]) -> Vec<DomNode> {
    let mut chars = html.char_indices().peekable();
    let mut stack: Vec<StackFrame> = Vec::new();
    let mut top_nodes: Vec<DomNode> = Vec::new();
    let mut next_expr_idx = 0usize;

    let void_elements: [&str; 14] = [
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param",
        "source", "track", "wbr",
    ];

    let mut text_buf = String::new();

    let flush_text = |buf: &mut String, stack: &mut Vec<StackFrame>, top: &mut Vec<DomNode>| {
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

            // Check for expression marker comment <!--?-->
            if rest.starts_with("<!--?-->") {
                flush_text(&mut text_buf, &mut stack, &mut top_nodes);
                let marker = DomNode::Marker {
                    expr_idx: next_expr_idx,
                };
                next_expr_idx += 1;
                if let Some((_, _, children, _)) = stack.last_mut() {
                    children.push(marker);
                } else {
                    top_nodes.push(marker);
                }
                for _ in 0..8 {
                    chars.next();
                }
                continue;
            }

            // Check for comment <!--...-->
            if rest.starts_with("<!--") {
                flush_text(&mut text_buf, &mut stack, &mut top_nodes);

                if let Some(end_comment) = find_comment_end(rest) {
                    let comment_content = &rest[4..end_comment];
                    let comment = DomNode::Comment(comment_content.to_string());
                    if let Some((_, _, children, _)) = stack.last_mut() {
                        children.push(comment);
                    } else {
                        top_nodes.push(comment);
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
                if let Some(close_idx) = find_closing_tag_end(rest) {
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

                let count = tag_body.matches("__LIT_EXP__").count();
                let mut elem_bindings = Vec::with_capacity(count);
                for _ in 0..count {
                    if next_expr_idx < expr_meta.len() {
                        let (_, ref kind, ref name) = expr_meta[next_expr_idx];
                        elem_bindings.push((kind.clone(), name.clone(), next_expr_idx));
                        next_expr_idx += 1;
                    }
                }

                let static_attrs = clean_static_attributes(trimmed_body, tag_name.len());

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
                    if !current_token.contains("__LIT_EXP__") {
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
    if !current_token.is_empty() && !current_token.contains("__LIT_EXP__") {
        if !result.is_empty() {
            result.push(' ');
        }
        result.push_str(&current_token);
    }
    result.trim().to_string()
}

fn find_comment_end(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    if bytes.len() < 7 {
        return None;
    }
    let mut i = 4;
    while i + 2 < bytes.len() {
        if bytes[i] == b'-' && bytes[i + 1] == b'-' && bytes[i + 2] == b'>' {
            return Some(i);
        }
        i += 1;
    }
    None
}

fn find_closing_tag_end(s: &str) -> Option<usize> {
    s.char_indices()
        .skip(2)
        .find(|&(_, c)| c == '>')
        .map(|(i, _)| i)
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
            for (kind, name, expr_idx) in elem_bindings {
                bindings.push(BindingSite {
                    kind: kind.clone(),
                    name: Some(name.clone()),
                    path: path.to_vec(),
                    expression_index: *expr_idx,
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
        DomNode::Marker { expr_idx } => {
            bindings.push(BindingSite {
                kind: BindingKind::Text,
                name: None,
                path: path.to_vec(),
                expression_index: *expr_idx,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quote_aware_attribute_parsing() {
        // Tag with attribute value containing '>' inside quotes
        let quasis = vec!["<button title=\"hello > world\" @submit=", "></button>"];
        let parsed = parse_html_template(&quasis, 1).unwrap();
        assert_eq!(parsed.bindings.len(), 1);
        assert_eq!(parsed.bindings[0].kind, BindingKind::Event);
        assert_eq!(parsed.bindings[0].name.as_deref(), Some("submit"));
        assert!(parsed.html.contains("title=\"hello > world\""));
    }

    #[test]
    fn test_comment_aware_parsing() {
        // Comment containing '>' characters
        let quasis = vec!["<div><!-- comment > arrow -->", "</div>"];
        let parsed = parse_html_template(&quasis, 1).unwrap();
        assert_eq!(parsed.bindings.len(), 1);
        assert_eq!(parsed.bindings[0].kind, BindingKind::Text);
        assert!(parsed.html.contains("<!-- comment > arrow -->"));
    }

    #[test]
    fn test_empty_template() {
        let quasis: Vec<&str> = Vec::new();
        let parsed = parse_html_template(&quasis, 0).unwrap();
        assert!(parsed.html.is_empty());
        assert!(parsed.bindings.is_empty());
    }

    #[test]
    fn test_dynamic_tag_and_attribute_bailout() {
        // Dynamic tag name
        let dyn_tag_quasis = vec!["<", ">Header</", ">"];
        assert!(parse_html_template(&dyn_tag_quasis, 2).is_none());

        // Dynamic attribute name without '='
        let dyn_attr_quasis = vec!["<div ", "=\"val\">Content</div>"];
        assert!(parse_html_template(&dyn_attr_quasis, 1).is_none());
    }
}
