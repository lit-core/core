use crate::extractor::import_resolver::ImportResolver;
use crate::models::{ExtractedFragment, SourceSpan};
use crate::normalizer::normalize_fragment;
use oxc_ast::ast::{Expression, Program, Statement, TaggedTemplateExpression};
use oxc_ast_visit::Visit;
use oxc_span::Span;

pub struct TemplateVisitor<'a> {
    pub source_code: &'a str,
    pub file_path: &'a str,
    pub min_fragment_length: usize,
    pub resolver: ImportResolver,
    pub extracted_fragments: Vec<ExtractedFragment>,
    pub templates_scanned: u32,
}

impl<'a> TemplateVisitor<'a> {
    pub fn new(source_code: &'a str, file_path: &'a str, min_fragment_length: usize) -> Self {
        Self {
            source_code,
            file_path,
            min_fragment_length,
            resolver: ImportResolver::new(),
            extracted_fragments: Vec::new(),
            templates_scanned: 0,
        }
    }

    pub fn scan_imports(&mut self, program: &Program) {
        for stmt in &program.body {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                self.resolver.process_import(import_decl);
            }
        }
    }

    fn compute_span(&self, span: Span) -> SourceSpan {
        let start = span.start as usize;
        let end = span.end as usize;

        let mut line = 1;
        let mut column = 1;

        for (idx, ch) in self.source_code.char_indices() {
            if idx >= start {
                break;
            }
            if ch == '\n' {
                line += 1;
                column = 1;
            } else {
                column += 1;
            }
        }

        SourceSpan {
            start,
            end,
            line,
            column,
        }
    }

    fn get_target_tag(&self, expr: &Expression) -> Option<(String, bool)> {
        match expr {
            Expression::Identifier(ident) => {
                let name = ident.name.as_str();
                if self.resolver.is_target_tag(name) {
                    let is_svg = name == "svg" || name == "litSvg";
                    Some((name.to_string(), is_svg))
                } else {
                    None
                }
            }
            Expression::StaticMemberExpression(member) => {
                let prop_name = member.property.name.as_str();
                if self.resolver.is_target_tag(prop_name) {
                    let is_svg = prop_name == "svg" || prop_name == "litSvg";
                    Some((prop_name.to_string(), is_svg))
                } else {
                    None
                }
            }
            _ => None,
        }
    }
}

impl<'a> Visit<'a> for TemplateVisitor<'a> {
    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if let Some((_tag_name, is_template_svg)) = self.get_target_tag(&tagged.tag) {
            self.templates_scanned += 1;

            // Target A: Full static template candidate
            if tagged.quasi.expressions.is_empty() && !tagged.quasi.quasis.is_empty() {
                let raw = tagged.quasi.quasis[0].value.raw.as_str();
                let trimmed = raw.trim();
                if trimmed.len() >= self.min_fragment_length {
                    let (canonical, hash) = normalize_fragment(trimmed);
                    let span = self.compute_span(tagged.span);
                    let is_svg = is_template_svg
                        || trimmed.starts_with("<svg")
                        || trimmed.starts_with("<path");

                    self.extracted_fragments.push(ExtractedFragment {
                        file_path: self.file_path.to_string(),
                        raw_text: trimmed.to_string(),
                        canonical_text: canonical,
                        is_svg,
                        is_full_template: true,
                        span,
                        hash,
                    });
                }
            }

            // Target B: Static DOM subtrees within each quasi
            for quasi in &tagged.quasi.quasis {
                let raw = quasi.value.raw.as_str();
                let subtrees = find_static_subtrees(raw, self.min_fragment_length);

                for (start_offset, end_offset, subtree_text, is_element_svg) in subtrees {
                    let (canonical, hash) = normalize_fragment(&subtree_text);
                    let abs_start = quasi.span.start as usize + start_offset;
                    let abs_end = quasi.span.start as usize + end_offset;

                    let span = SourceSpan {
                        start: abs_start,
                        end: abs_end,
                        line: 0,
                        column: 0,
                    };

                    let is_svg = is_template_svg || is_element_svg;

                    self.extracted_fragments.push(ExtractedFragment {
                        file_path: self.file_path.to_string(),
                        raw_text: subtree_text,
                        canonical_text: canonical,
                        is_svg,
                        is_full_template: false,
                        span,
                        hash,
                    });
                }
            }
        }

        // Visit children (nested templates)
        self.visit_expression(&tagged.tag);
        for expr in &tagged.quasi.expressions {
            self.visit_expression(expr);
        }
    }
}

