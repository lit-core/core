pub mod import_resolver;
pub mod template_visitor;

use crate::extractor::template_visitor::TemplateVisitor;
use crate::models::ExtractedFragment;
use oxc_allocator::Allocator;
use oxc_ast::Visit;
use oxc_parser::Parser;
use oxc_span::SourceType;
use std::fs;
use std::path::Path;

pub struct TemplateExtractor;

impl TemplateExtractor {
    pub fn extract_from_files(files: &[String], min_fragment_length: usize) -> (Vec<ExtractedFragment>, u32) {
        let mut all_fragments = Vec::new();
        let mut total_templates_scanned = 0;

        for file_path in files {
            let Ok(source) = fs::read_to_string(file_path) else {
                continue;
            };

            // Fast pre-check: skip if neither "html" nor "svg" exists
            if !source.contains("html") && !source.contains("svg") {
                continue;
            }

            let allocator = Allocator::default();
            let is_ts = file_path.ends_with(".ts")
                || file_path.ends_with(".tsx")
                || file_path.ends_with(".mts")
                || file_path.ends_with(".cts");

            let source_type = SourceType::from_path(Path::new(file_path))
                .unwrap_or_default()
                .with_module(true)
                .with_typescript(is_ts);

            let parser = Parser::new(&allocator, &source, source_type);
            let parsed = parser.parse();

            let mut visitor = TemplateVisitor::new(&source, file_path, min_fragment_length);
            visitor.scan_imports(&parsed.program);
            visitor.visit_program(&parsed.program);

            total_templates_scanned += visitor.templates_scanned;
            all_fragments.extend(visitor.extracted_fragments);
        }

        (all_fragments, total_templates_scanned)
    }
}
