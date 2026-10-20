use lightningcss::printer::PrinterOptions;
use lightningcss::stylesheet::{MinifyOptions, ParserOptions, StyleSheet};
use lit_analysis::symbol::SymbolProofContext;
use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk_mut::*, VisitMut};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

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

/// Returns true when every expression of the template sits between complete CSS rules or
/// statements. Each quasi before an expression must end outside any block, parenthesis, string
/// or comment, and its last significant character must be `}` or `;`.
fn quasis_end_at_rule_boundaries(quasis: &[TemplateElement<'_>]) -> bool {
    let Some((_, before_expressions)) = quasis.split_last() else {
        return true;
    };
    before_expressions.iter().all(|quasi| {
        let mut chars = quasi.value.raw.as_str().chars().peekable();
        let mut braces = 0i32;
        let mut parens = 0i32;
        let mut last_significant: Option<char> = None;
        while let Some(ch) = chars.next() {
            match ch {
                '\\' => {
                    chars.next();
                    last_significant = Some(ch);
                }
                '/' if chars.peek() == Some(&'*') => {
                    chars.next();
                    let mut closed = false;
                    while let Some(inner) = chars.next() {
                        if inner == '*' && chars.peek() == Some(&'/') {
                            chars.next();
                            closed = true;
                            break;
                        }
                    }
                    if !closed {
                        return false;
                    }
                }
                '"' | '\'' => {
                    let mut closed = false;
                    while let Some(inner) = chars.next() {
                        if inner == '\\' {
                            chars.next();
                        } else if inner == ch {
                            closed = true;
                            break;
                        }
                    }
                    if !closed {
                        return false;
                    }
                    last_significant = Some(ch);
                }
                '{' => {
                    braces += 1;
                    last_significant = Some(ch);
                }
                '}' => {
                    braces -= 1;
                    last_significant = Some(ch);
                }
                '(' => {
                    parens += 1;
                    last_significant = Some(ch);
                }
                ')' => {
                    parens -= 1;
                    last_significant = Some(ch);
                }
                c if c.is_whitespace() => {}
                c => last_significant = Some(c),
            }
        }
        braces == 0 && parens == 0 && matches!(last_significant, None | Some('}') | Some(';'))
    })
}

struct CssMinifierMutVisitor<'a> {
    allocator: &'a Allocator,
    symbol_ctx: &'a SymbolProofContext<'a>,
    minified_templates: u32,
    bytes_saved: u32,
}

impl<'a> VisitMut<'a> for CssMinifierMutVisitor<'a> {
    fn visit_tagged_template_expression(&mut self, node: &mut TaggedTemplateExpression<'a>) {
        if self.symbol_ctx.is_lit_css_tag(&node.tag) {
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
            } else if quasis_end_at_rule_boundaries(&node.quasi.quasis) {
                // Every expression sits between complete rules, so each quasi slice is a standalone
                // stylesheet and can be minified without touching the expressions.
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
        walk_tagged_template_expression(self, node);
    }

    fn visit_call_expression(&mut self, node: &mut CallExpression<'a>) {
        if self.symbol_ctx.is_lit_css_tag(&node.callee) {
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
                                if let Some(Expression::StringLiteral(lit)) =
                                    elem.as_expression_mut()
                                {
                                    let raw_css = lit.value.as_str();
                                    if let Some(minified) = minify_css_string(raw_css) {
                                        if minified.len() < raw_css.len() {
                                            self.bytes_saved +=
                                                (raw_css.len() - minified.len()) as u32;
                                            self.minified_templates += 1;
                                            lit.value =
                                                Str::from_str_in(&minified, &self.allocator);
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
        walk_call_expression(self, node);
    }
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

    let semantic_ret = SemanticBuilder::new().build(&program);
    let scoping = semantic_ret.semantic.into_scoping();

    let (lit_symbols, helper_symbols, imported_classes, local_classes, has_lit_imports) = {
        let temp_ctx = SymbolProofContext::scan(&program, &scoping, source);
        (
            temp_ctx.lit_symbols,
            temp_ctx.helper_symbols,
            temp_ctx.imported_classes,
            temp_ctx.local_classes,
            temp_ctx.has_lit_imports,
        )
    };

    let symbol_ctx = SymbolProofContext {
        scoping: &scoping,
        source_text: source,
        lit_symbols,
        helper_symbols,
        imported_classes,
        local_classes,
        has_lit_imports,
    };

    if !symbol_ctx.has_lit_imports() {
        return MinifyCssResult {
            code: source.to_string(),
            map: None,
            minified_templates: 0,
            bytes_saved: 0,
        };
    }

    let mut visitor = CssMinifierMutVisitor {
        allocator: &allocator,
        symbol_ctx: &symbol_ctx,
        minified_templates: 0,
        bytes_saved: 0,
    };

    visitor.visit_program(&mut program);

    if visitor.minified_templates == 0 {
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
        minified_templates: visitor.minified_templates,
        bytes_saved: visitor.bytes_saved,
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
        assert!(SymbolProofContext::is_canonical_lit_specifier("lit"));
        assert!(SymbolProofContext::is_canonical_lit_specifier(
            "lit/index.js"
        ));
        assert!(SymbolProofContext::is_canonical_lit_specifier(
            "lit-element"
        ));
        assert!(SymbolProofContext::is_canonical_lit_specifier(
            "lit-element/index.js"
        ));
        assert!(SymbolProofContext::is_canonical_lit_specifier("lit-html"));
        assert!(SymbolProofContext::is_canonical_lit_specifier(
            "lit-html/index.js"
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
    fn test_shadowed_css_variable_not_minified() {
        let input = r#"
      import { css } from 'lit';
      function render(css) {
        return css`
          :host {
            color: rgb(255, 0, 0);
          }
        `;
      }
    "#;

        let res = transform_embedded_css(input, MinifyCssOptions::default());
        assert_eq!(res.minified_templates, 0);
        assert!(res.code.contains("rgb(255, 0, 0)"));
    }

    #[test]
    fn test_unrelated_css_local_variable_not_minified() {
        let input = r#"
      const css = (strings) => strings[0];
      const res = css`
        :host {
          color: rgb(255, 0, 0);
        }
      `;
    "#;

        let res = transform_embedded_css(input, MinifyCssOptions::default());
        assert_eq!(res.minified_templates, 0);
        assert!(res.code.contains("rgb(255, 0, 0)"));
    }
}
