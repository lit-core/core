use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde::{Deserialize, Serialize};

use crate::parser::{compute_template_parts, PartDescriptor};

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct DomPathsOptions {
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
    pub normalize_whitespace: Option<bool>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DomPathsResult {
    pub code: String,
    pub map: Option<String>,
    pub components_count: u32,
    pub paths_count: u32,
    pub paths: Vec<Vec<Vec<u32>>>,
}

fn is_lit_html_tag(tag: &Expression) -> bool {
    match tag {
        Expression::Identifier(ident) => ident.name == "html" || ident.name == "svg",
        Expression::StaticMemberExpression(mem) => {
            mem.property.name == "html" || mem.property.name == "svg"
        }
        _ => false,
    }
}

struct TemplateCollector {
    templates: Vec<(Vec<String>, bool)>, // (quasis, is_render)
    in_render: bool,
}

impl<'a> Visit<'a> for TemplateCollector {
    fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
        let is_render = match &method.key {
            PropertyKey::StaticIdentifier(ident) => ident.name == "render",
            _ => false,
        };

        let prev_in_render = self.in_render;
        if is_render {
            self.in_render = true;
        }

        oxc_ast_visit::walk::walk_method_definition(self, method);
        self.in_render = prev_in_render;
    }

    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if is_lit_html_tag(&tagged.tag) && !tagged.quasi.expressions.is_empty() {
            let quasis = tagged
                .quasi
                .quasis
                .iter()
                .map(|q| q.value.raw.to_string())
                .collect();
            self.templates.push((quasis, self.in_render));
        }
        oxc_ast_visit::walk::walk_tagged_template_expression(self, tagged);
    }
}

fn collect_classes<'a>(stmts: &'a [Statement<'a>], out: &mut Vec<&'a Class<'a>>) {
    for stmt in stmts {
        match stmt {
            Statement::ClassDeclaration(class) => {
                out.push(class);
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &export_decl.declaration {
                    out.push(class);
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &export_decl.declaration
                {
                    out.push(class);
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &var_decl.declarations {
                    if let Some(Expression::ClassExpression(class)) = &decl.init {
                        out.push(class);
                    }
                }
            }
            _ => {}
        }
    }
}

pub fn transform_code(source: &str, options: DomPathsOptions) -> DomPathsResult {
    if !source.contains("html") || !source.contains('`') {
        return DomPathsResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            paths_count: 0,
            paths: Vec::new(),
        };
    }

    let allocator = Allocator::default();
    let filename = options.filename.as_deref().unwrap_or("source.ts");
    let source_type = SourceType::from_path(filename).unwrap_or_default();
    let parsed = Parser::new(&allocator, source, source_type).parse();

    if parsed.program.body.is_empty() {
        return DomPathsResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            paths_count: 0,
            paths: Vec::new(),
        };
    }

    let mut classes = Vec::new();
    collect_classes(&parsed.program.body, &mut classes);

    if classes.is_empty() {
        return DomPathsResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            paths_count: 0,
            paths: Vec::new(),
        };
    }

    let normalize_whitespace = options.normalize_whitespace.unwrap_or(true);
    let mut all_component_paths = Vec::new();
    let mut total_paths_count = 0;
    let mut transformed_components = 0;
    let mut insertions: Vec<(usize, String)> = Vec::new();

    for class in classes {
        let body_span = class.body.span;
        let class_src = &source[body_span.start as usize..body_span.end as usize];

        // Skip if already has __litPartPaths
        if class_src.contains("__litPartPaths") {
            continue;
        }

        let mut collector = TemplateCollector {
            templates: Vec::new(),
            in_render: false,
        };

        for elem in &class.body.body {
            match elem {
                ClassElement::MethodDefinition(method) => {
                    collector.visit_method_definition(method);
                }
                ClassElement::PropertyDefinition(prop) => {
                    collector.visit_property_definition(prop);
                }
                ClassElement::AccessorProperty(acc) => {
                    collector.visit_accessor_property(acc);
                }
                _ => {}
            }
        }

        if collector.templates.is_empty() {
            continue;
        }

        // Pick primary template: render() first, or first template with expressions
        let selected = collector
            .templates
            .iter()
            .find(|(_, is_render)| *is_render)
            .or_else(|| collector.templates.first());

        if let Some((quasis, _)) = selected {
            let part_descriptors: Vec<PartDescriptor> =
                compute_template_parts(quasis, normalize_whitespace);

            if part_descriptors.is_empty() {
                continue;
            }

            let numeric_paths: Vec<Vec<u32>> =
                part_descriptors.iter().map(|p| p.path.clone()).collect();

            total_paths_count += numeric_paths.len() as u32;
            transformed_components += 1;
            all_component_paths.push(numeric_paths);

            // Build formatted static descriptor
            let mut descriptor = String::from("\n  static __litPartPaths = [\n");
            for (idx, part) in part_descriptors.iter().enumerate() {
                let path_str = part
                    .path
                    .iter()
                    .map(|n| n.to_string())
                    .collect::<Vec<_>>()
                    .join(", ");

                if part.is_attribute {
                    if let Some(ref tag) = part.target_tag {
                        descriptor.push_str(&format!(
                            "    [{}], // Part {} (attribute on {})\n",
                            path_str, idx, tag
                        ));
                    } else {
                        descriptor.push_str(&format!(
                            "    [{}], // Part {} (attribute)\n",
                            path_str, idx
                        ));
                    }
                } else {
                    descriptor.push_str(&format!("    [{}], // Part {}\n", path_str, idx));
                }
            }
            descriptor.push_str("  ];\n");

            // Insert right after the opening '{' of class body
            let insert_pos = (body_span.start as usize) + 1;
            insertions.push((insert_pos, descriptor));
        }
    }

    if insertions.is_empty() {
        return DomPathsResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            paths_count: 0,
            paths: Vec::new(),
        };
    }

    // Sort insertions in descending order of position
    insertions.sort_by_key(|b| std::cmp::Reverse(b.0));
    let mut new_code = source.to_string();
    for (pos, text) in insertions {
        new_code.insert_str(pos, &text);
    }

    DomPathsResult {
        code: new_code,
        map: None,
        components_count: transformed_components,
        paths_count: total_paths_count,
        paths: all_component_paths,
    }
}
