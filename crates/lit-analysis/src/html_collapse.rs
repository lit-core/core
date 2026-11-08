#[derive(Clone, Debug, Default)]
pub struct CollapserState {
    pub in_comment: bool,
    pub in_tag: bool,
    pub quote: Option<char>,
    pub is_closing_tag: bool,
    pub tag_name: String,
    pub tag_name_done: bool,
    pub after_tag_close: bool,
    pub preserve_stack: Vec<String>,
}

impl CollapserState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn in_preserve_mode(&self) -> bool {
        !self.preserve_stack.is_empty()
    }
}

pub fn is_preserve_tag(tag: &str) -> bool {
    matches!(tag, "pre" | "code" | "textarea" | "style" | "script")
}

/// Checks if '<' at position i in the quasi leads into a dynamic tag expression hole (${tag}),
/// such as `<${tag}` or `</${tag}`.
fn check_dynamic_tag(chars: &[char], i: usize, is_last_quasi: bool) -> Option<(bool, usize)> {
    if is_last_quasi || chars[i] != '<' {
        return None;
    }
    let len = chars.len();
    let mut j = i + 1;
    let mut is_closing = false;
    if j < len && chars[j] == '/' {
        is_closing = true;
        j += 1;
    }
    while j < len && chars[j].is_whitespace() {
        j += 1;
    }
    if j == len {
        Some((is_closing, len - i))
    } else {
        None
    }
}

