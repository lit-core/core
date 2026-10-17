use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::Visit;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{SourceType, SPAN};
use serde::{Deserialize, Serialize};

use oxc_semantic::{Scoping, SemanticBuilder};
use std::collections::HashSet;

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

pub fn is_canonical_lit_specifier(src: &str) -> bool {
    src == "lit"
        || src.starts_with("lit/")
        || src == "lit-html"
        || src.starts_with("lit-html/")
        || src == "lit-element"
        || src.starts_with("lit-element/")
        || src == "@lit/reactive-element"
        || src.starts_with("@lit/reactive-element/")
        || src.starts_with("@lit/")
}

#[derive(Clone, Debug)]
pub struct LitSemanticAnalysis {
    pub has_lit_imports: bool,
    pub has_any_imports: bool,
    pub lit_tag_names: HashSet<String>,
    pub lit_class_names: HashSet<String>,
    pub lit_namespaces: HashSet<String>,
}

impl LitSemanticAnalysis {
    pub fn new(program: &Program, scoping: &Scoping) -> Self {
        let mut analysis = Self {
            has_lit_imports: false,
            has_any_imports: false,
            lit_tag_names: HashSet::new(),
            lit_class_names: HashSet::new(),
            lit_namespaces: HashSet::new(),
        };

        let root = scoping.root_scope_id();

        for stmt in &program.body {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                analysis.has_any_imports = true;
                let src = import_decl.source.value.as_str();
                if is_canonical_lit_specifier(src) {
                    analysis.has_lit_imports = true;
                    if let Some(specifiers) = &import_decl.specifiers {
                        for spec in specifiers {
                            match spec {
                                ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                    let imported_name = named.imported.name();
                                    let local_name = named.local.name.as_str().to_string();
                                    let sym_id = named.local.symbol_id.get().or_else(|| {
                                        scoping.get_binding(root, named.local.name.as_str().into())
                                    });
                                    if sym_id.is_some() {
                                        if imported_name == "html" || imported_name == "svg" {
                                            analysis.lit_tag_names.insert(local_name);
                                        } else if imported_name == "LitElement"
                                            || imported_name == "ReactiveElement"
                                        {
                                            analysis.lit_class_names.insert(local_name);
                                        }
                                    }
                                }
                                ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                    let sym_id = ns.local.symbol_id.get().or_else(|| {
                                        scoping.get_binding(root, ns.local.name.as_str().into())
                                    });
                                    if sym_id.is_some() {
                                        analysis
                                            .lit_namespaces
                                            .insert(ns.local.name.as_str().to_string());
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }

        analysis
    }

    pub fn is_lit_tag(&self, expr: &Expression) -> bool {
        if !self.has_lit_imports {
            return false;
        }
        match expr {
            Expression::Identifier(ident) => self.lit_tag_names.contains(ident.name.as_str()),
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "html" || mem.property.name == "svg" {
                    if let Expression::Identifier(obj) = &mem.object {
                        return self.lit_namespaces.contains(obj.name.as_str());
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn is_lit_class(&self, class: &Class) -> bool {
        if !self.has_lit_imports {
            return false;
        }
        if let Some(ref heritage) = class.heritage {
            match &heritage.expression {
                Expression::Identifier(ident) => self.lit_class_names.contains(ident.name.as_str()),
                Expression::StaticMemberExpression(mem)
                    if mem.property.name == "LitElement"
                        || mem.property.name == "ReactiveElement" =>
                {
                    if let Expression::Identifier(obj) = &mem.object {
                        self.lit_namespaces.contains(obj.name.as_str())
                    } else {
                        false
                    }
                }
                _ => false,
            }
        } else {
            false
        }
    }
}

struct TemplateCollector<'s> {
    lit_analysis: &'s LitSemanticAnalysis,
    templates: Vec<(Vec<String>, bool)>, // (quasis, is_render)
    in_render: bool,
}

impl<'a, 's> Visit<'a> for TemplateCollector<'s> {
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
        if self.lit_analysis.is_lit_tag(&tagged.tag) && !tagged.quasi.expressions.is_empty() {
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

fn collect_classes_mut<'a, 'b>(stmts: &'b mut [Statement<'a>], out: &mut Vec<&'b mut Class<'a>>) {
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

    let lit_analysis = {
        let semantic_ret = SemanticBuilder::new().build(&parsed.program);
        LitSemanticAnalysis::new(&parsed.program, semantic_ret.semantic.scoping())
    };

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
        // Skip if class does not extend LitElement / ReactiveElement
        if !lit_analysis.is_lit_class(class) {
            continue;
        }

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
            lit_analysis: &lit_analysis,
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

        // Multi-template safety: exactly 1 template with expressions is supported for class-level part paths.
        // If there are multiple templates with expressions, class-level paths would collide. Bail out cleanly.
        if collector.templates.len() != 1 {
            continue;
        }

        let (quasis, _) = &collector.templates[0];
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
                path_elements.push(ArrayExpressionElement::from(
                    Expression::new_numeric_literal(
                        SPAN,
                        *idx as f64,
                        None,
                        NumberBase::Decimal,
                        &ast,
                    ),
                ));
            }
            elements.push(ArrayExpressionElement::from(
                Expression::new_array_expression(SPAN, path_elements, &ast),
            ));
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

        // Construct AST node for `static __litPartNodes(root) { return [ ... ]; }`
        let mut node_elements = ArenaVec::new_in(&ast);
        for part in &part_descriptors {
            let mut cur_expr = Expression::new_identifier(SPAN, "root", &ast);
            for idx in &part.path {
                let child_nodes_member = Expression::new_static_member_expression(
                    SPAN,
                    cur_expr,
                    IdentifierName::new(SPAN, "childNodes", &ast),
                    false,
                    &ast,
                );
                let num_expr = Expression::new_numeric_literal(
                    SPAN,
                    *idx as f64,
                    None,
                    NumberBase::Decimal,
                    &ast,
                );
                cur_expr = Expression::new_computed_member_expression(
                    SPAN,
                    child_nodes_member,
                    num_expr,
                    false,
                    &ast,
                );
            }
            node_elements.push(ArrayExpressionElement::from(cur_expr));
        }

        let return_array = Expression::new_array_expression(SPAN, node_elements, &ast);
        let mut ret_stmts = ArenaVec::new_in(&ast);
        ret_stmts.push(Statement::new_return_statement(
            SPAN,
            Some(return_array),
            &ast,
        ));
        let func_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(&ast), ret_stmts, &ast);

        let param_pat = BindingPattern::new_binding_identifier(SPAN, "root", &ast);
        let formal_param = FormalParameter::new_plain(SPAN, param_pat, &ast);
        let mut params_vec = ArenaVec::new_in(&ast);
        params_vec.push(formal_param);
        let params = FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            params_vec,
            None,
            &ast,
        );

        let func = Function::boxed(
            SPAN,
            FunctionType::FunctionExpression,
            None,
            false,
            false,
            false,
            None,
            None,
            params,
            None,
            Some(func_body),
            &ast,
        );

        let method_key = PropertyKey::new_static_identifier(SPAN, "__litPartNodes", &ast);
        let method_def = ClassElement::new_method_definition(
            SPAN,
            MethodDefinitionType::MethodDefinition,
            ArenaVec::new_in(&ast),
            method_key,
            func,
            MethodDefinitionKind::Method,
            false,
            true, // static = true
            false,
            false,
            None,
            &ast,
        );

        class.body.body.insert(0, method_def);
        class.body.body.insert(0, prop_def);
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

    let codegen_result = Codegen::new()
        .with_options(codegen_options)
        .build(&parsed.program);
    let map_json = codegen_result.map.map(|m| m.to_json_string());

    DomPathsResult {
        code: codegen_result.code,
        map: map_json,
        components_count: transformed_components,
        paths_count: total_paths_count,
        paths: all_component_paths,
    }
}
