use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::SourceType;
use std::collections::HashSet;
use std::path::Path;

/// Check if a tag name conforms to the W3C Custom Elements specification:
/// - Must start with an ASCII lowercase letter [a-z].
/// - Must contain at least one ASCII hyphen '-'.
/// - May contain [a-z0-9._-].
/// - Must not be one of the reserved custom element names.
pub fn is_valid_custom_element_name(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }

    let bytes = name.as_bytes();
    if !bytes[0].is_ascii_lowercase() {
        return false;
    }

    let mut has_hyphen = false;
    for &b in bytes {
        if b == b'-' {
            has_hyphen = true;
        } else if !(b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'_') {
            return false;
        }
    }

    if !has_hyphen {
        return false;
    }

    // Reserved names per W3C Custom Elements specification
    !matches!(
        name,
        "annotation-xml"
            | "color-profile"
            | "font-face"
            | "font-face-src"
            | "font-face-uri"
            | "font-face-format"
            | "font-face-name"
            | "missing-glyph"
    )
}

#[derive(Debug, PartialEq, Eq)]
enum HtmlParserState {
    Text,
    TagInside,
    AttrDouble,
    AttrSingle,
    AttrUnquoted,
    Comment,
    Script,
    Style,
}

/// Tokenize an HTML string or template fragment using a spec-compliant state machine.
/// Properly handles comments, quoted attributes, and embedded script/style tags.
pub fn scan_html_tags_into(html: &str, tags: &mut HashSet<String>) {
    let bytes = html.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    let mut state = HtmlParserState::Text;

    while i < len {
        match state {
            HtmlParserState::Text => {
                // Check for HTML comment <!--
                if i + 3 < len && &bytes[i..i + 4] == b"<!--" {
                    state = HtmlParserState::Comment;
                    i += 4;
                    continue;
                }

                // Check for closing tag </
                if i + 1 < len && &bytes[i..i + 2] == b"</" {
                    i += 2;
                    while i < len && bytes[i] != b'>' {
                        i += 1;
                    }
                    if i < len && bytes[i] == b'>' {
                        i += 1;
                    }
                    continue;
                }

                // Check for opening tag <
                if bytes[i] == b'<' {
                    i += 1;
                    while i < len && bytes[i].is_ascii_whitespace() {
                        i += 1;
                    }
                    if i < len && bytes[i].is_ascii_alphabetic() {
                        let start = i;
                        while i < len
                            && (bytes[i].is_ascii_alphanumeric()
                                || bytes[i] == b'-'
                                || bytes[i] == b'_'
                                || bytes[i] == b'.')
                        {
                            i += 1;
                        }
                        let raw_tag = &html[start..i];
                        let tag_lower = raw_tag.to_ascii_lowercase();

                        if tag_lower == "script" {
                            state = HtmlParserState::Script;
                        } else if tag_lower == "style" {
                            state = HtmlParserState::Style;
                        } else {
                            if is_valid_custom_element_name(&tag_lower) {
                                tags.insert(tag_lower);
                            }
                            state = HtmlParserState::TagInside;
                        }
                        continue;
                    }
                }
                i += 1;
            }
            HtmlParserState::TagInside => {
                let b = bytes[i];
                if b == b'"' {
                    state = HtmlParserState::AttrDouble;
                    i += 1;
                } else if b == b'\'' {
                    state = HtmlParserState::AttrSingle;
                    i += 1;
                } else if b == b'='
                    && i + 1 < len
                    && !bytes[i + 1].is_ascii_whitespace()
                    && bytes[i + 1] != b'\''
                    && bytes[i + 1] != b'"'
                {
                    state = HtmlParserState::AttrUnquoted;
                    i += 1;
                } else if b == b'>' {
                    state = HtmlParserState::Text;
                    i += 1;
                } else {
                    i += 1;
                }
            }
            HtmlParserState::AttrDouble => {
                if bytes[i] == b'"' {
                    state = HtmlParserState::TagInside;
                }
                i += 1;
            }
            HtmlParserState::AttrSingle => {
                if bytes[i] == b'\'' {
                    state = HtmlParserState::TagInside;
                }
                i += 1;
            }
            HtmlParserState::AttrUnquoted => {
                if bytes[i].is_ascii_whitespace() || bytes[i] == b'>' || bytes[i] == b'/' {
                    if bytes[i] == b'>' {
                        state = HtmlParserState::Text;
                    } else {
                        state = HtmlParserState::TagInside;
                    }
                }
                i += 1;
            }
            HtmlParserState::Comment => {
                if i + 2 < len && &bytes[i..i + 3] == b"-->" {
                    state = HtmlParserState::Text;
                    i += 3;
                } else {
                    i += 1;
                }
            }
            HtmlParserState::Script => {
                if i + 8 <= len && html[i..i + 8].eq_ignore_ascii_case("</script") {
                    i += 8;
                    while i < len && bytes[i] != b'>' {
                        i += 1;
                    }
                    if i < len && bytes[i] == b'>' {
                        i += 1;
                    }
                    state = HtmlParserState::Text;
                } else {
                    i += 1;
                }
            }
            HtmlParserState::Style => {
                if i + 7 <= len && html[i..i + 7].eq_ignore_ascii_case("</style") {
                    i += 7;
                    while i < len && bytes[i] != b'>' {
                        i += 1;
                    }
                    if i < len && bytes[i] == b'>' {
                        i += 1;
                    }
                    state = HtmlParserState::Text;
                } else {
                    i += 1;
                }
            }
        }
    }
}

