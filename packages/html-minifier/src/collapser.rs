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
                } else {
                    // Inside tag while in preserve mode
                    if state.quote.is_none() {
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
                }
                continue;
            }

            // 3. Normal HTML / SVG minification
            if !state.in_tag {
                // Mode: Outside tag (Text mode)

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
                    // We are starting a tag!
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
                    if !out.is_empty() && (!is_first_quasi || !out.is_empty()) {
                        out.push(' ');
                    }
                    pending_ws.clear();
                }
                state.after_tag_close = false;
                out.push(chars[i]);
                i += 1;
            } else {
                // Mode: Inside tag (<...>)
                if state.quote.is_none() {
                    if chars[i] == '"' || chars[i] == '\'' {
                        state.quote = Some(chars[i]);
                        out.push(chars[i]);
                        i += 1;
                    } else if chars[i] == '>' {
                        // Tag closing with >
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
                        // Self closing />
                        while out.ends_with(' ') {
                            out.pop();
                        }
                        out.push('/');
                        out.push('>');
                        i += 2;
                        state.in_tag = false;
                        state.after_tag_close = true;
                    } else if chars[i].is_whitespace() {
                        // Collapse whitespace inside tag to a single space
                        if !out.ends_with(' ') && !out.ends_with('=') && !out.ends_with('<') {
                            out.push(' ');
                        }
                        i += 1;
                    } else if chars[i] == '=' {
                        // Strip whitespace immediately before =
                        while out.ends_with(' ') {
                            out.pop();
                        }
                        out.push('=');
                        i += 1;
                    } else {
                        // Read tag name or attribute characters
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
                    // Inside attribute quote
                    if chars[i] == state.quote.unwrap() {
                        state.quote = None;
                    }
                    out.push(chars[i]);
                    i += 1;
                }
            }
        }

        // End of quasi handling
        if is_last_quasi {
            // Last quasi: discard trailing whitespace if at end of template
            // Only keep pending_ws if not after a tag close and out has content
            if !state.after_tag_close && !out.is_empty() && !pending_ws.is_empty() {
                out.push(' ');
            }
            pending_ws.clear();
        } else {
            // Non-last quasi: followed by an expression hole ${...}
            if !pending_ws.is_empty() {
                if !state.in_tag {
                    // In text mode: collapse multiple whitespace to single space
                    // If immediately after tag close (e.g. >\n  ${expr}), preserve single space if needed
                    if !out.is_empty() {
                        out.push(' ');
                    }
                } else {
                    // In tag mode: preserve single space between attributes if not after = or <
                    if !out.ends_with(' ') && !out.ends_with('=') && !out.ends_with('<') {
                        out.push(' ');
                    }
                }
                pending_ws.clear();
            }
            state.after_tag_close = false;
        }

        result.push(out);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_collapse_simple_tags() {
        let input = vec!["\n  <div>\n    <span>Hello</span>\n  </div>\n"];
        let output = collapse_template_quasis(&input);
        assert_eq!(output[0], "<div><span>Hello</span></div>");
    }

    #[test]
    fn test_collapse_strip_comments() {
        let input =
            vec!["\n  <div>\n    <!-- Remove this comment -->\n    <p>Test</p>\n  </div>\n"];
        let output = collapse_template_quasis(&input);
        assert_eq!(output[0], "<div><p>Test</p></div>");
    }

    #[test]
    fn test_collapse_tag_attributes() {
        let input = vec!["\n  <button\n    class=\"btn\"\n    type=\"button\"\n    disabled\n  >\n    Click\n  </button>\n"];
        let output = collapse_template_quasis(&input);
        assert_eq!(
            output[0],
            "<button class=\"btn\" type=\"button\" disabled> Click</button>"
        );
    }

    #[test]
    fn test_preserve_pre_code_textarea() {
        let input = vec!["\n  <div>\n    <pre>\n      line 1\n      line 2\n    </pre>\n    <code>  let x = 1;  </code>\n    <textarea>\n      text here\n    </textarea>\n  </div>\n"];
        let output = collapse_template_quasis(&input);
        assert!(output[0].contains("<pre>\n      line 1\n      line 2\n    </pre>"));
        assert!(output[0].contains("<code>  let x = 1;  </code>"));
        assert!(output[0].contains("<textarea>\n      text here\n    </textarea>"));
        assert!(!output[0].starts_with("\n"));
    }

    #[test]
    fn test_svg_collapse() {
        let input = vec!["\n  <svg viewBox=\"0 0 100 100\">\n    <circle cx=\"50\" cy=\"50\" r=\"40\" />\n    <path d=\"M0 0\" />\n  </svg>\n"];
        let output = collapse_template_quasis(&input);
        assert_eq!(output[0], "<svg viewBox=\"0 0 100 100\"><circle cx=\"50\" cy=\"50\" r=\"40\"/><path d=\"M0 0\"/></svg>");
    }

    #[test]
    fn test_expression_holes_preserved() {
        // html`<div class="${cls}">\n  <span>${name}</span>\n</div>`
        let input = vec![
            "\n  <div class=\"",
            "\">\n    <span>",
            "</span>\n  </div>\n",
        ];
        let output = collapse_template_quasis(&input);
        assert_eq!(output[0], "<div class=\"");
        assert_eq!(output[1], "\"><span>");
        assert_eq!(output[2], "</span></div>");
    }

    #[test]
    fn test_preserve_across_holes() {
        // html`<pre>${code}</pre>`
        let input = vec!["<pre>  ", "  </pre>"];
        let output = collapse_template_quasis(&input);
        assert_eq!(output[0], "<pre>  ");
        assert_eq!(output[1], "  </pre>");
    }
}
