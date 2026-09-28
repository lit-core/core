use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use oxc_traverse::{traverse_mut, Traverse, TraverseCtx};
use std::collections::HashSet;

use crate::collapser::collapse_template_quasis;

#[napi(object)]
#[derive(Default, Clone, Debug)]
pub struct CollapseOptions {
    pub filename: Option<String>,
    pub sourcemap: Option<bool>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct CollapseResult {
    pub code: String,
    pub map: Option<String>,
    pub templates_count: u32,
    pub bytes_saved: u32,
}

pub fn scan_html_svg_imports<'a>(program: &Program<'a>) -> HashSet<String> {
    let mut tags = HashSet::new();
    tags.insert("html".to_string());
    tags.insert("svg".to_string());
    tags.insert("litHtml".to_string());
    tags.insert("litSvg".to_string());

    for stmt in &program.body {
        if let Statement::ImportDeclaration(import_decl) = stmt {
            if let Some(specifiers) = &import_decl.specifiers {
                for spec in specifiers {
                    if let ImportDeclarationSpecifier::ImportSpecifier(named_spec) = spec {
                        let imported_name = named_spec.imported.name();
                        if imported_name == "html" || imported_name == "svg" {
                            tags.insert(named_spec.local.name.as_str().to_string());
                        }
                    }
                }
            }
        }
    }
    tags
}

struct HtmlMinifierTraverser<'a> {
    allocator: &'a Allocator,
    html_svg_tags: HashSet<String>,
    templates_count: u32,
    bytes_saved: u32,
}

impl<'a> HtmlMinifierTraverser<'a> {
    fn is_target_tag(&self, expr: &Expression<'a>) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                ident.name == "html" || ident.name == "svg" || self.html_svg_tags.contains(ident.name.as_str())
            }
            Expression::StaticMemberExpression(member) => {
                member.property.name == "html"
                    || member.property.name == "svg"
                    || self.html_svg_tags.contains(member.property.name.as_str())
            }
            _ => false,
        }
    }
}

impl<'a> Traverse<'a, ()> for HtmlMinifierTraverser<'a> {
    fn enter_tagged_template_expression(
        &mut self,
        tagged: &mut TaggedTemplateExpression<'a>,
        _ctx: &mut TraverseCtx<'a, ()>,
    ) {
        if !self.is_target_tag(&tagged.tag) || tagged.quasi.quasis.is_empty() {
            return;
        }

        let raw_quasis: Vec<&str> = tagged
            .quasi
            .quasis
            .iter()
            .map(|q| q.value.raw.as_str())
            .collect();

        let collapsed_quasis = collapse_template_quasis(&raw_quasis);
        let mut modified = false;

        for (quasi, new_raw) in tagged.quasi.quasis.iter_mut().zip(collapsed_quasis) {
            let old_raw = quasi.value.raw.as_str();
            if old_raw != new_raw {
                let old_len = old_raw.len();
                if old_len >= new_raw.len() {
                    self.bytes_saved += (old_len - new_raw.len()) as u32;
                }
                let str_arena = Str::from_str_in(&new_raw, &self.allocator);
                quasi.value.raw = str_arena;
                quasi.value.cooked = Some(str_arena);
                modified = true;
            }
        }

        if modified {
            self.templates_count += 1;
        }
    }
}

pub fn collapse_code(source: &str, options: CollapseOptions) -> CollapseResult {
    // Fast pre-check: if neither "html" nor "svg" exists in source, skip parser entirely
    if !source.contains("html") && !source.contains("svg") {
        return CollapseResult {
            code: source.to_string(),
            map: None,
            templates_count: 0,
            bytes_saved: 0,
        };
    }

    let allocator = Allocator::default();
    let filename = options.filename.as_deref().unwrap_or("file.ts");
    let is_ts = filename.ends_with(".ts")
        || filename.ends_with(".tsx")
        || filename.ends_with(".mts")
        || filename.ends_with(".cts");
    let source_type = SourceType::from_path(std::path::Path::new(filename))
        .unwrap_or_default()
        .with_module(true)
        .with_typescript(is_ts);

    let parser = Parser::new(&allocator, source, source_type);
    let mut parsed = parser.parse();
    if !parsed.diagnostics.is_empty() && parsed.program.body.is_empty() {
        return CollapseResult {
            code: source.to_string(),
            map: None,
            templates_count: 0,
            bytes_saved: 0,
        };
    }

    let html_svg_tags = scan_html_svg_imports(&parsed.program);

    let semantic_ret = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic_ret.semantic.into_scoping();

    let mut traverser = HtmlMinifierTraverser {
        allocator: &allocator,
        html_svg_tags,
        templates_count: 0,
        bytes_saved: 0,
    };

    traverse_mut(&mut traverser, &allocator, &mut parsed.program, scoping, ());

    if traverser.templates_count == 0 {
        return CollapseResult {
            code: source.to_string(),
            map: None,
            templates_count: 0,
            bytes_saved: 0,
        };
    }

    let mut codegen_options = CodegenOptions::default();
    if options.sourcemap.unwrap_or(false) {
        if let Some(ref filename) = options.filename {
            codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
        }
    }

    let codegen_result = Codegen::new().with_options(codegen_options).build(&parsed.program);

    CollapseResult {
        code: codegen_result.code,
        map: codegen_result.map.map(|m| m.to_json_string()),
        templates_count: traverser.templates_count,
        bytes_saved: traverser.bytes_saved,
    }
}
