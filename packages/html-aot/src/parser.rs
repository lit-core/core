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
    InComment,
}

#[derive(Debug, Clone)]
struct ActiveAttr {
    name: String,
    ctor_type: u8,
    quote: Option<char>,
    strings: Vec<String>,
    current_string: String,
    element_index: u32,
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
    let mut active_attr: Option<ActiveAttr> = None;

    // Track if inside raw text elements: script, style, textarea, title
    let is_raw_text = |tag: &str| -> bool {
        let lower = tag.to_ascii_lowercase();
        lower == "script" || lower == "style" || lower == "textarea" || lower == "title"
    };

    // Buffer for building the current tag's output without bound attributes
    let mut tag_output = String::new();

    for (k, quasi) in quasis.iter().enumerate() {
        let chars: Vec<char> = quasi.chars().collect();
        let len = chars.len();
        let mut i = 0;

        // If resuming inside an attribute value from previous expression
        if let Some(ref mut attr) = active_attr {
            if let Some(q) = attr.quote {
                let mut found_quote = false;
                while i < len {
                    if chars[i] == q {
                        found_quote = true;
                        i += 1;
                        break;
                    }
                    attr.current_string.push(chars[i]);
                    i += 1;
                }
                if found_quote {
                    let mut finished = active_attr.take().unwrap();
                    finished
                        .strings
                        .push(std::mem::take(&mut finished.current_string));
                    parts.push(TemplatePartInfo {
                        kind: PartKind::Attribute {
                            name: finished.name,
                            strings: finished.strings,
                            ctor_type: finished.ctor_type,
                        },
                        index: finished.element_index,
                    });
                    state = TagState::InTag;
                }
            } else {
                let mut found_delimiter = false;
                while i < len {
                    if chars[i].is_whitespace() || chars[i] == '>' {
                        found_delimiter = true;
                        break;
                    }
                    attr.current_string.push(chars[i]);
                    i += 1;
                }
                if found_delimiter {
                    let mut finished = active_attr.take().unwrap();
                    finished
                        .strings
                        .push(std::mem::take(&mut finished.current_string));
                    parts.push(TemplatePartInfo {
                        kind: PartKind::Attribute {
                            name: finished.name,
                            strings: finished.strings,
                            ctor_type: finished.ctor_type,
                        },
                        index: finished.element_index,
                    });
                    state = TagState::InTag;
                }
            }
        }

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
                        while tag_output.ends_with(char::is_whitespace) {
                            tag_output.pop();
                        }
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
                    } else {
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

            if let Some(ref mut attr) = active_attr {
                let cur = std::mem::take(&mut attr.current_string);
                attr.strings.push(cur);
            } else {
                match state {
                    TagState::InTag
                    | TagState::InAttrValueDouble
                    | TagState::InAttrValueSingle
                    | TagState::InTagName => {
                        if let Some(eq_pos) = tag_output.rfind('=') {
                            let before_eq = &tag_output[..eq_pos];
                            let after_eq = &tag_output[eq_pos + 1..];

                            let (quote, prefix) = if let Some(stripped) = after_eq.strip_prefix('"')
                            {
                                (Some('"'), stripped.to_string())
                            } else if let Some(stripped) = after_eq.strip_prefix('\'') {
                                (Some('\''), stripped.to_string())
                            } else {
                                (None, after_eq.trim_start().to_string())
                            };

                            let trimmed_before = before_eq.trim_end();
                            let attr_name_start = trimmed_before
                                .rfind(|c: char| c.is_whitespace() || c == '<')
                                .map(|pos| pos + 1)
                                .unwrap_or(0);
                            let raw_attr_name = &trimmed_before[attr_name_start..];

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

                            let mut remove_pos = attr_name_start;
                            while remove_pos > 0
                                && tag_output.as_bytes()[remove_pos - 1].is_ascii_whitespace()
                            {
                                remove_pos -= 1;
                            }
                            tag_output.truncate(remove_pos);

                            active_attr = Some(ActiveAttr {
                                name: attr_name,
                                ctor_type,
                                quote,
                                strings: vec![prefix],
                                current_string: String::new(),
                                element_index: current_element_index.max(0) as u32,
                            });
                            state = TagState::InTag;
                        } else {
                            parts.push(TemplatePartInfo {
                                kind: PartKind::Element,
                                index: current_element_index.max(0) as u32,
                            });
                            while tag_output.ends_with(char::is_whitespace) {
                                tag_output.pop();
                            }
                            state = TagState::InTag;
                        }
                    }
                    TagState::InComment => {
                        parts.push(TemplatePartInfo {
                            kind: PartKind::Comment,
                            index: current_node_index.max(0) as u32,
                        });
                    }
                    TagState::Outside => {
                        current_node_index += 1;
                        parts.push(TemplatePartInfo {
                            kind: PartKind::Child,
                            index: current_node_index.max(0) as u32,
                        });

                        prepared_html.push_str("<?>");

                        if k == num_exprs - 1
                            && k == 0
                            && quasi.is_empty()
                            && quasis.get(k + 1).map(|q| q.is_empty()).unwrap_or(false)
                        {
                            prepared_html.push_str("<!--?-->");
                        }
                    }
                }
            }
        }
    }

    if let Some(mut attr) = active_attr {
        attr.strings.push(attr.current_string);
        parts.push(TemplatePartInfo {
            kind: PartKind::Attribute {
                name: attr.name,
                strings: attr.strings,
                ctor_type: attr.ctor_type,
            },
            index: attr.element_index,
        });
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
