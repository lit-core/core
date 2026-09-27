use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::Visit;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{SourceType, SPAN};
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

fn collect_classes_mut<'a, 'b>(
    stmts: &'b mut [Statement<'a>],
    out: &mut Vec<&'b mut Class<'a>>,
) {
    for stmt in stmts {
        match stmt {
            Statement::ClassDeclaration(class) => {
                out.push(class);
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &mut export_decl.declaration {
                    out.push(class);
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &mut export_decl.declaration
                {
                    out.push(class);
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &mut var_decl.declarations {
                    if let Some(Expression::ClassExpression(class)) = &mut decl.init {
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
    let mut parsed = Parser::new(&allocator, source, source_type).parse();

    if parsed.program.body.is_empty() {
        return DomPathsResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            paths_count: 0,
            paths: Vec::new(),
        };
    }

    let ast = AstBuilder::new(&allocator);
    let normalize_whitespace = options.normalize_whitespace.unwrap_or(true);
    let mut all_component_paths = Vec::new();
    let mut total_paths_count = 0;
    let mut transformed_components = 0;

    let mut classes = Vec::new();
    collect_classes_mut(&mut parsed.program.body, &mut classes);

    if classes.is_empty() {
        return DomPathsResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            paths_count: 0,
            paths: Vec::new(),
        };
    }

    for class in classes {
        // Skip if already has __litPartPaths
        let has_part_paths = class.body.body.iter().any(|elem| match elem {
            ClassElement::PropertyDefinition(prop) => {
                prop.r#static && prop.key.is_specific_static_name("__litPartPaths")
            }
            _ => false,
        });

        if has_part_paths {
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

            // Construct AST node for `static __litPartPaths = [ ... ];`
            let mut elements = ArenaVec::new_in(&ast);
            for part in &part_descriptors {
                let mut path_elements = ArenaVec::new_in(&ast);
                for idx in &part.path {
                    path_elements.push(ArrayExpressionElement::from(Expression::new_numeric_literal(
                        SPAN,
                        *idx as f64,
                        None,
                        NumberBase::Decimal,
                        &ast,
                    )));
                }
                elements.push(ArrayExpressionElement::from(Expression::new_array_expression(
                    SPAN,
                    path_elements,
                    &ast,
                )));
            }

            let array_expr = Expression::new_array_expression(SPAN, elements, &ast);
            let key = PropertyKey::new_static_identifier(SPAN, "__litPartPaths", &ast);
            let prop_def = ClassElement::new_property_definition(
                SPAN,
                PropertyDefinitionType::PropertyDefinition,
                ArenaVec::new_in(&ast),
                key,
                None,
                Some(array_expr),
                false,
                true, // static = true
                false,
                false,
                false,
                false,
                false,
                None,
                &ast,
            );

            class.body.body.insert(0, prop_def);
        }
    }

    if transformed_components == 0 {
        return DomPathsResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            paths_count: 0,
            paths: Vec::new(),
        };
    }

    let mut codegen_options = CodegenOptions::default();
    if options.sourcemap.unwrap_or(false) {
        if let Some(ref filename) = options.filename {
            codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
        }
    }

    let codegen_result = Codegen::new().with_options(codegen_options).build(&parsed.program);
    let map_json = codegen_result.map.map(|m| m.to_json_string());

    DomPathsResult {
        code: codegen_result.code,
        map: map_json,
        components_count: transformed_components,
        paths_count: total_paths_count,
        paths: all_component_paths,
    }
}
