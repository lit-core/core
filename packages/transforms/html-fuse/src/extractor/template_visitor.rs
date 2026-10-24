use crate::extractor::import_resolver::ImportResolver;
use crate::models::{ExtractedFragment, SourceSpan};
use crate::normalizer::normalize_fragment;
use oxc_ast::ast::{Expression, Program, Statement, TaggedTemplateExpression};
use oxc_ast_visit::Visit;
use oxc_semantic::Scoping;
use oxc_span::Span;

pub struct TemplateVisitor<'a> {
    pub source_code: &'a str,
    pub file_path: &'a str,
    pub min_fragment_length: usize,
    pub resolver: ImportResolver,
    pub scoping: &'a Scoping,
    pub extracted_fragments: Vec<ExtractedFragment>,
    pub templates_scanned: u32,
}

impl<'a> TemplateVisitor<'a> {
    pub fn new(
        source_code: &'a str,
        file_path: &'a str,
        min_fragment_length: usize,
        scoping: &'a Scoping,
    ) -> Self {
        Self {
            source_code,
            file_path,
            min_fragment_length,
            resolver: ImportResolver::new(),
            scoping,
            extracted_fragments: Vec::new(),
            templates_scanned: 0,
        }
    }

    pub fn scan_imports(&mut self, program: &Program) {
        for stmt in &program.body {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                self.resolver.process_import(import_decl, self.scoping);
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
                if let Some(ref_id) = ident.reference_id.get() {
                    let reference = self.scoping.get_reference(ref_id);
                    if let Some(sym_id) = reference.symbol_id()
                        && self.resolver.lit_html_symbols.contains(&sym_id)
                    {
                        let is_svg = self.resolver.lit_svg_symbols.contains(&sym_id);
                        return Some((ident.name.to_string(), is_svg));
                    }
                }
                None
            }
            Expression::StaticMemberExpression(member) => {
                let prop_name = member.property.name.as_str();
                if (prop_name == "html" || prop_name == "svg")
                    && let Expression::Identifier(obj) = &member.object
                    && let Some(ref_id) = obj.reference_id.get()
                {
                    let reference = self.scoping.get_reference(ref_id);
                    if let Some(sym_id) = reference.symbol_id()
                        && self.resolver.lit_namespaces.contains(&sym_id)
                    {
                        let is_svg = prop_name == "svg";
                        return Some((prop_name.to_string(), is_svg));
                    }
                }
                None
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
        }

        // Visit children (nested templates)

        self.visit_expression(&tagged.tag);
        for expr in &tagged.quasi.expressions {
            self.visit_expression(expr);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_full_static_template() {
        use oxc_allocator::Allocator;
        use oxc_parser::Parser;
        use oxc_span::SourceType;

        let source = r#"
            import { html, svg } from 'lit';
            const icon = svg`<svg viewBox="0 0 16 16"><path d="M4 6" /></svg>`;
            const tmpl = html`<div><span>Static block</span></div>`;
        "#;
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
        let semantic_ret = oxc_semantic::SemanticBuilder::new().build(&parsed.program);
        let scoping = semantic_ret.semantic.into_scoping();
        let mut visitor = TemplateVisitor::new(source, "test.ts", 10, &scoping);
        visitor.scan_imports(&parsed.program);
        visitor.visit_program(&parsed.program);

        assert_eq!(visitor.extracted_fragments.len(), 2);
        assert!(
            visitor
                .extracted_fragments
                .iter()
                .all(|f| f.is_full_template)
        );
        assert!(visitor.extracted_fragments[0].is_svg);
        assert!(!visitor.extracted_fragments[1].is_svg);
    }

    #[test]
    fn test_unrelated_import_not_targeted() {
        use oxc_allocator::Allocator;
        use oxc_parser::Parser;
        use oxc_span::SourceType;

        let source = r#"
            import { html } from 'hyperhtml';
            const tmpl = html`<div>hello</div>`;
        "#;
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
        let semantic_ret = oxc_semantic::SemanticBuilder::new().build(&parsed.program);
        let scoping = semantic_ret.semantic.into_scoping();
        let mut visitor = TemplateVisitor::new(source, "test.ts", 10, &scoping);
        visitor.scan_imports(&parsed.program);

        assert!(
            !visitor.resolver.is_target_tag("html"),
            "html from non-Lit library must not be considered a target tag"
        );
    }

    #[test]
    fn test_aliased_html_as_svg_classified_as_html() {
        use oxc_allocator::Allocator;
        use oxc_parser::Parser;
        use oxc_span::SourceType;

        let source = r#"
            import { html as svg } from 'lit';
            export const banner = svg`<div class="banner"><span>Title</span></div>`;
        "#;
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
        let semantic_ret = oxc_semantic::SemanticBuilder::new().build(&parsed.program);
        let scoping = semantic_ret.semantic.into_scoping();
        let mut visitor = TemplateVisitor::new(source, "test.ts", 10, &scoping);
        visitor.scan_imports(&parsed.program);
        visitor.visit_program(&parsed.program);

        assert_eq!(visitor.extracted_fragments.len(), 1);
        assert!(
            !visitor.extracted_fragments[0].is_svg,
            "aliased html as svg must not be classified as svg"
        );
    }
}
