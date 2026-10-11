use lightningcss::printer::PrinterOptions;
use lightningcss::stylesheet::{MinifyOptions, ParserOptions, StyleSheet};
use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use oxc_traverse::{traverse_mut, Traverse, TraverseCtx};
use std::collections::HashSet;

#[napi(object)]
#[derive(Default, Clone, Debug)]
pub struct MinifyCssOptions {
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct MinifyCssResult {
    pub code: String,
    pub map: Option<String>,
    pub minified_templates: u32,
    pub bytes_saved: u32,
}

pub fn minify_css_string(css: &str) -> Option<String> {
    let parse_opts = ParserOptions::default();
    let mut stylesheet = StyleSheet::parse(css, parse_opts).ok()?;
    let _ = stylesheet.minify(MinifyOptions::default());
    let printer_opts = PrinterOptions {
        minify: true,
        ..Default::default()
    };
    let res = stylesheet.to_css(printer_opts).ok()?;
    Some(res.code)
}

struct CssMinifierTraverser<'a> {
    allocator: &'a Allocator,
    import_ctx: CssImportContext,
    minified_templates: u32,
    bytes_saved: u32,
}

impl<'a> CssMinifierTraverser<'a> {
    fn is_css_tag(&self, expr: &Expression) -> bool {
        match expr {
            Expression::Identifier(ident) => self.import_ctx.css_tags.contains(ident.name.as_str()),
            Expression::StaticMemberExpression(member) => {
                if let Expression::Identifier(obj) = &member.object {
                    if self.import_ctx.css_namespaces.contains(obj.name.as_str()) {
                        return member.property.name.as_str() == "css";
                    }
                }
                false
            }
            _ => false,
        }
    }
}