/// Tokenize and extract custom element tags from CSS selector strings.
fn extract_tags_from_css_selector(selector: &str, tags: &mut HashSet<String>) {
    for token in selector.split(|c: char| {
        c.is_ascii_whitespace()
            || matches!(
                c,
                '>' | '+' | '~' | '[' | ']' | '(' | ')' | '.' | '#' | ':' | ',' | '|'
            )
    }) {
        let trimmed = token.trim().to_ascii_lowercase();
        if is_valid_custom_element_name(&trimmed) {
            tags.insert(trimmed);
        }
    }
}

fn get_callee_method_name<'a>(expr: &'a Expression<'a>) -> Option<&'a str> {
    match expr {
        Expression::StaticMemberExpression(mem) => Some(mem.property.name.as_str()),
        Expression::Identifier(ident) => Some(ident.name.as_str()),
        _ => None,
    }
}

/// AST visitor scanning JavaScript / TypeScript AST for custom element references:
/// - Lit `html` and `svg` tagged template expressions
/// - JSX / TSX elements (<cds-button ...>)
/// - DOM APIs: `document.createElement('tag')`, `querySelector('tag')`, `customElements.get('tag')`
/// - Untagged template strings containing HTML markup
pub struct CustomElementAstVisitor<'a> {
    pub tags: HashSet<String>,
    _marker: std::marker::PhantomData<&'a ()>,
}

