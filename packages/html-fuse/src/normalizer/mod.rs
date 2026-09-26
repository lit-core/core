pub mod hasher;

use crate::normalizer::hasher::compute_fragment_hash;

/// Normalizes raw HTML or SVG template fragments into a canonical representation.
/// Minor formatting, whitespace and indentation differences across components
/// are collapsed so identical static trees map to the same cluster.
pub fn normalize_fragment(raw: &str) -> (String, String) {
    let trimmed = raw.trim();
    let mut normalized = String::with_capacity(trimmed.len());

    let mut in_tag = false;
    let mut in_quote = None; // Some('"') or Some('\'')
    let mut prev_char = ' ';
    let chars: Vec<char> = trimmed.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let ch = chars[i];

        if !in_tag {
            if ch == '<' {
                in_tag = true;
                // If previous char was whitespace, trim it if preceded by '>'
                if normalized.ends_with(' ') && normalized.trim_end().ends_with('>') {
                    let trimmed_end = normalized.trim_end();
                    normalized.truncate(trimmed_end.len());
                }
                normalized.push('<');
                prev_char = '<';
            } else if ch == '>' {
                normalized.push('>');
                prev_char = '>';
            } else if ch.is_whitespace() {
                // If we are between tags (e.g. >\s+<), avoid accumulating spaces
                if !normalized.ends_with('>') && !normalized.ends_with(' ') {
                    normalized.push(' ');
                    prev_char = ' ';
                }
            } else {
                normalized.push(ch);
                prev_char = ch;
            }
            i += 1;
        } else {
            // Inside a tag
            if let Some(q) = in_quote {
                normalized.push(ch);
                if ch == q && (i == 0 || chars[i - 1] != '\\') {
                    in_quote = None;
                }
                prev_char = ch;
                i += 1;
            } else {
                if ch == '"' || ch == '\'' {
                    in_quote = Some(ch);
                    normalized.push(ch);
                    prev_char = ch;
                    i += 1;
                } else if ch == '>' {
                    in_tag = false;
                    // Normalize " />" to "/>"
                    if normalized.ends_with(" /") {
                        normalized.pop();
                    }
                    normalized.push('>');
                    prev_char = '>';
                    i += 1;
                } else if ch == '/' && i + 1 < len && chars[i + 1] == '>' {
                    // Self closing "/>"
                    if normalized.ends_with(' ') {
                        normalized.pop();
                    }
                    normalized.push_str("/>");
                    in_tag = false;
                    prev_char = '>';
                    i += 2;
                } else if ch.is_whitespace() {
                    if prev_char != ' ' && prev_char != '<' {
                        normalized.push(' ');
                        prev_char = ' ';
                    }
                    i += 1;
                } else {
                    normalized.push(ch);
                    prev_char = ch;
                    i += 1;
                }
            }
        }
    }

    let canonical = normalized.trim().to_string();
    let hash = compute_fragment_hash(&canonical);
    (canonical, hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_fragment_whitespace() {
        let raw1 = "<svg   viewBox=\"0 0 16 16\">\n  <path d=\"M4 6\" />\n</svg>";
        let raw2 = "<svg viewBox=\"0 0 16 16\"><path d=\"M4 6\"/></svg>";
        let (canon1, hash1) = normalize_fragment(raw1);
        let (canon2, hash2) = normalize_fragment(raw2);

        assert_eq!(canon1, canon2);
        assert_eq!(hash1, hash2);
        assert_eq!(canon1, "<svg viewBox=\"0 0 16 16\"><path d=\"M4 6\"/></svg>");
    }

    #[test]
    fn test_normalize_slot_wrapper() {
        let raw1 = "<slot \n  name=\"decorator\" \n  slot=\"decorator\"></slot>";
        let raw2 = "<slot name=\"decorator\" slot=\"decorator\"></slot>";
        let (c1, h1) = normalize_fragment(raw1);
        let (c2, h2) = normalize_fragment(raw2);

        assert_eq!(c1, c2);
        assert_eq!(h1, h2);
    }
}
