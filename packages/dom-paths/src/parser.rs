use std::collections::HashSet;

// HTML void elements that cannot have child nodes
static VOID_ELEMENTS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PartDescriptor {
    pub path: Vec<u32>,
    pub is_attribute: bool,
    pub target_tag: Option<String>,
}

#[derive(Debug, Clone)]
struct OpenElement {
    tag: String,
    child_count: usize,
    path: Vec<u32>,
    last_child_was_text: bool,
}

#[derive(Debug, Clone)]
struct OpeningElement {
    tag: String,
    path: Vec<u32>,
    is_void: bool,
    is_self_closing: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum ParserState {
    Text,
    Tag,
    AttrUnquoted,
    AttrSingle,
    AttrDouble,
    Comment,
}

pub fn compute_template_paths(quasis: &[String], normalize_whitespace: bool) -> Vec<Vec<u32>> {
    compute_template_parts(quasis, normalize_whitespace)
        .into_iter()
        .map(|p| p.path)
        .collect()
}

pub fn compute_template_parts(
    quasis: &[String],
    normalize_whitespace: bool,
) -> Vec<PartDescriptor> {
    let num_expressions = quasis.len().saturating_sub(1);
    if num_expressions == 0 {
        return Vec::new();
    }

    let void_set: HashSet<&'static str> = VOID_ELEMENTS.iter().copied().collect();
    let mut parts: Vec<PartDescriptor> = Vec::with_capacity(num_expressions);

    let mut stack: Vec<OpenElement> = Vec::new();
    let mut root_child_count: usize = 0;
    let mut root_last_child_was_text = false;

    let mut current_opening: Option<OpeningElement> = None;
    let mut state = ParserState::Text;
    let mut pending_text = String::new();

    for (k, quasi) in quasis.iter().enumerate() {
        let chars: Vec<char> = quasi.chars().collect();
        let len = chars.len();
        let mut i = 0;

        while i < len {
            match state {
                ParserState::Comment => {
                    if i + 2 < len && chars[i] == '-' && chars[i + 1] == '-' && chars[i + 2] == '>'
                    {
                        i += 3;
                        state = ParserState::Text;
                    } else {
                        i += 1;
                    }
                }
                ParserState::AttrDouble => {
                    if chars[i] == '"' {
                        i += 1;
                        state = ParserState::Tag;
                    } else {
                        i += 1;
                    }
                }
                ParserState::AttrSingle => {
                    if chars[i] == '\'' {
                        i += 1;
                        state = ParserState::Tag;
                    } else {
                        i += 1;
                    }
                }
                ParserState::AttrUnquoted => {
                    if chars[i].is_whitespace() || chars[i] == '>' || chars[i] == '/' {
                        state = ParserState::Tag;
                    } else {
                        i += 1;
                    }
                }
                ParserState::Tag => {
                    let ch = chars[i];
                    if ch == '"' {
                        state = ParserState::AttrDouble;
                        i += 1;
                    } else if ch == '\'' {
                        state = ParserState::AttrSingle;
                        i += 1;
                    } else if ch == '='
                        && i + 1 < len
                        && !chars[i + 1].is_whitespace()
                        && chars[i + 1] != '\''
                        && chars[i + 1] != '"'
                    {
                        state = ParserState::AttrUnquoted;
                        i += 1;
                    } else if ch == '/' && i + 1 < len && chars[i + 1] == '>' {
                        // Self-closing element like <circle /> or <path />
                        if let Some(mut opening) = current_opening.take() {
                            opening.is_self_closing = true;
                        }
                        i += 2;
                        state = ParserState::Text;
                    } else if ch == '>' {
                        i += 1;
                        state = ParserState::Text;
                        if let Some(opening) = current_opening.take() {
                            if !opening.is_void && !opening.is_self_closing {
                                stack.push(OpenElement {
                                    tag: opening.tag,
                                    child_count: 0,
                                    path: opening.path,
                                    last_child_was_text: false,
                                });
                            }
                        }
                    } else {
                        i += 1;
                    }
                }
                ParserState::Text => {
                    // Check comment
                    if i + 3 < len
                        && chars[i] == '<'
                        && chars[i + 1] == '!'
                        && chars[i + 2] == '-'
                        && chars[i + 3] == '-'
                    {
                        flush_pending_text(
                            &mut pending_text,
                            normalize_whitespace,
                            &mut stack,
                            &mut root_child_count,
                            &mut root_last_child_was_text,
                        );
                        state = ParserState::Comment;
                        i += 4;
                        continue;
                    }

                    // Check end tag </tag>
                    if i + 1 < len && chars[i] == '<' && chars[i + 1] == '/' {
                        flush_pending_text(
                            &mut pending_text,
                            normalize_whitespace,
                            &mut stack,
                            &mut root_child_count,
                            &mut root_last_child_was_text,
                        );
                        let mut close_end = i + 2;
                        while close_end < len && chars[close_end] != '>' {
                            close_end += 1;
                        }
                        if close_end < len {
                            let close_tag: String = chars[i + 2..close_end]
                                .iter()
                                .collect::<String>()
                                .trim()
                                .to_lowercase();
                            i = close_end + 1;

                            // Pop matching element or top
                            let mut pop_idx = None;
                            for (idx, elem) in stack.iter().enumerate().rev() {
                                if elem.tag == close_tag {
                                    pop_idx = Some(idx);
                                    break;
                                }
                            }
                            if let Some(idx) = pop_idx {
                                stack.truncate(idx);
                            } else if !stack.is_empty() {
                                stack.pop();
                            }

                            if let Some(cur) = stack.last_mut() {
                                cur.last_child_was_text = false;
                            } else {
                                root_last_child_was_text = false;
                            }
                        } else {
                            i = len;
                        }
                        continue;
                    }

                    // Check start tag <tag
                    if chars[i] == '<'
                        && i + 1 < len
                        && (chars[i + 1].is_alphabetic() || chars[i + 1] == '_')
                    {
                        flush_pending_text(
                            &mut pending_text,
                            normalize_whitespace,
                            &mut stack,
                            &mut root_child_count,
                            &mut root_last_child_was_text,
                        );

                        let mut tag_end = i + 1;
                        while tag_end < len
                            && (chars[tag_end].is_alphanumeric()
                                || chars[tag_end] == '-'
                                || chars[tag_end] == '_'
                                || chars[tag_end] == ':')
                        {
                            tag_end += 1;
                        }

                        let tag: String = chars[i + 1..tag_end].iter().collect();
                        let lower_tag = tag.to_lowercase();

                        let (elem_path, is_void) = if let Some(parent) = stack.last_mut() {
                            let idx = parent.child_count as u32;
                            parent.child_count += 1;
                            parent.last_child_was_text = false;
                            let mut p = parent.path.clone();
                            p.push(idx);
                            (p, void_set.contains(lower_tag.as_str()))
                        } else {
                            let idx = root_child_count as u32;
                            root_child_count += 1;
                            root_last_child_was_text = false;
                            (vec![idx], void_set.contains(lower_tag.as_str()))
                        };

                        current_opening = Some(OpeningElement {
                            tag: lower_tag,
                            path: elem_path,
                            is_void,
                            is_self_closing: false,
                        });

                        i = tag_end;
                        state = ParserState::Tag;
                        continue;
                    }

                    pending_text.push(chars[i]);
                    i += 1;
                }
            }
        }

        // At expression boundary k
        if k < num_expressions {
            match state {
                ParserState::Tag
                | ParserState::AttrUnquoted
                | ParserState::AttrSingle
                | ParserState::AttrDouble => {
                    // Expression in attribute position on current_opening
                    if let Some(ref opening) = current_opening {
                        parts.push(PartDescriptor {
                            path: opening.path.clone(),
                            is_attribute: true,
                            target_tag: Some(opening.tag.clone()),
                        });
                    } else if let Some(cur) = stack.last() {
                        parts.push(PartDescriptor {
                            path: cur.path.clone(),
                            is_attribute: true,
                            target_tag: Some(cur.tag.clone()),
                        });
                    } else {
                        parts.push(PartDescriptor {
                            path: vec![root_child_count.saturating_sub(1) as u32],
                            is_attribute: true,
                            target_tag: None,
                        });
                    }
                }
                _ => {
                    // Expression in child content position
                    flush_pending_text(
                        &mut pending_text,
                        normalize_whitespace,
                        &mut stack,
                        &mut root_child_count,
                        &mut root_last_child_was_text,
                    );

                    let (child_path, target_tag) = if let Some(parent) = stack.last_mut() {
                        let idx = parent.child_count as u32;
                        parent.child_count += 1;
                        parent.last_child_was_text = false;
                        let mut p = parent.path.clone();
                        p.push(idx);
                        (p, Some(parent.tag.clone()))
                    } else {
                        let idx = root_child_count as u32;
                        root_child_count += 1;
                        root_last_child_was_text = false;
                        (vec![idx], None)
                    };

                    parts.push(PartDescriptor {
                        path: child_path,
                        is_attribute: false,
                        target_tag,
                    });
                }
            }
        }
    }

    parts
}

fn flush_pending_text(
    pending_text: &mut String,
    normalize_whitespace: bool,
    stack: &mut [OpenElement],
    root_child_count: &mut usize,
    root_last_child_was_text: &mut bool,
) {
    if pending_text.is_empty() {
        return;
    }

    let is_pure_ws = pending_text.chars().all(|c| c.is_whitespace());
    pending_text.clear();

    if normalize_whitespace && is_pure_ws {
        return;
    }

    if let Some(parent) = stack.last_mut() {
        if !parent.last_child_was_text {
            parent.child_count += 1;
            parent.last_child_was_text = true;
        }
    } else if !*root_last_child_was_text {
        *root_child_count += 1;
        *root_last_child_was_text = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prompt_example() {
        let quasis = vec![
            "<div>\n  <h1>Title</h1>\n  <p>Count: ".to_string(),
            "</p>\n  <button @click=".to_string(),
            ">+</button>\n</div>".to_string(),
        ];
        let paths = compute_template_paths(&quasis, true);
        assert_eq!(paths, vec![vec![0, 1, 1], vec![0, 2]]);
    }

    #[test]
    fn test_svg_elements() {
        let quasis = vec![
            "<svg viewBox=\"0 0 100 100\">\n  <circle cx=\"50\" cy=\"50\" r=\"".to_string(),
            "\" />\n  <text x=\"50\" y=\"50\">".to_string(),
            "</text>\n</svg>".to_string(),
        ];
        let paths = compute_template_paths(&quasis, true);
        assert_eq!(paths, vec![vec![0, 0], vec![0, 1, 0]]);
    }

    #[test]
    fn test_adjacent_expressions() {
        let quasis = vec![
            "<div>\n  <span>".to_string(),
            "".to_string(),
            "</span>\n</div>".to_string(),
        ];
        let paths = compute_template_paths(&quasis, true);
        assert_eq!(paths, vec![vec![0, 0, 0], vec![0, 0, 1]]);
    }
}
