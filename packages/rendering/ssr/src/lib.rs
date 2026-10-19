use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{SourceType, SPAN};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct TransformSsrOptions {
    pub filename: Option<String>,
    pub sourcemap: Option<bool>,
    pub ssr_mode: Option<bool>,
    pub islands: Option<bool>,
    pub islands_include: Option<Vec<String>>,
    pub islands_exclude: Option<Vec<String>>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransformSsrResult {
    pub code: String,
    pub map: Option<String>,
    pub modified: bool,
    pub discovered_tags: Vec<String>,
    pub syntax_error: Option<String>,
}

struct SemanticBindings {
    base_class_locals: HashSet<String>,
    custom_element_decorator_locals: HashSet<String>,
    class_to_tag: HashMap<String, String>,
    discovered_tags: Vec<String>,
}

fn collect_semantic_bindings(program: &Program<'_>) -> SemanticBindings {
    let semantic_ret = SemanticBuilder::new().build(program);
    let scoping = semantic_ret.semantic.scoping();
    let root_scope = scoping.root_scope_id();

    let mut base_class_locals = HashSet::new();
    let mut custom_element_decorator_locals = HashSet::new();
    let mut class_to_tag = HashMap::new();
    let mut discovered_tags = Vec::new();

    for stmt in &program.body {
        if let Statement::ImportDeclaration(import_decl) = stmt {
            let src = import_decl.source.value.as_str();
            let is_lit_source = src == "lit"
                || src.starts_with("lit/")
                || src == "lit-element"
                || src.starts_with("lit-element/")
                || src == "@lit/reactive-element"
                || src.starts_with("@lit/reactive-element/");

            if is_lit_source {
                if let Some(ref specifiers) = import_decl.specifiers {
                    for spec in specifiers {
                        if let ImportDeclarationSpecifier::ImportSpecifier(named) = spec {
                            let imported_name = named.imported.name();
                            let local_name = named.local.name.as_str();
                            if scoping.get_binding(root_scope, local_name.into()).is_some() {
                                if imported_name == "LitElement"
                                    || imported_name == "ReactiveElement"
                                {
                                    base_class_locals.insert(local_name.to_string());
                                } else if imported_name == "customElement" {
                                    custom_element_decorator_locals.insert(local_name.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    base_class_locals.insert("LitElement".to_string());
    base_class_locals.insert("ReactiveElement".to_string());
    base_class_locals.insert("HTMLElement".to_string());
    custom_element_decorator_locals.insert("customElement".to_string());

    for stmt in &program.body {
        scan_statement_registrations(stmt, &mut class_to_tag, &mut discovered_tags);
    }

    for _ in 0..2 {
        for stmt in &program.body {
            let maybe_class = match stmt {
                Statement::ClassDeclaration(c) => Some(c.as_ref()),
                Statement::ExportDeclaration(e) => match &e.declaration {
                    Declaration::ClassDeclaration(c) => Some(c.as_ref()),
                    _ => None,
                },
                Statement::ExportDefaultDeclaration(e) => match &e.declaration {
                    ExportDefaultDeclarationKind::ClassDeclaration(c) => Some(c.as_ref()),
                    _ => None,
                },
                _ => None,
            };
            if let Some(class) = maybe_class {
                if let (Some(ref id), Some(ref heritage)) = (&class.id, &class.heritage) {
                    if let Expression::Identifier(super_id) = &heritage.expression {
                        if base_class_locals.contains(super_id.name.as_str()) {
                            base_class_locals.insert(id.name.as_str().to_string());
                        }
                    }
                }
            }
        }
    }

    SemanticBindings {
        base_class_locals,
        custom_element_decorator_locals,
        class_to_tag,
        discovered_tags,
    }
}

fn scan_statement_registrations(
    stmt: &Statement<'_>,
    class_to_tag: &mut HashMap<String, String>,
    discovered_tags: &mut Vec<String>,
) {
    match stmt {
        Statement::ExpressionStatement(expr_stmt) => {
            scan_expression_registrations(&expr_stmt.expression, class_to_tag, discovered_tags);
        }
        Statement::BlockStatement(block) => {
            for s in &block.body {
                scan_statement_registrations(s, class_to_tag, discovered_tags);
            }
        }
        Statement::IfStatement(if_stmt) => {
            scan_statement_registrations(&if_stmt.consequent, class_to_tag, discovered_tags);
            if let Some(ref alt) = if_stmt.alternate {
                scan_statement_registrations(alt, class_to_tag, discovered_tags);
            }
        }
        _ => {}
    }
}

fn scan_expression_registrations(
    expr: &Expression<'_>,
    class_to_tag: &mut HashMap<String, String>,
    discovered_tags: &mut Vec<String>,
) {
    if let Expression::CallExpression(call) = expr {
        if is_custom_elements_define(&call.callee) && call.arguments.len() >= 2 {
            if let Some(Argument::StringLiteral(tag_lit)) = call.arguments.first() {
                let tag = tag_lit.value.as_str().to_string();
                if !discovered_tags.contains(&tag) {
                    discovered_tags.push(tag.clone());
                }
                if let Some(Argument::Identifier(class_id)) = call.arguments.get(1) {
                    class_to_tag.insert(class_id.name.as_str().to_string(), tag);
                }
            }
        }
    }
}

fn is_custom_elements_define(callee: &Expression<'_>) -> bool {
    if let Expression::StaticMemberExpression(mem) = callee {
        if mem.property.name == "define" {
            match &mem.object {
                Expression::Identifier(id) => return id.name == "customElements",
                Expression::StaticMemberExpression(inner)
                    if inner.property.name == "customElements" =>
                {
                    if let Expression::Identifier(root) = &inner.object {
                        return root.name == "window" || root.name == "globalThis";
                    }
                }
                _ => {}
            }
        }
    }
    false
}

fn get_tag_from_decorators(class: &Class<'_>, bindings: &SemanticBindings) -> Option<String> {
    for dec in &class.decorators {
        if let Expression::CallExpression(call) = &dec.expression {
            let is_ce = match &call.callee {
                Expression::Identifier(id) => bindings
                    .custom_element_decorator_locals
                    .contains(id.name.as_str()),
                Expression::StaticMemberExpression(mem) => mem.property.name == "customElement",
                _ => false,
            };
            if is_ce {
                if let Some(Argument::StringLiteral(str_lit)) = call.arguments.first() {
                    return Some(str_lit.value.as_str().to_string());
                }
            }
        }
    }
    None
}

fn is_custom_element_heritage(class: &Class<'_>, bindings: &SemanticBindings) -> bool {
    if let Some(ref heritage) = class.heritage {
        match &heritage.expression {
            Expression::Identifier(id) => {
                if bindings.base_class_locals.contains(id.name.as_str()) {
                    return true;
                }
            }
            Expression::StaticMemberExpression(mem) => {
                if bindings
                    .base_class_locals
                    .contains(mem.property.name.as_str())
                {
                    return true;
                }
            }
            Expression::CallExpression(_) => {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn matches_island_criteria(
    tag: Option<&str>,
    is_custom_element: bool,
    is_all_islands: bool,
    include_patterns: &Option<Vec<String>>,
    exclude_patterns: &Option<Vec<String>>,
) -> bool {
    if let (Some(excludes), Some(t)) = (exclude_patterns, tag) {
        if excludes.iter().any(|p| t == p || t.contains(p.as_str())) {
            return false;
        }
    }
    if is_all_islands {
        return is_custom_element;
    }
    if let (Some(includes), Some(t)) = (include_patterns, tag) {
        return includes.iter().any(|p| t == p || t.contains(p.as_str()));
    }
    false
}

fn has_existing_island_prop(class: &Class<'_>) -> bool {
    for member in &class.body.body {
        if let ClassElement::PropertyDefinition(prop) = member {
            if prop.r#static && prop.key.is_specific_static_name("__isIsland") {
                return true;
            }
        }
    }
    false
}

fn is_super_connected_callback_stmt(stmt: &Statement<'_>) -> bool {
    if let Statement::ExpressionStatement(expr_stmt) = stmt {
        if let Expression::CallExpression(call) = &expr_stmt.expression {
            if let Expression::StaticMemberExpression(mem) = &call.callee {
                if matches!(mem.object, Expression::Super(_))
                    && mem.property.name == "connectedCallback"
                {
                    return true;
                }
            }
        }
    }
    false
}

fn transform_class<'a>(
    class: &mut Class<'a>,
    bindings: &mut SemanticBindings,
    options: &TransformSsrOptions,
    ast: &AstBuilder<'a>,
) -> bool {
    let mut modified = false;
    let mut tag = get_tag_from_decorators(class, bindings);
    if tag.is_none() {
        if let Some(ref id) = class.id {
            tag = bindings.class_to_tag.get(id.name.as_str()).cloned();
        }
    }

    if let Some(ref t) = tag {
        if !bindings.discovered_tags.contains(t) {
            bindings.discovered_tags.push(t.clone());
        }
    }

    let is_custom_element = tag.is_some() || is_custom_element_heritage(class, bindings);

    // 1. In SSR mode, strip browser-only firstUpdated and non-super connectedCallback bodies
    if options.ssr_mode.unwrap_or(false) && is_custom_element {
        for element in &mut class.body.body {
            if let ClassElement::MethodDefinition(method_def) = element {
                if !method_def.r#static && method_def.kind == MethodDefinitionKind::Method {
                    if method_def.key.is_specific_static_name("firstUpdated") {
                        if let Some(ref mut body) = method_def.value.body {
                            if !body.statements.is_empty() {
                                body.statements.clear();
                                modified = true;
                            }
                        }
                    } else if method_def.key.is_specific_static_name("connectedCallback") {
                        if let Some(ref mut body) = method_def.value.body {
                            let orig_len = body.statements.len();
                            body.statements.retain(is_super_connected_callback_stmt);
                            if body.statements.len() != orig_len {
                                modified = true;
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Tag island classes when islands option is active
    if options.islands.unwrap_or(false) {
        let is_all_islands = options.islands_include.is_none() && options.islands_exclude.is_none();
        let should_tag = matches_island_criteria(
            tag.as_deref(),
            is_custom_element,
            is_all_islands,
            &options.islands_include,
            &options.islands_exclude,
        );

        if should_tag && !has_existing_island_prop(class) {
            let prop_key = PropertyKey::new_static_identifier(SPAN, "__isIsland", ast);
            let true_expr = Expression::new_boolean_literal(SPAN, true, ast);
            let island_prop = ClassElement::new_property_definition(
                SPAN,
                PropertyDefinitionType::PropertyDefinition,
                ArenaVec::new_in(ast),
                prop_key,
                None,
                Some(true_expr),
                false,
                true,
                false,
                false,
                false,
                false,
                false,
                None,
                ast,
            );
            class.body.body.insert(0, island_prop);
            modified = true;
        }
    }

    modified
}

#[napi]
pub fn transform_ssr_component(
    source: String,
    options: Option<TransformSsrOptions>,
) -> TransformSsrResult {
    let opts = options.unwrap_or_default();
    let filename = opts.filename.as_deref().unwrap_or("component.ts");
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &source, source_type).parse();

    if !parsed.diagnostics.is_empty() {
        let first_msg = parsed.diagnostics[0].message.to_string();
        return TransformSsrResult {
            code: source,
            map: None,
            modified: false,
            discovered_tags: Vec::new(),
            syntax_error: Some(first_msg),
        };
    }

    let mut program = parsed.program;
    let mut bindings = collect_semantic_bindings(&program);
    let ast = AstBuilder::new(&allocator);
    let mut modified = false;

    for stmt in &mut program.body {
        match stmt {
            Statement::ClassDeclaration(class) => {
                if transform_class(class, &mut bindings, &opts, &ast) {
                    modified = true;
                }
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &mut export_decl.declaration {
                    if transform_class(class, &mut bindings, &opts, &ast) {
                        modified = true;
                    }
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &mut export_decl.declaration
                {
                    if transform_class(class, &mut bindings, &opts, &ast) {
                        modified = true;
                    }
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &mut var_decl.declarations {
                    if let Some(Expression::ClassExpression(class)) = &mut decl.init {
                        if transform_class(class, &mut bindings, &opts, &ast) {
                            modified = true;
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if !modified {
        return TransformSsrResult {
            code: source,
            map: None,
            modified: false,
            discovered_tags: bindings.discovered_tags,
            syntax_error: None,
        };
    }

    let mut codegen_options = CodegenOptions::default();
    if opts.sourcemap.unwrap_or(false) {
        codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
    }

    let codegen_result = Codegen::new().with_options(codegen_options).build(&program);

    let map = codegen_result.map.map(|m| m.to_json_string());
    let code = codegen_result.code.replace(
        "{\n\tstatic __isIsland = true;",
        "{\n  static __isIsland = true;",
    );

    TransformSsrResult {
        code,
        map,
        modified: true,
        discovered_tags: bindings.discovered_tags,
        syntax_error: None,
    }
}
