#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PartKind {
    Attribute {
        name: String,
        strings: Vec<String>,
        ctor_type: u8, // 1: Attribute, 3: Property, 4: Boolean, 5: Event
    },
    Child,
    Element,
    Comment,
}

#[derive(Debug, Clone)]
pub struct TemplatePartInfo {
    pub kind: PartKind,
    pub index: u32,
}

#[derive(Debug, Clone)]
pub struct PreparedTemplate {
    pub prepared_html: String,
    pub parts: Vec<TemplatePartInfo>,
}

#[derive(Debug, PartialEq, Eq)]
enum TagState {
    Outside,
    InTagName,
    InTag,
    InAttrValueDouble,
    InAttrValueSingle,
    InAttrValueUnquoted,
    InComment,
}

pub fn parse_lit_template(quasis: &[String]) -> Option<PreparedTemplate> {
    let num_exprs = quasis.len().saturating_sub(1);
    if num_exprs == 0 {
        let single = quasis.first().cloned().unwrap_or_default();
        return Some(PreparedTemplate {
            prepared_html: single,
            parts: Vec::new(),
        });
    }

    // Pass 1: Parse the quasis and tokens to determine part placements and index
    let mut parts = Vec::with_capacity(num_exprs);
    let mut prepared_html = String::new();

    let mut current_node_index: i32 = -1;
    let mut current_element_index: i32 = -1;
    let mut state = TagState::Outside;
    let mut open_tags: Vec<String> = Vec::new();
    let mut current_tag = String::new();

    // Track if inside raw text elements: script, style, textarea, title
    let is_raw_text = |tag: &str| -> bool {
        let lower = tag.to_ascii_lowercase();
        lower == "script" || lower == "style" || lower == "textarea" || lower == "title"
    };

    // Buffer for building the current tag's output without bound attributes
    let mut tag_output = String::new();
    let mut attr_start_in_tag = 0;

    for (k, quasi) in quasis.iter().enumerate() {
        let chars: Vec<char> = quasi.chars().collect();
        let len = chars.len();
        let mut i = 0;

        while i < len {
            match state {
                TagState::InComment => {
                    if i + 2 < len && chars[i] == '-' && chars[i + 1] == '-' && chars[i + 2] == '>'
                    {
                        prepared_html.push_str("-->");
                        i += 3;
                        state = TagState::Outside;
                    } else {
                        prepared_html.push(chars[i]);
                        i += 1;
                    }
                }
                TagState::InAttrValueDouble => {
                    if chars[i] == '"' {
                        tag_output.push('"');
                        i += 1;
                        state = TagState::InTag;
                    } else {
                        tag_output.push(chars[i]);
                        i += 1;
                    }
                }
                TagState::InAttrValueSingle => {
                    if chars[i] == '\'' {
                        tag_output.push('\'');
                        i += 1;
                        state = TagState::InTag;
                    } else {
                        tag_output.push(chars[i]);
                        i += 1;
                    }
                }
                TagState::InAttrValueUnquoted => {
                    if chars[i].is_whitespace() || chars[i] == '>' {
                        state = TagState::InTag;
                    } else {
                        tag_output.push(chars[i]);
                        i += 1;
                    }
                }
                TagState::InTagName => {
                    if chars[i].is_whitespace() || chars[i] == '>' || chars[i] == '/' {
                        state = TagState::InTag;
                    } else {
                        current_tag.push(chars[i]);
                        tag_output.push(chars[i]);
                        i += 1;
                    }
                }
                TagState::InTag => {
                    let ch = chars[i];
                    if ch == '>' {
                        tag_output.push('>');
                        prepared_html.push_str(&tag_output);
                        tag_output.clear();

                        let is_self_closing = quasi[..i].ends_with('/');
                        let is_void = is_void_element(&current_tag) || is_self_closing;
                        if !is_void {
                            open_tags.push(current_tag.clone());
                        }
                        current_tag.clear();
                        state = TagState::Outside;
                        i += 1;
                    } else if ch == '"' {
                        tag_output.push('"');
                        state = TagState::InAttrValueDouble;
                        i += 1;
                    } else if ch == '\'' {
                        tag_output.push('\'');
                        state = TagState::InAttrValueSingle;
                        i += 1;
                    } else if ch == '=' {
                        tag_output.push('=');
                        i += 1;
                        if i < len {
                            if chars[i] == '"' {
                                tag_output.push('"');
                                state = TagState::InAttrValueDouble;
                                i += 1;
                            } else if chars[i] == '\'' {
                                tag_output.push('\'');
                                state = TagState::InAttrValueSingle;
                                i += 1;
                            } else if !chars[i].is_whitespace() && chars[i] != '>' {
                                state = TagState::InAttrValueUnquoted;
                            }
                        }
                    } else {
                        if ch.is_whitespace() {
                            attr_start_in_tag = tag_output.len() + 1;
                        }
                        tag_output.push(ch);
                        i += 1;
                    }
                }
                TagState::Outside => {
                    // Check for comment <!--
                    if i + 3 < len
                        && chars[i] == '<'
                        && chars[i + 1] == '!'
                        && chars[i + 2] == '-'
                        && chars[i + 3] == '-'
                    {
                        current_node_index += 1;
                        prepared_html.push_str("<!--");
                        i += 4;
                        state = TagState::InComment;
                        continue;
                    }

                    // Check for closing tag </tag>
                    if i + 1 < len && chars[i] == '<' && chars[i + 1] == '/' {
                        let mut close_end = i + 2;
                        while close_end < len && chars[close_end] != '>' {
                            close_end += 1;
                        }
                        if close_end < len {
                            let close_tag: String = chars[i + 2..close_end]
                                .iter()
                                .collect::<String>()
                                .trim()
                                .to_ascii_lowercase();
                            if let Some(pos) = open_tags.iter().rposition(|t| t == &close_tag) {
                                open_tags.truncate(pos);
                            }
                            prepared_html.push_str(&quasi[i..=close_end]);
                            i = close_end + 1;
                            continue;
                        }
                    }

                    // Check for start tag <tag
                    if chars[i] == '<'
                        && i + 1 < len
                        && (chars[i + 1].is_alphabetic() || chars[i + 1] == '_')
                    {
                        current_node_index += 1;
                        current_element_index = current_node_index;
                        current_tag.clear();
                        tag_output.clear();
                        tag_output.push('<');
                        state = TagState::InTagName;
                        attr_start_in_tag = 0;
                        i += 1;
                        continue;
                    }

                    prepared_html.push(chars[i]);
                    i += 1;
                }
            }
        }

        // At expression boundary between quasi k and k+1:
        if k < num_exprs {
            // Check if inside raw text element
            if let Some(cur_open) = open_tags.last() {
                if is_raw_text(cur_open) {
                    return None;
                }
            }

            match state {
                TagState::InTag
                | TagState::InAttrValueDouble
                | TagState::InAttrValueSingle
                | TagState::InAttrValueUnquoted => {
                    // Check if it's an attribute binding or element binding
                    let trimmed_tag = tag_output.trim_end();
                    if trimmed_tag.ends_with('=')
                        || trimmed_tag.ends_with("=\"")
                        || trimmed_tag.ends_with("='")
                    {
                        // Attribute binding!
                        let without_eq = trimmed_tag
                            .strip_suffix('=')
                            .or_else(|| trimmed_tag.strip_suffix("=\""))
                            .or_else(|| trimmed_tag.strip_suffix("='"))
                            .unwrap_or(trimmed_tag);

                        let raw_attr_name = without_eq
                            .split(|c: char| c.is_whitespace() || c == '<')
                            .rfind(|s| !s.is_empty())
                            .unwrap_or("");

                        let (ctor_type, attr_name) =
                            if let Some(prop) = raw_attr_name.strip_prefix('.') {
                                (3u8, prop.to_string())
                            } else if let Some(b) = raw_attr_name.strip_prefix('?') {
                                (4u8, b.to_string())
                            } else if let Some(ev) = raw_attr_name.strip_prefix('@') {
                                (5u8, ev.to_string())
                            } else {
                                (1u8, raw_attr_name.to_string())
                            };

                        let static_strings = vec!["".to_string(), "".to_string()];

                        // Remove this attribute from tag_output so prepared_html doesn't contain bound attributes
                        let remove_start =
                            tag_output.rfind(raw_attr_name).unwrap_or(attr_start_in_tag);
                        tag_output.truncate(remove_start);

                        parts.push(TemplatePartInfo {
                            kind: PartKind::Attribute {
                                name: attr_name,
                                strings: static_strings,
                                ctor_type,
                            },
                            index: current_element_index.max(0) as u32,
                        });

                        state = TagState::InTag;
                    } else {
                        // Element binding on current element
                        parts.push(TemplatePartInfo {
                            kind: PartKind::Element,
                            index: current_element_index.max(0) as u32,
                        });
                        state = TagState::InTag;
                    }
                }
                TagState::InComment => {
                    // Comment part
                    parts.push(TemplatePartInfo {
                        kind: PartKind::Comment,
                        index: current_node_index.max(0) as u32,
                    });
                }
                TagState::Outside => {
                    // Child part
                    current_node_index += 1;
                    parts.push(TemplatePartInfo {
                        kind: PartKind::Child,
                        index: current_node_index.max(0) as u32,
                    });

                    // Add <?> marker to prepared_html
                    prepared_html.push_str("<?>");

                    // If at the end and no text, or single child part at root
                    if k == num_exprs - 1
                        && k == 0
                        && quasi.is_empty()
                        && quasis.get(k + 1).map(|q| q.is_empty()).unwrap_or(false)
                    {
                        prepared_html.push_str("<!--?-->");
                    }
                }
                _ => {}
            }
        }
    }

    if !tag_output.is_empty() {
        prepared_html.push_str(&tag_output);
    }

    // Special case for single child part at root: "<?><!--?-->"
    if parts.len() == 1 && parts[0].kind == PartKind::Child && prepared_html == "<?>" {
        prepared_html = "<?><!--?-->".to_string();
    }

    Some(PreparedTemplate {
        prepared_html,
        parts,
    })
}

fn is_void_element(tag: &str) -> bool {
    let lower = tag.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}
