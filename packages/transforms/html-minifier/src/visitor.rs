use lit_analysis::symbol::SymbolProofContext;
use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{VisitMut, walk_mut::*};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

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

struct HtmlMinifierMutVisitor<'a> {
    allocator: &'a Allocator,
    symbol_ctx: &'a SymbolProofContext<'a>,
    templates_count: u32,
    bytes_saved: u32,
}

impl<'a> VisitMut<'a> for HtmlMinifierMutVisitor<'a> {
    fn visit_tagged_template_expression(&mut self, tagged: &mut TaggedTemplateExpression<'a>) {
        let is_target = self.symbol_ctx.is_lit_html_or_static_tag(&tagged.tag)
            || self.symbol_ctx.is_lit_svg_tag(&tagged.tag);

        if is_target && !tagged.quasi.quasis.is_empty() {
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

        walk_tagged_template_expression(self, tagged);
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

    let semantic_ret = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic_ret.semantic.into_scoping();
    let symbol_ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    if !symbol_ctx.has_lit_imports() {
        return CollapseResult {
            code: source.to_string(),
            map: None,
            templates_count: 0,
            bytes_saved: 0,
        };
    }

    let mut visitor = HtmlMinifierMutVisitor {
        allocator: &allocator,
        symbol_ctx: &symbol_ctx,
        templates_count: 0,
        bytes_saved: 0,
    };

    visitor.visit_program(&mut parsed.program);

    if visitor.templates_count == 0 {
        return CollapseResult {
            code: source.to_string(),
            map: None,
            templates_count: 0,
            bytes_saved: 0,
        };
    }

    let mut codegen_options = CodegenOptions::default();
    if options.sourcemap.unwrap_or(false)
        && let Some(ref filename) = options.filename
    {
        codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
    }

    let codegen_result = Codegen::new()
        .with_options(codegen_options)
        .build(&parsed.program);

    CollapseResult {
        code: codegen_result.code,
        map: codegen_result.map.map(|m| m.to_json_string()),
        templates_count: visitor.templates_count,
        bytes_saved: visitor.bytes_saved,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_lit_html_source_canonical() {
        assert!(SymbolProofContext::is_canonical_lit_specifier("lit"));
        assert!(SymbolProofContext::is_canonical_lit_specifier(
            "lit/html.js"
        ));
        assert!(SymbolProofContext::is_canonical_lit_specifier("lit-html"));
        assert!(SymbolProofContext::is_canonical_lit_specifier(
            "lit-html/lit-html.js"
        ));
        assert!(SymbolProofContext::is_canonical_lit_specifier(
            "lit-element"
        ));
        assert!(SymbolProofContext::is_canonical_lit_specifier(
            "lit-element/lit-element.js"
        ));
        assert!(SymbolProofContext::is_canonical_lit_specifier(
            "@lit/reactive-element"
        ));
        assert!(!SymbolProofContext::is_canonical_lit_specifier(
            "@other/web-components"
        ));
        assert!(!SymbolProofContext::is_canonical_lit_specifier("react"));
        assert!(!SymbolProofContext::is_canonical_lit_specifier("vue"));
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

    #[test]
    fn test_shadowed_html_parameter_not_collapsed() {
        let code = r#"
            import { html } from 'lit';
            function render(html) {
                return html`
                    <div>
                        <!-- comment -->
                        <span>hello</span>
                    </div>
                `;
            }
        "#;
        let res = collapse_code(code, CollapseOptions::default());
        assert_eq!(res.templates_count, 0);
        assert!(res.code.contains("<!-- comment -->"));
    }

    #[test]
    fn test_unrelated_html_local_variable_not_collapsed() {
        let code = r#"
            const html = (strings) => strings[0];
            export const tpl = html`
                <div>
                    <!-- comment -->
                    <span>hello</span>
                </div>
            `;
        "#;
        let res = collapse_code(code, CollapseOptions::default());
        assert_eq!(res.templates_count, 0);
        assert!(res.code.contains("<!-- comment -->"));
    }
}
