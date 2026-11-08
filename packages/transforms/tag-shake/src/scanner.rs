use html5ever::tendril::StrTendril;
use html5ever::tokenizer::{
    BufferQueue, TagKind, Token, TokenSink, TokenSinkResult, Tokenizer, TokenizerOpts, states,
};
use lightningcss::selector::{Component, Selector};
use lightningcss::stylesheet::{ParserOptions, StyleSheet};
use lightningcss::{
    visit_types,
    visitor::{Visit as CssVisit, VisitTypes, Visitor as CssVisitor},
};
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{Visit, walk};
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

struct HtmlTagScanner<'a> {
    tags: &'a mut HashSet<String>,
}

impl TokenSink for HtmlTagScanner<'_> {
    type Handle = ();

    fn process_token(&mut self, token: Token, _line_number: u64) -> TokenSinkResult<()> {
        if let Token::TagToken(tag) = token
            && tag.kind == TagKind::StartTag
        {
            let tag_lower = tag.name.as_ref().to_ascii_lowercase();
            if matches!(
                tag_lower.as_str(),
                "script" | "style" | "textarea" | "title"
            ) {
                if !tag.self_closing {
                    return TokenSinkResult::RawData(states::RawKind::ScriptData);
                }
            } else if is_valid_custom_element_name(&tag_lower) {
                self.tags.insert(tag_lower);
            }
        }
        TokenSinkResult::Continue
    }
}

/// Tokenize an HTML string or template fragment using `html5ever`'s WHATWG HTML5 tokenizer.
/// Properly handles comments, quoted attributes, and embedded script/style/textarea rawdata tags.
pub fn scan_html_tags_into(html: &str, tags: &mut HashSet<String>) {
    let sink = HtmlTagScanner { tags };
    let mut tokenizer = Tokenizer::new(sink, TokenizerOpts::default());
    let mut input = BufferQueue::default();
    input.push_back(StrTendril::from_slice(html));
    let _ = tokenizer.feed(&mut input);
    tokenizer.end();
}

struct SelectorTagExtractor<'a> {
    tags: &'a mut HashSet<String>,
}

impl<'i> CssVisitor<'i> for SelectorTagExtractor<'_> {
    type Error = std::convert::Infallible;

    fn visit_types(&self) -> VisitTypes {
        visit_types!(SELECTORS)
    }

    fn visit_selector(&mut self, selector: &mut Selector<'i>) -> Result<(), Self::Error> {
        for component in selector.iter_raw_match_order() {
            if let Component::LocalName(local) = component {
                let name = local.lower_name.as_ref();
                if is_valid_custom_element_name(name) {
                    self.tags.insert(name.to_string());
                }
            }
        }
        selector.visit_children(self)
    }
}

/// Tokenize and extract custom element tags from CSS selector strings using `lightningcss`.
fn extract_tags_from_css_selector(selector: &str, tags: &mut HashSet<String>) {
    let wrapped = format!("{selector}{{}}");
    if let Ok(mut sheet) = StyleSheet::parse(&wrapped, ParserOptions::default()) {
        let mut extractor = SelectorTagExtractor { tags };
        let _ = sheet.visit(&mut extractor);
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
/// - JSX / TSX elements (<my-button ...>)
/// - DOM APIs: `document.createElement('tag')`, `querySelector('tag')`, `customElements.get('tag')`
/// - Untagged template strings containing HTML markup
pub struct CustomElementAstVisitor<'a> {
    pub tags: HashSet<String>,
    _marker: std::marker::PhantomData<&'a ()>,
}

impl<'a> CustomElementAstVisitor<'a> {
    pub fn new() -> Self {
        Self {
            tags: HashSet::new(),
            _marker: std::marker::PhantomData,
        }
    }
}

impl<'a> Default for CustomElementAstVisitor<'a> {
    fn default() -> Self {
        Self::new()
    }
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
        let joined: String = tagged
            .quasi
            .quasis
            .iter()
            .map(|q| q.value.raw.as_str())
            .collect::<Vec<_>>()
            .join("__lit_hole__");
        scan_html_tags_into(&joined, &mut self.tags);
        walk::walk_tagged_template_expression(self, tagged);
    }

    fn visit_template_literal(&mut self, lit: &TemplateLiteral<'a>) {
        let joined: String = lit
            .quasis
            .iter()
            .map(|q| q.value.raw.as_str())
            .collect::<Vec<_>>()
            .join("__lit_hole__");
        if joined.contains('<') && joined.contains('-') {
            scan_html_tags_into(&joined, &mut self.tags);
        }
        walk::walk_template_literal(self, lit);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Some(method_name) = get_callee_method_name(&call.callee) {
            let first_static_str = call
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .and_then(|expr| match expr {
                    Expression::StringLiteral(str_lit) => Some(str_lit.value.as_str()),
                    Expression::TemplateLiteral(tpl)
                        if tpl.expressions.is_empty() && tpl.quasis.len() == 1 =>
                    {
                        Some(tpl.quasis[0].value.raw.as_str())
                    }
                    _ => None,
                });
            match method_name {
                "createElement" | "get" | "whenDefined" => {
                    if let Some(raw_str) = first_static_str {
                        let tag = raw_str.trim().to_ascii_lowercase();
                        if is_valid_custom_element_name(&tag) {
                            self.tags.insert(tag);
                        }
                    }
                }
                "querySelector" | "querySelectorAll" | "closest" | "matches" => {
                    if let Some(raw_str) = first_static_str {
                        extract_tags_from_css_selector(raw_str, &mut self.tags);
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
            .unwrap_or_else(SourceType::mjs)
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
                <my-button size="sm">Click</my-button>
                <ui-action-button active></ui-action-button>
                <div>Not a custom element</div>
                <x-icon-button name="heart"></x-icon-button>
            `;
        "#;
        let tags = scan_custom_element_tags(source, Some("app.ts"));
        assert_eq!(tags, vec!["my-button", "ui-action-button", "x-icon-button"]);
    }

    #[test]
    fn test_scan_jsx_elements() {
        let source = r#"
            export function MyView() {
                return (
                    <div>
                        <ui-modal open>
                            <my-button>Confirm</my-button>
                        </ui-modal>
                    </div>
                );
            }
        "#;
        let tags = scan_custom_element_tags(source, Some("view.tsx"));
        assert_eq!(tags, vec!["my-button", "ui-modal"]);
    }

    #[test]
    fn test_scan_ignores_comments_and_attributes() {
        let source = r#"
            import { html } from 'lit';
            const template = html`
                <!-- <my-commented-out></my-commented-out> -->
                <div title="<my-in-attribute>">
                    <my-real-button></my-real-button>
                </div>
            `;
        "#;
        let tags = scan_custom_element_tags(source, Some("app.ts"));
        assert_eq!(tags, vec!["my-real-button"]);
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
            const btn = document.createElement('my-button');
            const modal = document.querySelector('ui-modal.active');
            customElements.whenDefined('ui-picker');
        "#;
        let tags = scan_custom_element_tags(source, Some("dom.js"));
        assert_eq!(tags, vec!["my-button", "ui-modal", "ui-picker"]);
    }

    #[test]
    fn test_valid_custom_element_rules() {
        assert!(is_valid_custom_element_name("my-button"));
        assert!(is_valid_custom_element_name("my-element-1"));
        assert!(!is_valid_custom_element_name("div"));
        assert!(!is_valid_custom_element_name("font-face")); // Reserved
        assert!(!is_valid_custom_element_name("MY-BUTTON")); // No uppercase
    }
}