/// Finds balanced static DOM element subtrees in a quasi text slice.
/// Returns (start_offset, end_offset, text, is_svg)
pub fn find_static_subtrees(raw: &str, min_length: usize) -> Vec<(usize, usize, String, bool)> {
    let mut results = Vec::new();
    let bytes = raw.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'<' {
            // Check for comment
            if i + 3 < len && &bytes[i..i + 4] == b"<!--" {
                if let Some(pos) = raw[i + 4..].find("-->") {
                    i += 4 + pos + 3;
                    continue;
                } else {
                    break;
                }
            }

            // Skip closing tags
            if i + 1 < len && bytes[i + 1] == b'/' {
                i += 2;
                while i < len && bytes[i] != b'>' {
                    i += 1;
                }
                if i < len {
                    i += 1;
                }
                continue;
            }

            // Parse opening tag name
            let tag_start = i + 1;
            let mut tag_end = tag_start;
            while tag_end < len
                && (bytes[tag_end].is_ascii_alphanumeric()
                    || bytes[tag_end] == b'-'
                    || bytes[tag_end] == b'_')
            {
                tag_end += 1;
            }

            if tag_end == tag_start {
                i += 1;
                continue;
            }

            let tag_name = &raw[tag_start..tag_end];
            let is_svg = matches!(
                tag_name.to_ascii_lowercase().as_str(),
                "svg"
                    | "path"
                    | "circle"
                    | "rect"
                    | "g"
                    | "polygon"
                    | "line"
                    | "ellipse"
                    | "polyline"
                    | "text"
                    | "use"
                    | "defs"
                    | "clippath"
                    | "mask"
                    | "symbol"
            );

            // Find end of opening tag '>'
            let mut open_tag_end = tag_end;
            let mut in_quote = None;
            let mut is_self_closing = false;

            while open_tag_end < len {
                let b = bytes[open_tag_end];
                if let Some(q) = in_quote {
                    if b == q && (open_tag_end == 0 || bytes[open_tag_end - 1] != b'\\') {
                        in_quote = None;
                    }
                } else if b == b'"' || b == b'\'' {
                    in_quote = Some(b);
                } else if b == b'/' && open_tag_end + 1 < len && bytes[open_tag_end + 1] == b'>' {
                    is_self_closing = true;
                    open_tag_end += 1;
                    break;
                } else if b == b'>' {
                    break;
                }
                open_tag_end += 1;
            }

            if open_tag_end >= len {
                break;
            }

            let elem_start = i;

            let is_void_tag = matches!(
                tag_name.to_ascii_lowercase().as_str(),
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
            );

            if is_self_closing || is_void_tag {
                let elem_end = open_tag_end + 1;
                let text = &raw[elem_start..elem_end];
                if text.len() >= min_length {
                    results.push((elem_start, elem_end, text.to_string(), is_svg));
                }
                i = elem_end;
                continue;
            }

            // Standard opening tag: find matching closing tag `</tag_name>`
            let mut depth = 1;
            let mut scan = open_tag_end + 1;
            let mut matched_end = None;

            while scan < len {
                if bytes[scan] == b'<' {
                    // Check for comment
                    if scan + 3 < len && &bytes[scan..scan + 4] == b"<!--" {
                        if let Some(pos) = raw[scan + 4..].find("-->") {
                            scan += 4 + pos + 3;
                            continue;
                        }
                    }

                    // Check for closing tag
                    if scan + 1 < len && bytes[scan + 1] == b'/' {
                        let c_tag_start = scan + 2;
                        let mut c_tag_end = c_tag_start;
                        while c_tag_end < len
                            && (bytes[c_tag_end].is_ascii_alphanumeric()
                                || bytes[c_tag_end] == b'-'
                                || bytes[c_tag_end] == b'_')
                        {
                            c_tag_end += 1;
                        }
                        let c_tag_name = &raw[c_tag_start..c_tag_end];
                        if c_tag_name.eq_ignore_ascii_case(tag_name) {
                            depth -= 1;
                            let mut close_end = c_tag_end;
                            while close_end < len && bytes[close_end] != b'>' {
                                close_end += 1;
                            }
                            if close_end < len {
                                close_end += 1;
                            }
                            if depth == 0 {
                                matched_end = Some(close_end);
                                break;
                            }
                            scan = close_end;
                            continue;
                        }
                    } else {
                        // Nested opening tag of same name
                        let n_start = scan + 1;
                        let mut n_end = n_start;
                        while n_end < len
                            && (bytes[n_end].is_ascii_alphanumeric()
                                || bytes[n_end] == b'-'
                                || bytes[n_end] == b'_')
                        {
                            n_end += 1;
                        }
                        let n_name = &raw[n_start..n_end];
                        if n_name.eq_ignore_ascii_case(tag_name) {
                            let mut check_pos = n_end;
                            let mut n_in_quote = None;
                            let mut n_self_closing = false;
                            while check_pos < len {
                                let b = bytes[check_pos];
                                if let Some(q) = n_in_quote {
                                    if b == q && (check_pos == 0 || bytes[check_pos - 1] != b'\\') {
                                        n_in_quote = None;
                                    }
                                } else if b == b'"' || b == b'\'' {
                                    n_in_quote = Some(b);
                                } else if b == b'/'
                                    && check_pos + 1 < len
                                    && bytes[check_pos + 1] == b'>'
                                {
                                    n_self_closing = true;
                                    break;
                                } else if b == b'>' {
                                    break;
                                }
                                check_pos += 1;
                            }
                            if !n_self_closing {
                                depth += 1;
                            }
                        }
                    }
                }
                scan += 1;
            }

            if let Some(elem_end) = matched_end {
                let text = &raw[elem_start..elem_end];
                if text.len() >= min_length {
                    results.push((elem_start, elem_end, text.to_string(), is_svg));
                }
            }
            i = open_tag_end + 1;
        } else {
            i += 1;
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_static_subtrees_svg() {
        let quasi = r#"
        <div class="test">
          <svg viewBox="0 0 16 16"><path d="M4 6" /></svg>
        </div>
        "#;
        let subtrees = find_static_subtrees(quasi, 20);
        // Extracts both the outer general HTML element and the inner SVG element
        assert_eq!(subtrees.len(), 2);
        assert!(!subtrees[0].3); // outer div is not svg
        assert!(subtrees[0].2.starts_with("<div class=\"test\">"));
        let svg_tuple = &subtrees[1];
        assert!(svg_tuple.3); // is_svg
        assert_eq!(
            svg_tuple.2,
            "<svg viewBox=\"0 0 16 16\"><path d=\"M4 6\" /></svg>"
        );
    }

    #[test]
    fn test_find_static_subtrees_slot() {
        let quasi = r#"<slot name="decorator" slot="decorator"></slot>"#;
        let subtrees = find_static_subtrees(quasi, 15);
        assert_eq!(subtrees.len(), 1);
        assert_eq!(
            subtrees[0].2,
            "<slot name=\"decorator\" slot=\"decorator\"></slot>"
        );
    }

    #[test]
    fn test_find_static_subtrees_generic_html() {
        let quasi = r#"<div class="card"><span class="label">User</span><button type="button">Click</button></div>"#;
        let subtrees = find_static_subtrees(quasi, 15);
        assert!(subtrees
            .iter()
            .any(|s| s.2.starts_with("<div class=\"card\">")));
        assert!(subtrees
            .iter()
            .any(|s| s.2 == "<span class=\"label\">User</span>"));
        assert!(subtrees
            .iter()
            .any(|s| s.2 == "<button type=\"button\">Click</button>"));
    }
}
