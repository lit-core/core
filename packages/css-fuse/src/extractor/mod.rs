pub mod css_tag_visitor;
pub mod import_resolver;

use crate::models::ExtractedStyle;
use css_tag_visitor::CssTagVisitor;
use import_resolver::resolve_relative_import;
use oxc_allocator::Allocator;
use oxc_ast::Visit;
use oxc_parser::Parser;
use oxc_span::SourceType;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

pub struct StyleExtractor;

impl StyleExtractor {
    pub fn extract_from_source(
        source_code: &str,
        file_path: &str,
    ) -> (Vec<ExtractedStyle>, Vec<String>) {
        let allocator = Allocator::default();
        let source_type = SourceType::from_path(Path::new(file_path)).unwrap_or_default();
        let parser = Parser::new(&allocator, source_code, source_type);
        let parsed = parser.parse();

        let mut visitor = CssTagVisitor::new(source_code, file_path);
        visitor.visit_program(&parsed.program);

        let related_imports = visitor
            .imported_styles_identifiers
            .values()
            .cloned()
            .collect::<Vec<_>>();

        (visitor.extracted_styles, related_imports)
    }

    pub fn extract_from_files(file_paths: &[String]) -> Vec<ExtractedStyle> {
        let mut all_styles = Vec::new();
        let mut visited_files: HashSet<String> = HashSet::new();
        let mut files_to_scan: Vec<String> = file_paths.to_vec();

        while let Some(path) = files_to_scan.pop() {
            if visited_files.contains(&path) {
                continue;
            }
            visited_files.insert(path.clone());

            let Ok(source_code) = fs::read_to_string(&path) else {
                continue;
            };

            let (styles, imported_paths) = Self::extract_from_source(&source_code, &path);
            all_styles.extend(styles);

            for imp in imported_paths {
                if let Some(resolved) = resolve_relative_import(&path, &imp) {
                    let resolved_str = resolved.to_string_lossy().to_string();
                    if !visited_files.contains(&resolved_str) {
                        files_to_scan.push(resolved_str);
                    }
                }
            }
        }

        all_styles
    }
}
