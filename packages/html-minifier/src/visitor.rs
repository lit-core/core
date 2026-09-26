use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast::Visit;
use oxc_parser::Parser;
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

use std::collections::HashSet;

pub struct TemplateVisitor {
    pub html_svg_tags: HashSet<String>,
    pub replacements: Vec<(usize, usize, String)>,
    pub templates_count: u32,
    pub bytes_saved: u32,
}

impl Default for TemplateVisitor {
    fn default() -> Self {
        Self::new()
    }
}

impl TemplateVisitor {
    pub fn new() -> Self {
        let mut html_svg_tags = HashSet::new();
        html_svg_tags.insert("html".to_string());
        html_svg_tags.insert("svg".to_string());
        html_svg_tags.insert("litHtml".to_string());
        html_svg_tags.insert("litSvg".to_string());
        Self {
            html_svg_tags,
            replacements: Vec::new(),
            templates_count: 0,
            bytes_saved: 0,
        }
    }

    pub fn scan_imports<'a>(&mut self, program: &Program<'a>) {
        for stmt in &program.body {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                if let Some(specifiers) = &import_decl.specifiers {
                    for spec in specifiers {
                        if let ImportDeclarationSpecifier::ImportSpecifier(named_spec) = spec {
                            let imported_name = named_spec.imported.name();
                            if imported_name == "html" || imported_name == "svg" {
                                self.html_svg_tags
                                    .insert(named_spec.local.name.as_str().to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    pub fn is_target_tag(&self, tag: &Expression) -> bool {
        match tag {
            Expression::Identifier(ident) => self.html_svg_tags.contains(ident.name.as_str()),
            Expression::StaticMemberExpression(member) => {
                self.html_svg_tags.contains(member.property.name.as_str())
            }
            _ => false,
        }
    }
}

impl<'a> Visit<'a> for TemplateVisitor {
    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if self.is_target_tag(&tagged.tag) && !tagged.quasi.quasis.is_empty() {
            let raw_quasis: Vec<&str> = tagged
                .quasi
                .quasis
                .iter()
                .map(|q| q.value.raw.as_str())
                .collect();

            let collapsed_quasis = collapse_template_quasis(&raw_quasis);
            let mut modified = false;

            for (quasi, new_raw) in tagged.quasi.quasis.iter().zip(collapsed_quasis) {
                let old_raw = quasi.value.raw.as_str();
                if old_raw != new_raw {
                    let old_len = (quasi.span.end - quasi.span.start) as usize;
                    if old_len >= new_raw.len() {
                        self.bytes_saved += (old_len - new_raw.len()) as u32;
                    }
                    self.replacements.push((
                        quasi.span.start as usize,
                        quasi.span.end as usize,
                        new_raw,
                    ));
                    modified = true;
                }
            }

            if modified {
                self.templates_count += 1;
            }
        }

        // Traverse inner template expressions (e.g. nested html`...` inside ${...})
        self.visit_expression(&tagged.tag);
        for expr in &tagged.quasi.expressions {
            self.visit_expression(expr);
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
    let parsed = parser.parse();
    if !parsed.errors.is_empty() && parsed.program.body.is_empty() {
        return CollapseResult {
            code: source.to_string(),
            map: None,
            templates_count: 0,
            bytes_saved: 0,
        };
    }

    let mut visitor = TemplateVisitor::new();
    visitor.scan_imports(&parsed.program);
    visitor.visit_program(&parsed.program);

    if visitor.replacements.is_empty() {
        return CollapseResult {
            code: source.to_string(),
            map: None,
            templates_count: 0,
            bytes_saved: 0,
        };
    }

    // Sort replacements descending by start offset to preserve indices
    visitor.replacements.sort_by_key(|b| std::cmp::Reverse(b.0));

    let mut transformed_code = source.to_string();
    for (start, end, replacement) in visitor.replacements {
        if start <= end && end <= transformed_code.len() {
            transformed_code.replace_range(start..end, &replacement);
        }
    }

    CollapseResult {
        code: transformed_code,
        map: None,
        templates_count: visitor.templates_count,
        bytes_saved: visitor.bytes_saved,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_span_check() {
        let source = "const t = html`<div>${x}</div>`;";
        let allocator = Allocator::default();
        let parser = Parser::new(&allocator, source, SourceType::default());
        let parsed = parser.parse();
        for stmt in &parsed.program.body {
            if let Statement::VariableDeclaration(var_decl) = stmt {
                for decl in &var_decl.declarations {
                    if let Some(Expression::TaggedTemplateExpression(tagged)) = &decl.init {
                        for (idx, q) in tagged.quasi.quasis.iter().enumerate() {
                            let slice = &source[q.span.start as usize..q.span.end as usize];
                            println!("QUASI {} SPAN: {:?} SLICE: {:?}", idx, q.span, slice);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn test_collapse_code_basic() {
        let source = r#"
      import { html } from 'lit';
      export const tpl = html`
        <div class="test">
          <!-- remove this -->
          <span>Hello World</span>
        </div>
      `;
    "#;

        let res = collapse_code(source, CollapseOptions::default());
        assert!(res.templates_count >= 1);
        assert!(!res.code.contains("remove this"));
        assert!(res
            .code
            .contains("<div class=\"test\"><span>Hello World</span></div>"));
        assert!(res.bytes_saved > 0);
    }

    #[test]
    fn test_collapse_nested_templates() {
        let source = r#"
      import { html } from 'lit';
      const t = html`
        <div>
          ${items.map(i => html`
            <span>${i}</span>
          `)}
        </div>
      `;
    "#;

        let res = collapse_code(source, CollapseOptions::default());
        assert!(res.templates_count >= 2);
        assert!(res.code.contains("<span>${i}</span>"));
    }

    #[test]
    fn test_collapse_svg_template() {
        let source = r#"
      import { svg } from 'lit';
      const icon = svg`
        <svg viewBox="0 0 10 10">
          <circle cx="5" cy="5" r="5" />
        </svg>
      `;
    "#;

        let res = collapse_code(source, CollapseOptions::default());
        assert!(res.templates_count >= 1);
        assert!(res
            .code
            .contains("<svg viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"5\"/></svg>"));
    }

    #[test]
    fn test_collapse_aliased_import() {
        let source = r#"
      import { html as u } from '@spectrum-web-components/base';
      const t = u`
        <div>
          <span>Aliased Tag</span>
        </div>
      `;
    "#;

        let res = collapse_code(source, CollapseOptions::default());
        assert!(res.templates_count >= 1);
        assert!(res.code.contains("<div><span>Aliased Tag</span></div>"));
    }
}