impl<'a> Visit<'a> for CustomElementAstVisitor<'a> {
    fn visit_jsx_opening_element(&mut self, elem: &JSXOpeningElement<'a>) {
        match &elem.name {
            JSXElementName::IdentifierReference(ident) => {
                let name = ident.name.as_str().to_ascii_lowercase();
                if is_valid_custom_element_name(&name) {
                    self.tags.insert(name);
                }
            }
            JSXElementName::Identifier(ident) => {
                let name = ident.name.as_str().to_ascii_lowercase();
                if is_valid_custom_element_name(&name) {
                    self.tags.insert(name);
                }
            }
            _ => {}
        }
        walk::walk_jsx_opening_element(self, elem);
    }

    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        for quasi in &tagged.quasi.quasis {
            scan_html_tags_into(quasi.value.raw.as_str(), &mut self.tags);
        }
        walk::walk_tagged_template_expression(self, tagged);
    }

    fn visit_template_literal(&mut self, lit: &TemplateLiteral<'a>) {
        for quasi in &lit.quasis {
            let s = quasi.value.raw.as_str();
            if s.contains('<') && s.contains('-') {
                scan_html_tags_into(s, &mut self.tags);
            }
        }
        walk::walk_template_literal(self, lit);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Some(method_name) = get_callee_method_name(&call.callee) {
            match method_name {
                "createElement" | "get" | "whenDefined" => {
                    if let Some(first_arg) = call.arguments.first().and_then(|a| a.as_expression())
                    {
                        if let Expression::StringLiteral(str_lit) = first_arg {
                            let tag = str_lit.value.as_str().to_ascii_lowercase();
                            if is_valid_custom_element_name(&tag) {
                                self.tags.insert(tag);
                            }
                        }
                    }
                }
                "querySelector" | "querySelectorAll" | "closest" | "matches" => {
                    if let Some(first_arg) = call.arguments.first().and_then(|a| a.as_expression())
                    {
                        if let Expression::StringLiteral(str_lit) = first_arg {
                            extract_tags_from_css_selector(str_lit.value.as_str(), &mut self.tags);
                        }
                    }
                }
                _ => {}
            }
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_string_literal(&mut self, lit: &StringLiteral<'a>) {
        let s = lit.value.as_str();
        if s.contains('<') && s.contains('-') {
            scan_html_tags_into(s, &mut self.tags);
        }
        walk::walk_string_literal(self, lit);
    }
}

/// Scan source text for custom element tag names using semantic AST traversal and spec-compliant HTML parsing.
pub fn scan_custom_element_tags(source: &str, filename: Option<&str>) -> Vec<String> {
    let mut tags = HashSet::new();

    let ext = filename
        .and_then(|f| Path::new(f).extension())
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let is_html_file = matches!(
        ext.to_ascii_lowercase().as_str(),
        "html" | "htm" | "svg" | "vue" | "svelte" | "astro"
    );

    if is_html_file {
        scan_html_tags_into(source, &mut tags);
    } else {
        let allocator = Allocator::default();
        let is_ts = matches!(
            ext.to_ascii_lowercase().as_str(),
            "ts" | "tsx" | "mts" | "cts"
        );
        let is_jsx = matches!(ext.to_ascii_lowercase().as_str(), "jsx" | "tsx");

        let path_obj = filename.map(Path::new);
        let source_type = path_obj
            .and_then(|p| SourceType::from_path(p).ok())
            .unwrap_or_else(|| SourceType::mjs())
            .with_module(true)
            .with_typescript(is_ts || filename.is_none())
            .with_jsx(is_jsx || filename.is_none());

        let parser = Parser::new(&allocator, source, source_type);
        let parsed = parser.parse();

        if !parsed.program.body.is_empty() {
            let mut visitor = CustomElementAstVisitor {
                tags: HashSet::new(),
                _marker: std::marker::PhantomData,
            };
            visitor.visit_program(&parsed.program);
            tags.extend(visitor.tags);
        } else {
            // Fallback for template files or non-JS snippets
            scan_html_tags_into(source, &mut tags);
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
    fn test_scan_lit_html_template() {
        let source = r#"
            import { html } from 'lit';
            const template = html`
                <cds-button size="sm">Click</cds-button>
                <sp-action-button active></sp-action-button>
                <div>Not a custom element</div>
                <wa-icon-button name="heart"></wa-icon-button>
            `;
        "#;
        let tags = scan_custom_element_tags(source, Some("app.ts"));
        assert_eq!(
            tags,
            vec!["cds-button", "sp-action-button", "wa-icon-button"]
        );
    }

    #[test]
    fn test_scan_jsx_elements() {
        let source = r#"
            export function MyView() {
                return (
                    <div>
                        <cds-modal open>
                            <cds-button>Confirm</cds-button>
                        </cds-modal>
                    </div>
                );
            }
        "#;
        let tags = scan_custom_element_tags(source, Some("view.tsx"));
        assert_eq!(tags, vec!["cds-button", "cds-modal"]);
    }

    #[test]
    fn test_scan_ignores_comments_and_attributes() {
        let source = r#"
            import { html } from 'lit';
            const template = html`
                <!-- <cds-commented-out></cds-commented-out> -->
                <div title="<cds-in-attribute>">
                    <cds-real-button></cds-real-button>
                </div>
            `;
        "#;
        let tags = scan_custom_element_tags(source, Some("app.ts"));
        assert_eq!(tags, vec!["cds-real-button"]);
    }

    #[test]
    fn test_scan_ignores_js_binary_comparisons() {
        let source = r#"
            const a = 10;
            const b = 5;
            const c = 2;
            if (a < b - c) {
                console.log("math");
            }
        "#;
        let tags = scan_custom_element_tags(source, Some("math.js"));
        assert_eq!(tags, Vec::<String>::new());
    }

    #[test]
    fn test_scan_dom_apis() {
        let source = r#"
            const btn = document.createElement('cds-button');
            const modal = document.querySelector('cds-modal.active');
            customElements.whenDefined('sp-picker');
        "#;
        let tags = scan_custom_element_tags(source, Some("dom.js"));
        assert_eq!(tags, vec!["cds-button", "cds-modal", "sp-picker"]);
    }

    #[test]
    fn test_valid_custom_element_rules() {
        assert!(is_valid_custom_element_name("cds-button"));
        assert!(is_valid_custom_element_name("my-element-1"));
        assert!(!is_valid_custom_element_name("div"));
        assert!(!is_valid_custom_element_name("font-face")); // Reserved
        assert!(!is_valid_custom_element_name("CDS-BUTTON")); // No uppercase
    }
}
