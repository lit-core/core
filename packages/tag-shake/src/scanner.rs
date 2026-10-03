use std::collections::HashSet;

/// Scan source text for custom element tag names.
/// Matches tags like `<my-tag` or `</my-tag` where the tag name contains a hyphen.
pub fn scan_custom_element_tags(source: &str) -> Vec<String> {
    let mut tags = HashSet::new();
    let bytes = source.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'<' {
            i += 1;
            // Skip optional closing slash
            if i < len && bytes[i] == b'/' {
                i += 1;
            }
            // Skip optional whitespace
            while i < len
                && (bytes[i] == b' ' || bytes[i] == b'\t' || bytes[i] == b'\n' || bytes[i] == b'\r')
            {
                i += 1;
            }

            // Tag name must start with an ascii alphabetic character
            if i < len && bytes[i].is_ascii_alphabetic() {
                let start = i;
                let mut has_hyphen = false;

                while i < len {
                    let b = bytes[i];
                    if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' {
                        if b == b'-' {
                            has_hyphen = true;
                        }
                        i += 1;
                    } else {
                        break;
                    }
                }

                if has_hyphen && i > start {
                    let tag = source[start..i].to_ascii_lowercase();
                    // Additional check: must start with ascii lowercase letter and contain hyphen
                    if tag.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
                        tags.insert(tag);
                    }
                }
            }
        } else {
            i += 1;
        }
    }

    let mut result: Vec<String> = tags.into_iter().collect();
    result.sort();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_tags() {
        let source = r#"
            import { html } from 'lit';
            const template = html`
                <cds-button size="sm">Click</cds-button>
                <sp-action-button active></sp-action-button>
                <div>Not a custom element</div>
                <wa-icon-button name="heart"></wa-icon-button>
            `;
        "#;
        let tags = scan_custom_element_tags(source);
        assert_eq!(
            tags,
            vec!["cds-button", "sp-action-button", "wa-icon-button"]
        );
    }
}
