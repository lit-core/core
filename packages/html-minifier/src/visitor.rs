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

pub fn is_lit_html_source(src: &str) -> bool {
    src == "lit"
        || src.starts_with("lit/")
        || src == "lit-html"
        || src.starts_with("lit-html/")
        || src == "lit-element"
        || src.starts_with("lit-element/")
        || src.starts_with("@lit/")
}

#[derive(Debug, Default)]
pub struct HtmlImportContext {
    pub html_svg_tags: HashSet<String>,
    pub html_svg_namespaces: HashSet<String>,
    pub has_imports: bool,
}

pub fn scan_html_svg_imports<'a>(program: &Program<'a>) -> HtmlImportContext {
    let mut ctx = HtmlImportContext::default();

    for stmt in &program.body {
        if let Statement::ImportDeclaration(import_decl) = stmt {
            ctx.has_imports = true;
            let src = import_decl.source.value.as_str();
            if !is_lit_html_source(src) {
                continue;
            }

            if let Some(specifiers) = &import_decl.specifiers {
                for spec in specifiers {
                    match spec {
                        ImportDeclarationSpecifier::ImportSpecifier(named_spec) => {
                            let imported_name = named_spec.imported.name();
                            let imp = imported_name.as_str();
                            if imp == "html" || imp == "svg" || imp == "litHtml" || imp == "litSvg"
                            {
                                ctx.html_svg_tags
                                    .insert(named_spec.local.name.as_str().to_string());
                            }
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                            ctx.html_svg_namespaces
                                .insert(ns.local.name.as_str().to_string());
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    if !ctx.has_imports {
        ctx.html_svg_tags.insert("html".to_string());
        ctx.html_svg_tags.insert("svg".to_string());
        ctx.html_svg_tags.insert("litHtml".to_string());
        ctx.html_svg_tags.insert("litSvg".to_string());
    }

    ctx
}

struct HtmlMinifierTraverser<'a> {
    allocator: &'a Allocator,
    import_ctx: HtmlImportContext,
    templates_count: u32,
    bytes_saved: u32,
}

impl<'a> HtmlMinifierTraverser<'a> {
    fn is_target_tag(&self, expr: &Expression<'a>) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                self.import_ctx.html_svg_tags.contains(ident.name.as_str())
            }
            Expression::StaticMemberExpression(member) => {
                if let Expression::Identifier(obj) = &member.object {
                    if self
                        .import_ctx
                        .html_svg_namespaces
                        .contains(obj.name.as_str())
                    {
                        let prop = member.property.name.as_str();
                        return prop == "html"
                            || prop == "svg"
                            || prop == "litHtml"
                            || prop == "litSvg";
                    }
                }
                false
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

    let import_ctx = scan_html_svg_imports(&parsed.program);

    let semantic_ret = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic_ret.semantic.into_scoping();

    let mut traverser = HtmlMinifierTraverser {
        allocator: &allocator,
        import_ctx,
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

    let codegen_result = Codegen::new()
        .with_options(codegen_options)
        .build(&parsed.program);

    CollapseResult {
        code: codegen_result.code,
        map: codegen_result.map.map(|m| m.to_json_string()),
        templates_count: traverser.templates_count,
        bytes_saved: traverser.bytes_saved,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_lit_html_source_canonical() {
        assert!(is_lit_html_source("lit"));
        assert!(is_lit_html_source("lit/html.js"));
        assert!(is_lit_html_source("lit-html"));
        assert!(is_lit_html_source("lit-html/lit-html.js"));
        assert!(is_lit_html_source("lit-element"));
        assert!(is_lit_html_source("lit-element/lit-element.js"));
        assert!(is_lit_html_source("@lit/reactive-element"));
        assert!(!is_lit_html_source("@other/web-components"));
        assert!(!is_lit_html_source("react"));
        assert!(!is_lit_html_source("vue"));
    }

    #[test]
    fn test_collapse_code_scoped_lit() {
        let code = r#"
            import { html as h } from '@lit/reactive-element';
            export const tpl = h`
                <div>
                    <!-- comment -->
                    <span>hello</span>
                </div>
            `;
        "#;
        let res = collapse_code(code, CollapseOptions::default());
        assert_eq!(res.templates_count, 1);
        assert!(res.code.contains("<div><span>hello</span></div>"));
    }
}