impl<'a> Traverse<'a, ()> for CssMinifierTraverser<'a> {
    fn enter_tagged_template_expression(
        &mut self,
        node: &mut TaggedTemplateExpression<'a>,
        _ctx: &mut TraverseCtx<'a, ()>,
    ) {
        if !self.is_css_tag(&node.tag) {
            return;
        }

        if node.quasi.expressions.is_empty() {
            // Common case: template literal with no expressions (pure CSS)
            if let Some(quasi) = node.quasi.quasis.first_mut() {
                let raw_css = quasi.value.raw.as_str();
                if let Some(minified) = minify_css_string(raw_css) {
                    if minified.len() < raw_css.len() {
                        self.bytes_saved += (raw_css.len() - minified.len()) as u32;
                        self.minified_templates += 1;
                        let str_arena = Str::from_str_in(&minified, &self.allocator);
                        quasi.value.raw = str_arena;
                        quasi.value.cooked = Some(str_arena);
                    }
                }
            }
        } else {
            // Template literal with interpolations:
            // Try to minify individual quasi slices if they form valid CSS blocks
            for quasi in node.quasi.quasis.iter_mut() {
                let raw_css = quasi.value.raw.as_str();
                if let Some(minified) = minify_css_string(raw_css) {
                    if minified.len() < raw_css.len() {
                        self.bytes_saved += (raw_css.len() - minified.len()) as u32;
                        self.minified_templates += 1;
                        let str_arena = Str::from_str_in(&minified, &self.allocator);
                        quasi.value.raw = str_arena;
                        quasi.value.cooked = Some(str_arena);
                    }
                }
            }
        }
    }

    fn enter_call_expression(
        &mut self,
        node: &mut CallExpression<'a>,
        _ctx: &mut TraverseCtx<'a, ()>,
    ) {
        if !self.is_css_tag(&node.callee) {
            return;
        }

        for arg in node.arguments.iter_mut() {
            if let Some(expr) = arg.as_expression_mut() {
                match expr {
                    Expression::StringLiteral(lit) => {
                        let raw_css = lit.value.as_str();
                        if let Some(minified) = minify_css_string(raw_css) {
                            if minified.len() < raw_css.len() {
                                self.bytes_saved += (raw_css.len() - minified.len()) as u32;
                                self.minified_templates += 1;
                                lit.value = Str::from_str_in(&minified, &self.allocator);
                            }
                        }
                    }
                    Expression::ArrayExpression(arr) => {
                        for elem in arr.elements.iter_mut() {
                            if let Some(Expression::StringLiteral(lit)) = elem.as_expression_mut() {
                                let raw_css = lit.value.as_str();
                                if let Some(minified) = minify_css_string(raw_css) {
                                    if minified.len() < raw_css.len() {
                                        self.bytes_saved += (raw_css.len() - minified.len()) as u32;
                                        self.minified_templates += 1;
                                        lit.value = Str::from_str_in(&minified, &self.allocator);
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

pub fn is_lit_css_source(src: &str) -> bool {
    src == "lit"
        || src.starts_with("lit/")
        || src == "lit-element"
        || src.starts_with("lit-element/")
        || src == "lit-html"
        || src.starts_with("lit-html/")
        || src.starts_with("@lit/")
}

#[derive(Debug, Default)]
pub struct CssImportContext {
    pub css_tags: HashSet<String>,
    pub css_namespaces: HashSet<String>,
    pub has_imports: bool,
}

pub fn scan_css_imports(program: &Program) -> CssImportContext {
    let mut ctx = CssImportContext::default();

    for stmt in &program.body {
        if let Statement::ImportDeclaration(import_decl) = stmt {
            ctx.has_imports = true;
            let src = import_decl.source.value.as_str();
            if !is_lit_css_source(src) {
                continue;
            }

            if let Some(specifiers) = &import_decl.specifiers {
                for spec in specifiers {
                    match spec {
                        ImportDeclarationSpecifier::ImportSpecifier(named) => {
                            if named.imported.name().as_str() == "css" {
                                ctx.css_tags.insert(named.local.name.as_str().to_string());
                            }
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                            ctx.css_namespaces
                                .insert(ns.local.name.as_str().to_string());
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    if !ctx.has_imports {
        ctx.css_tags.insert("css".to_string());
    }

    ctx
}

pub fn transform_embedded_css(source: &str, options: MinifyCssOptions) -> MinifyCssResult {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(options.filename.as_deref().unwrap_or("file.ts"))
        .unwrap_or_else(|_| SourceType::ts());

    let parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return MinifyCssResult {
            code: source.to_string(),
            map: None,
            minified_templates: 0,
            bytes_saved: 0,
        };
    }

    let mut program = parsed.program;
    let import_ctx = scan_css_imports(&program);

    let semantic_ret = SemanticBuilder::new().build(&program);
    let scoping = semantic_ret.semantic.into_scoping();

    let mut traverser = CssMinifierTraverser {
        allocator: &allocator,
        import_ctx,
        minified_templates: 0,
        bytes_saved: 0,
    };

    traverse_mut(&mut traverser, &allocator, &mut program, scoping, ());

    if traverser.minified_templates == 0 {
        return MinifyCssResult {
            code: source.to_string(),
            map: None,
            minified_templates: 0,
            bytes_saved: 0,
        };
    }

    let mut codegen_options = CodegenOptions::default();
    if options.sourcemap.unwrap_or(false) {
        if let Some(ref filename) = options.filename {
            codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
        }
    }

    let codegen_result = Codegen::new().with_options(codegen_options).build(&program);

    let map_json = codegen_result.map.map(|m| m.to_json_string());

    MinifyCssResult {
        code: codegen_result.code,
        map: map_json,
        minified_templates: traverser.minified_templates,
        bytes_saved: traverser.bytes_saved,
    }
}

#[napi]
pub fn minify_embedded_css(source: String, options: Option<MinifyCssOptions>) -> MinifyCssResult {
    transform_embedded_css(&source, options.unwrap_or_default())
}

#[napi]
pub fn minify_template_css(source: String, options: Option<MinifyCssOptions>) -> MinifyCssResult {
    transform_embedded_css(&source, options.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_minifies_simple_css_template() {
        let input = r#"
      import { LitElement, css } from 'lit';
      export class MyButton extends LitElement {
        static styles = css`
          :host {
            display: block;
            color: rgb(255, 0, 0);
            margin: 0px 0px 0px 0px;
          }
        `;
      }
    "#;

        let res = transform_embedded_css(input, MinifyCssOptions::default());
        assert!(res.minified_templates > 0);
        assert!(res.bytes_saved > 0);
        assert!(res.code.contains(":host{"));
        assert!(res.code.contains("color:red") || res.code.contains("color:#f00"));
        assert!(res.code.contains("margin:0"));
    }

    #[test]
    fn test_calc_and_duplicates() {
        let input = r#"
      import { css } from 'lit';
      const styles = css`
        .box {
          width: calc(100px + 50px);
          padding: 10px;
          padding: 20px;
        }
      `;
    "#;

        let res = transform_embedded_css(input, MinifyCssOptions::default());
        assert!(res.minified_templates > 0);
        assert!(res.code.contains("150px"));
        // Duplicate padding should be merged
        assert!(!res.code.contains("10px"));
    }

    #[test]
    fn test_ignores_non_css_templates() {
        let input = r#"
      import { html } from 'lit';
      const template = html`
        <div class="test">
          <span>Hello</span>
        </div>
      `;
    "#;

        let res = transform_embedded_css(input, MinifyCssOptions::default());
        assert_eq!(res.minified_templates, 0);
        assert_eq!(res.bytes_saved, 0);
    }

    #[test]
    fn test_aliased_import_css() {
        let input = r#"
      import { css as customCss } from 'lit';
      const styles = customCss`
        :host {
          color: rgba(0, 0, 0, 1);
        }
      `;
    "#;

        let res = transform_embedded_css(input, MinifyCssOptions::default());
        assert!(res.minified_templates > 0);
        assert!(res.code.contains(":host{color:#000}"));
    }

    #[test]
    fn test_member_expression_css() {
        let input = r#"
      import * as lit from 'lit';
      const styles = lit.css`
        :host {
          display: flex;
        }
      `;
    "#;

        let res = transform_embedded_css(input, MinifyCssOptions::default());
        assert!(res.minified_templates > 0);
        assert!(res.code.contains(":host{display:flex}"));
    }

    #[test]
    fn test_template_with_interpolation() {
        let input = r#"
      import { css } from 'lit';
      const styles = css`
        :host {
          display: flex;
        }
        ${superStyles}
        .item {
          color: rgb(0, 0, 0);
        }
      `;
    "#;

        let res = transform_embedded_css(input, MinifyCssOptions::default());
        assert!(res.minified_templates > 0);
        assert!(res.code.contains(":host{display:flex}"));
        assert!(res.code.contains(".item{color:#000}"));
    }

    #[test]
    fn test_malformed_css_does_not_crash() {
        let input = r#"
      import { css } from 'lit';
      const styles = css`
        ::: invalid !!! syntax {{{
      `;
    "#;

        let res = transform_embedded_css(input, MinifyCssOptions::default());
        // Should gracefully not crash and keep original
        assert_eq!(res.minified_templates, 0);
    }

    #[test]
    fn test_sourcemap_generation() {
        let input = r#"
      import { css } from 'lit';
      const s = css`:host { color: rgb(255, 0, 0); }`;
    "#;

        let res = transform_embedded_css(
            input,
            MinifyCssOptions {
                sourcemap: Some(true),
                filename: Some("test.ts".to_string()),
            },
        );
        assert!(res.minified_templates > 0);
        assert!(res.map.is_some());
    }

    #[test]
    fn test_scoped_lit_library_alias_css() {
        let input = r#"
      import { css as o } from '@lit/reactive-element';
      const styles = o`
        :host {
          color: rgb(0, 128, 255);
        }
      `;
    "#;

        let res = transform_embedded_css(input, MinifyCssOptions::default());
        assert!(res.minified_templates > 0);
        assert!(res.bytes_saved > 0);
        assert!(res.code.contains(":host{color:#0080ff}"));
    }

    #[test]
    fn test_call_expression_css() {
        let input = r#"
      import { css } from 'lit';
      const styles = css([
        ":host { color: rgb(255, 0, 0); margin: 0px; }",
        ".header { padding: 10px 10px; }"
      ]);
    "#;

        let res = transform_embedded_css(input, MinifyCssOptions::default());
        assert!(res.minified_templates > 0);
        assert!(res.bytes_saved > 0);
        assert!(
            res.code.contains(":host{color:red;margin:0}")
                || res.code.contains(":host{color:#f00;margin:0}")
        );
        assert!(res.code.contains(".header{padding:10px}"));
    }

    #[test]
    fn test_is_lit_css_source_canonical() {
        assert!(is_lit_css_source("lit"));
        assert!(is_lit_css_source("lit/index.js"));
        assert!(is_lit_css_source("lit-element"));
        assert!(is_lit_css_source("lit-element/index.js"));
        assert!(is_lit_css_source("lit-html"));
        assert!(is_lit_css_source("lit-html/index.js"));
        assert!(is_lit_css_source("@lit/reactive-element"));
        assert!(!is_lit_css_source("@other/web-components"));
        assert!(!is_lit_css_source("react"));
        assert!(!is_lit_css_source("vue"));
    }
}