/// Collapses whitespace across the quasis of a single tagged template expression.
/// Preserves expression holes completely untouched.
pub fn collapse_template_quasis(quasis: &[&str]) -> Vec<String> {
    let mut state = CollapserState::new();
    let num_quasis = quasis.len();
    let mut result = Vec::with_capacity(num_quasis);

    for (qi, quasi) in quasis.iter().enumerate() {
        let is_first_quasi = qi == 0;
        let is_last_quasi = qi == num_quasis - 1;

        let chars: Vec<char> = quasi.chars().collect();
        let len = chars.len();
        let mut out = String::with_capacity(len);
        let mut pending_ws = String::new();
        let mut i = 0;

        while i < len {
            // 1. Inside comment: search for -->
            if state.in_comment {
                if i + 2 < len && chars[i] == '-' && chars[i + 1] == '-' && chars[i + 2] == '>' {
                    state.in_comment = false;
                    i += 3;
                } else {
                    i += 1;
                }
                continue;
            }

            // 2. Preserve mode: pre, code, textarea, style, script
            if state.in_preserve_mode() {
                if !state.in_tag {
                    if chars[i] == '<' {
                        state.in_tag = true;
                        state.quote = None;
                        state.tag_name.clear();
                        state.tag_name_done = false;
                        state.is_closing_tag = i + 1 < len && chars[i + 1] == '/';
                        out.push('<');
                        i += 1;
                    } else {
                        out.push(chars[i]);
                        i += 1;
                    }
                } else if state.quote.is_none() {
                    if chars[i] == '"' || chars[i] == '\'' {
                        state.quote = Some(chars[i]);
                        out.push(chars[i]);
                        i += 1;
                    } else if chars[i] == '>' {
                        state.in_tag = false;
                        out.push('>');
                        i += 1;
                        let tag_lower = state.tag_name.to_ascii_lowercase();
                        if state.is_closing_tag {
                            if let Some(pos) =
                                state.preserve_stack.iter().rposition(|t| t == &tag_lower)
                            {
                                state.preserve_stack.truncate(pos);
                            }
                        } else if is_preserve_tag(&tag_lower) && !out.ends_with("/>") {
                            state.preserve_stack.push(tag_lower);
                        }
                    } else {
                        if !state.tag_name_done {
                            if chars[i].is_alphanumeric()
                                || chars[i] == '-'
                                || chars[i] == '_'
                                || chars[i] == ':'
                            {
                                state.tag_name.push(chars[i]);
                            } else if chars[i] != '/' {
                                state.tag_name_done = true;
                            }
                        }
                        out.push(chars[i]);
                        i += 1;
                    }
                } else {
                    if chars[i] == state.quote.unwrap() {
                        state.quote = None;
                    }
                    out.push(chars[i]);
                    i += 1;
                }
                continue;
            }

            // 3. Normal HTML / SVG minification
            if !state.in_tag {
                // Check for HTML comment start: <!--
                if i + 3 < len
                    && chars[i] == '<'
                    && chars[i + 1] == '!'
                    && chars[i + 2] == '-'
                    && chars[i + 3] == '-'
                {
                    state.in_comment = true;
                    i += 4;
                    continue;
                }

                // Check for dynamic tag start: <${tag} or </${tag}
                if let Some((is_closing, consumed)) = check_dynamic_tag(&chars, i, is_last_quasi) {
                    if state.after_tag_close || (is_first_quasi && out.is_empty()) || is_closing {
                        pending_ws.clear();
                    } else if !pending_ws.is_empty() {
                        out.push(' ');
                        pending_ws.clear();
                    }

                    state.after_tag_close = false;
                    state.in_tag = true;
                    state.quote = None;
                    state.tag_name.clear();
                    state.tag_name_done = true;
                    state.is_closing_tag = is_closing;
                    out.push('<');
                    if is_closing {
                        out.push('/');
                    }
                    i += consumed;
                    continue;
                }

                // Check for tag start: <tag or </tag or <! or <?
                if chars[i] == '<'
                    && i + 1 < len
                    && (chars[i + 1] == '/'
                        || chars[i + 1].is_ascii_alphabetic()
                        || chars[i + 1] == '!'
                        || chars[i + 1] == '?'
                        || chars[i + 1] == ':'
                        || chars[i + 1] == '_')
                {
                    let is_closing = chars[i + 1] == '/';
                    if state.after_tag_close || (is_first_quasi && out.is_empty()) || is_closing {
                        pending_ws.clear();
                    } else if !pending_ws.is_empty() {
                        out.push(' ');
                        pending_ws.clear();
                    }

                    state.after_tag_close = false;
                    state.in_tag = true;
                    state.quote = None;
                    state.tag_name.clear();
                    state.tag_name_done = false;
                    state.is_closing_tag = is_closing;
                    out.push('<');
                    i += 1;
                    continue;
                }

                // Check for whitespace
                if chars[i].is_whitespace() {
                    pending_ws.push(chars[i]);
                    i += 1;
                    continue;
                }

                // Non-whitespace character
                if !pending_ws.is_empty() {
                    if !is_first_quasi || !out.is_empty() {
                        out.push(' ');
                    }
                    pending_ws.clear();
                }
                state.after_tag_close = false;
                out.push(chars[i]);
                i += 1;
            } else if state.quote.is_none() {
                if chars[i] == '"' || chars[i] == '\'' {
                    state.quote = Some(chars[i]);
                    out.push(chars[i]);
                    i += 1;
                } else if chars[i] == '>' {
                    while out.ends_with(' ') {
                        out.pop();
                    }
                    out.push('>');
                    i += 1;
                    state.in_tag = false;
                    state.after_tag_close = true;

                    let tag_lower = state.tag_name.to_ascii_lowercase();
                    if state.is_closing_tag {
                        if let Some(pos) =
                            state.preserve_stack.iter().rposition(|t| t == &tag_lower)
                        {
                            state.preserve_stack.truncate(pos);
                        }
                    } else {
                        let is_self_closing = out.ends_with("/>");
                        if !is_self_closing && is_preserve_tag(&tag_lower) {
                            state.preserve_stack.push(tag_lower);
                        }
                    }
                } else if chars[i] == '/' && i + 1 < len && chars[i + 1] == '>' {
                    while out.ends_with(' ') {
                        out.pop();
                    }
                    out.push('/');
                    out.push('>');
                    i += 2;
                    state.in_tag = false;
                    state.after_tag_close = true;
                } else if chars[i].is_whitespace() {
                    if !out.ends_with(' ') && !out.ends_with('=') && !out.ends_with('<') {
                        out.push(' ');
                    }
                    i += 1;
                } else if chars[i] == '=' {
                    while out.ends_with(' ') {
                        out.pop();
                    }
                    out.push('=');
                    i += 1;
                } else {
                    if !state.tag_name_done {
                        if chars[i].is_alphanumeric()
                            || chars[i] == '-'
                            || chars[i] == '_'
                            || chars[i] == ':'
                        {
                            state.tag_name.push(chars[i]);
                        } else if chars[i] != '/' {
                            state.tag_name_done = true;
                        }
                    }
                    out.push(chars[i]);
                    i += 1;
                }
            } else {
                if chars[i] == state.quote.unwrap() {
                    state.quote = None;
                }
                out.push(chars[i]);
                i += 1;
            }
        }

        if is_last_quasi {
            if !state.after_tag_close && !out.is_empty() && !pending_ws.is_empty() {
                out.push(' ');
            }
            pending_ws.clear();
        } else {
            if !pending_ws.is_empty() {
                if !state.in_tag {
                    if !is_first_quasi || !out.is_empty() {
                        out.push(' ');
                    }
                } else if !out.ends_with(' ') && !out.ends_with('=') && !out.ends_with('<') {
                    out.push(' ');
                }
                pending_ws.clear();
            }
            state.after_tag_close = false;
        }

        result.push(out);
    }

    if state.in_comment || state.quote.is_some() {
        return quasis.iter().map(|s| s.to_string()).collect();
    }

    result
}
