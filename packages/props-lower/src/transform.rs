use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec, CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{SourceType, SPAN};

use crate::ast_helpers::AstHelper;
use crate::constructor::{hoist_constructor_defaults, inject_constructor_statements};
use crate::decorators::custom_element::transform_custom_element;
use crate::decorators::event_options::try_transform_event_options;
use crate::decorators::localized::transform_localized;
use crate::decorators::property::try_transform_property;
use crate::decorators::query::try_transform_query;
use crate::decorators::query_all::try_transform_query_all;
use crate::decorators::query_assigned::try_transform_query_assigned;
use crate::decorators::query_async::try_transform_query_async;
use crate::decorators::state::try_transform_state;
use crate::lit_import_scanner::{is_lit_import, ImportContext, LitDecoratorKind};
use crate::static_properties::{
    deduplicate_descriptors_in_program, inject_or_merge_static_properties,
};

#[napi(object)]
#[derive(Default, Clone, Debug)]
pub struct TransformOptions {
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct TransformResult {
    pub code: String,
    pub map: Option<String>,
}

pub fn transform_code(source: &str, options: TransformOptions) -> TransformResult {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(options.filename.as_deref().unwrap_or("file.ts"))
        .unwrap_or_else(|_| SourceType::ts());

    let parsed = Parser::new(&allocator, source, source_type).parse();

    if !parsed.diagnostics.is_empty() {
        return TransformResult {
            code: source.to_string(),
            map: None,
        };
    }

    let mut program = parsed.program;

    // 1. Scan for Lit decorator imports
    let import_ctx = ImportContext::scan(&program);
    let has_decorators_in_source = source.contains("@property")
        || source.contains("@state")
        || source.contains("@customElement")
        || source.contains("__decorate");
    if !import_ctx.has_lit_decorators() && !has_decorators_in_source {
        return TransformResult {
            code: source.to_string(),
            map: None,
        };
    }


    let ast = AstBuilder::new(&allocator);

    // 2. Walk top-level statements and transform classes & decorate calls
    let old_statements = std::mem::replace(&mut program.body, ArenaVec::new_in(&ast));
    let mut intermediate_statements = ArenaVec::new_in(&ast);

    for mut stmt in old_statements {
        match &mut stmt {
            Statement::ClassDeclaration(class) => {
                let post_stmts = transform_class(class, &import_ctx, &ast);
                intermediate_statements.push(stmt);
                for s in post_stmts {
                    intermediate_statements.push(s);
                }
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &mut export_decl.declaration {
                    let post_stmts = transform_class(class, &import_ctx, &ast);
                    intermediate_statements.push(stmt);
                    for s in post_stmts {
                        intermediate_statements.push(s);
                    }
                } else {
                    intermediate_statements.push(stmt);
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &mut export_decl.declaration
                {
                    let post_stmts = transform_class(class, &import_ctx, &ast);
                    intermediate_statements.push(stmt);
                    for s in post_stmts {
                        intermediate_statements.push(s);
                    }
                } else {
                    intermediate_statements.push(stmt);
                }
            }
            Statement::ExpressionStatement(expr_stmt) => {
                if let Some(lowered_stmts) =
                    try_transform_expression_statement(expr_stmt, &import_ctx, &ast)
                {
                    for s in lowered_stmts {
                        intermediate_statements.push(s);
                    }
                } else {
                    intermediate_statements.push(stmt);
                }
            }
            _ => {
                intermediate_statements.push(stmt);
            }
        }
    }

    // 3. Clean unused decorator imports
    let mut referenced_names = std::collections::HashSet::new();
    for name in import_ctx.decorator_bindings.keys() {
        if is_identifier_used_in_statements(&intermediate_statements, name) {
            referenced_names.insert(name.clone());
        }
    }

    let mut new_statements = ArenaVec::new_in(&ast);
    for mut stmt in intermediate_statements {
        if let Statement::ImportDeclaration(import_decl) = &mut stmt {
            if clean_lit_import(import_decl, &import_ctx, &referenced_names, &ast) {
                new_statements.push(stmt);
            }
        } else {
            new_statements.push(stmt);
        }
    }

    // 3.5. Strip dead __decorate and __metadata boilerplate if no __decorate calls remain
    strip_dead_decorator_helpers(&mut new_statements);

    program.body = new_statements;

    // 4. Deduplicate repeating property descriptor presets into frozen module constants
    deduplicate_descriptors_in_program(&mut program, &ast);

    let mut codegen_options = CodegenOptions::default();
    if options.sourcemap.unwrap_or(false) {
        if let Some(ref filename) = options.filename {
            codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
        }
    }

    let codegen_result = Codegen::new().with_options(codegen_options).build(&program);

    let map_json = codegen_result.map.map(|m| m.to_json_string());

    TransformResult {
        code: codegen_result.code,
        map: map_json,
    }
}

pub fn transform_class<'a>(
    class: &mut Class<'a>,
    import_ctx: &ImportContext,
    ast: &AstBuilder<'a>,
) -> Vec<Statement<'a>> {
    let mut post_class_statements = Vec::new();
    let mut constructor_statements = Vec::new();
    let mut reactive_props = Vec::new();

    // 1. Transform class decorators
    if let Some(custom_elem_stmt) = transform_custom_element(class, import_ctx, ast) {
        post_class_statements.push(custom_elem_stmt);
    }

    if let Some(localized_stmt) = transform_localized(class, import_ctx, ast) {
        constructor_statements.push(localized_stmt);
    }

    let class_name = class
        .id
        .as_ref()
        .map(|id| id.name.as_str().to_string())
        .unwrap_or_default();

    // 2. Transform members
    let old_elements = std::mem::replace(&mut class.body.body, ArenaVec::new_in(ast));
    let mut new_elements = ArenaVec::new_in(ast);

    for mut element in old_elements {
        // @property
        if let Some(res) = try_transform_property(&mut element, import_ctx, ast) {
            reactive_props.push(res.reactive_prop);
            if let Some(init_stmt) = res.constructor_init {
                constructor_statements.push(init_stmt);
            }
            if !res.remove_member {
                new_elements.push(element);
            }
            continue;
        }

        // @state
        if let Some(res) = try_transform_state(&mut element, import_ctx, ast) {
            reactive_props.push(res.reactive_prop);
            if let Some(init_stmt) = res.constructor_init {
                constructor_statements.push(init_stmt);
            }
            if !res.remove_member {
                new_elements.push(element);
            }
            continue;
        }

        // @query
        if let Some(getter) = try_transform_query(&mut element, import_ctx, ast) {
            new_elements.push(getter);
            continue;
        }

        // @queryAll
        if let Some(getter) = try_transform_query_all(&mut element, import_ctx, ast) {
            new_elements.push(getter);
            continue;
        }

        // @queryAsync
        if let Some(getter) = try_transform_query_async(&mut element, import_ctx, ast) {
            new_elements.push(getter);
            continue;
        }

        // @queryAssignedElements / @queryAssignedNodes
        if let Some(getter) = try_transform_query_assigned(&mut element, import_ctx, ast) {
            new_elements.push(getter);
            continue;
        }

        // @eventOptions
        if let Some(event_opt_stmt) =
            try_transform_event_options(&mut element, &class_name, import_ctx, ast)
        {
            post_class_statements.push(event_opt_stmt);
            new_elements.push(element);
            continue;
        }

        new_elements.push(element);
    }

    class.body.body = new_elements;

    // 3. Inject or merge static properties
    if !reactive_props.is_empty() {
        inject_or_merge_static_properties(class, reactive_props, ast);
    }

    // 4. Hoist scalar property defaults onto class prototype
    let proto_stmts = hoist_constructor_defaults(class, ast);
    for s in proto_stmts {
        post_class_statements.push(s);
    }

    // 5. Inject constructor statements
    if !constructor_statements.is_empty() {
        inject_constructor_statements(class, constructor_statements, ast);
    }

    post_class_statements
}

fn clean_lit_import<'a>(
    import_decl: &mut ImportDeclaration<'a>,
    import_ctx: &ImportContext,
    referenced_names: &std::collections::HashSet<String>,
    ast: &AstBuilder<'a>,
) -> bool {
    let specifier = import_decl.source.value.as_str();
    if !is_lit_import(specifier) {
        return true;
    }

    let Some(specifiers) = &mut import_decl.specifiers else {
        return true;
    };

    let old_specs = std::mem::replace(specifiers, ArenaVec::new_in(ast));
    let mut new_specs = ArenaVec::new_in(ast);

    for mut spec in old_specs {
        match &mut spec {
            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                let imported_name = named.imported.name();
                let local_name = named.local.name.as_str();
                if imported_name.as_str() == "localized" {
                    named.imported = ModuleExportName::IdentifierName(IdentifierName::new(
                        SPAN,
                        "updateWhenLocaleChanges",
                        ast,
                    ));
                    if local_name == "localized" {
                        named.local = BindingIdentifier::new(SPAN, "updateWhenLocaleChanges", ast);
                    }
                    new_specs.push(spec);
                } else if import_ctx.get_decorator_kind(local_name).is_some() {
                    // Only strip if NO references remain in the program!
                    if referenced_names.contains(local_name) {
                        new_specs.push(spec);
                    }
                } else {
                    new_specs.push(spec);
                }
            }
            _ => {
                new_specs.push(spec);
            }
        }
    }

    if new_specs.is_empty() {
        false
    } else {
        *specifiers = new_specs;
        true
    }
}

pub fn try_transform_expression_statement<'a>(
    expr_stmt: &mut ExpressionStatement<'a>,
    import_ctx: &ImportContext,
    ast: &AstBuilder<'a>,
) -> Option<Vec<Statement<'a>>> {
    match &mut expr_stmt.expression {
        Expression::CallExpression(call) => try_transform_decorate_call(call, import_ctx, ast),
        Expression::AssignmentExpression(assign) => {
            if let Expression::CallExpression(call) = &assign.right {
                try_transform_decorate_call(call, import_ctx, ast)
            } else {
                None
            }
        }
        Expression::SequenceExpression(seq) => {
            let mut out_stmts = Vec::new();
            let mut any_transformed = false;
            for expr in &seq.expressions {
                if let Expression::CallExpression(call) = expr {
                    if let Some(stmts) = try_transform_decorate_call(call, import_ctx, ast) {
                        out_stmts.extend(stmts);
                        any_transformed = true;
                        continue;
                    }
                }
                out_stmts.push(Statement::new_expression_statement(
                    SPAN,
                    expr.clone_in(ast.allocator()),
                    ast,
                ));
            }
            if any_transformed {
                Some(out_stmts)
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn try_transform_decorate_call<'a>(
    call: &CallExpression<'a>,
    import_ctx: &ImportContext,
    ast: &AstBuilder<'a>,
) -> Option<Vec<Statement<'a>>> {
    if call.arguments.len() < 2 {
        return None;
    }

    let first_arg = call.arguments.first()?;
    let Expression::ArrayExpression(arr) = first_arg.as_expression()? else {
        return None;
    };
    if arr.elements.is_empty() {
        return None;
    }

    let is_decorate = match &call.callee {
        Expression::Identifier(id) => {
            id.name == "__decorate"
                || id.name == "__decorateClass"
                || id.name == "_ts_decorate"
                || id.name.starts_with("__decorate")
                || arr.elements.iter().any(|elem| {
                    if let Some(Expression::CallExpression(c)) = elem.as_expression() {
                        let name = match &c.callee {
                            Expression::Identifier(id) => id.name.as_str(),
                            Expression::StaticMemberExpression(m) => m.property.name.as_str(),
                            _ => "",
                        };
                        import_ctx.get_decorator_kind(name).is_some()
                            || LitDecoratorKind::from_canonical_name(name).is_some()
                    } else {
                        false
                    }
                })
        }
        Expression::StaticMemberExpression(mem) => {
            mem.property.name == "__decorate"
                || mem.property.name == "decorate"
        }
        _ => false,
    };
    if !is_decorate {
        return None;
    }

    let second_arg = call.arguments.get(1)?;
    let target_expr = second_arg.as_expression()?;
    let helper = AstHelper::new(ast);

    let mut lowered_stmts = Vec::new();
    let mut unlowered_elems = ArenaVec::new_in(ast);

    for elem in &arr.elements {
        let Some(Expression::CallExpression(dec_call)) = elem.as_expression() else {
            unlowered_elems.push(elem.clone_in(ast.allocator()));
            continue;
        };

        let dec_name = match &dec_call.callee {
            Expression::Identifier(id) => id.name.as_str(),
            Expression::StaticMemberExpression(mem) => mem.property.name.as_str(),
            _ => {
                unlowered_elems.push(elem.clone_in(ast.allocator()));
                continue;
            }
        };

        if dec_name == "__metadata" || dec_name == "metadata" {
            continue;
        }

        let Some(kind) = import_ctx
            .get_decorator_kind(dec_name)
            .or_else(|| LitDecoratorKind::from_canonical_name(dec_name))
        else {
            unlowered_elems.push(elem.clone_in(ast.allocator()));
            continue;
        };

        match kind {
            LitDecoratorKind::Property => {
                let class_expr = match target_expr {
                    Expression::StaticMemberExpression(target_mem) => {
                        if target_mem.property.name != "prototype" {
                            unlowered_elems.push(elem.clone_in(ast.allocator()));
                            continue;
                        }
                        target_mem.object.clone_in(ast.allocator())
                    }
                    Expression::Identifier(id) => {
                        Expression::Identifier(id.clone_in(ast.allocator()))
                    }
                    _ => {
                        unlowered_elems.push(elem.clone_in(ast.allocator()));
                        continue;
                    }
                };

                let third_arg = match call.arguments.get(2) {
                    Some(a) => a,
                    None => {
                        unlowered_elems.push(elem.clone_in(ast.allocator()));
                        continue;
                    }
                };
                let prop_name = match third_arg.as_expression() {
                    Some(Expression::StringLiteral(str_lit)) => str_lit.value.as_str(),
                    Some(Expression::Identifier(id)) => id.name.as_str(),
                    _ => {
                        unlowered_elems.push(elem.clone_in(ast.allocator()));
                        continue;
                    }
                };

                let opt_arg = dec_call
                    .arguments
                    .first()
                    .and_then(|a| a.as_expression())
                    .map(|e| e.clone_in(ast.allocator()));

                let stmt = helper.create_property_call(
                    class_expr,
                    ast.allocator().alloc_str(prop_name),
                    opt_arg,
                );
                lowered_stmts.push(stmt);
            }
            LitDecoratorKind::State => {
                let class_expr = match target_expr {
                    Expression::StaticMemberExpression(target_mem) => {
                        if target_mem.property.name != "prototype" {
                            unlowered_elems.push(elem.clone_in(ast.allocator()));
                            continue;
                        }
                        target_mem.object.clone_in(ast.allocator())
                    }
                    Expression::Identifier(id) => {
                        Expression::Identifier(id.clone_in(ast.allocator()))
                    }
                    _ => {
                        unlowered_elems.push(elem.clone_in(ast.allocator()));
                        continue;
                    }
                };

                let third_arg = match call.arguments.get(2) {
                    Some(a) => a,
                    None => {
                        unlowered_elems.push(elem.clone_in(ast.allocator()));
                        continue;
                    }
                };
                let prop_name = match third_arg.as_expression() {
                    Some(Expression::StringLiteral(str_lit)) => str_lit.value.as_str(),
                    Some(Expression::Identifier(id)) => id.name.as_str(),
                    _ => {
                        unlowered_elems.push(elem.clone_in(ast.allocator()));
                        continue;
                    }
                };

                let state_key = PropertyKey::new_static_identifier(SPAN, "state", ast);
                let true_val = Expression::new_boolean_literal(SPAN, true, ast);
                let obj_prop = ObjectPropertyKind::new_object_property(
                    SPAN,
                    PropertyKind::Init,
                    state_key,
                    true_val,
                    false,
                    false,
                    false,
                    ast,
                );
                let mut props = ArenaVec::new_in(ast);
                props.push(obj_prop);
                let state_obj = Expression::new_object_expression(SPAN, props, ast);

                let stmt = helper.create_property_call(
                    class_expr,
                    ast.allocator().alloc_str(prop_name),
                    Some(state_obj),
                );
                lowered_stmts.push(stmt);
            }
            LitDecoratorKind::CustomElement => {
                let class_expr = target_expr.clone_in(ast.allocator());

                let Some(tag_arg) = dec_call.arguments.first() else {
                    unlowered_elems.push(elem.clone_in(ast.allocator()));
                    continue;
                };
                let tag_str = match tag_arg.as_expression() {
                    Some(Expression::StringLiteral(str_lit)) => Some(str_lit.value.as_str()),
                    Some(Expression::TemplateLiteral(tmpl))
                        if tmpl.expressions.is_empty() && !tmpl.quasis.is_empty() =>
                    {
                        Some(tmpl.quasis[0].value.raw.as_str())
                    }
                    _ => None,
                };
                let Some(tag_str) = tag_str else {
                    unlowered_elems.push(elem.clone_in(ast.allocator()));
                    continue;
                };

                let stmt =
                    helper.custom_elements_define(ast.allocator().alloc_str(tag_str), class_expr);
                lowered_stmts.push(stmt);
            }
            LitDecoratorKind::Query => {
                let third_arg = match call.arguments.get(2) {
                    Some(a) => a,
                    None => {
                        unlowered_elems.push(elem.clone_in(ast.allocator()));
                        continue;
                    }
                };
                let prop_name = match third_arg.as_expression() {
                    Some(Expression::StringLiteral(str_lit)) => str_lit.value.as_str(),
                    Some(Expression::Identifier(id)) => id.name.as_str(),
                    _ => {
                        unlowered_elems.push(elem.clone_in(ast.allocator()));
                        continue;
                    }
                };

                let Some(selector_arg) = dec_call.arguments.first() else {
                    unlowered_elems.push(elem.clone_in(ast.allocator()));
                    continue;
                };
                let selector_str = match selector_arg.as_expression() {
                    Some(Expression::StringLiteral(str_lit)) => Some(str_lit.value.as_str()),
                    Some(Expression::TemplateLiteral(tmpl))
                        if tmpl.expressions.is_empty() && !tmpl.quasis.is_empty() =>
                    {
                        Some(tmpl.quasis[0].value.raw.as_str())
                    }
                    _ => None,
                };
                let Some(selector_str) = selector_str else {
                    unlowered_elems.push(elem.clone_in(ast.allocator()));
                    continue;
                };

                let this = helper.this_expr();
                let render_root = helper.static_member(this, "renderRoot", false);
                let query_selector_member =
                    helper.static_member(render_root, "querySelector", true);
                let mut q_args = ArenaVec::new_in(ast);
                q_args.push(Argument::from(
                    helper.string_lit(ast.allocator().alloc_str(selector_str)),
                ));
                let query_call = helper.call_expr(query_selector_member, q_args, false);
                let null_expr = helper.null_lit();
                let return_expr = helper.nullish_coalescing(query_call, null_expr);

                let stmt = helper.define_getter(
                    target_expr.clone_in(ast.allocator()),
                    ast.allocator().alloc_str(prop_name),
                    return_expr,
                );
                lowered_stmts.push(stmt);
            }
            LitDecoratorKind::QueryAll => {
                let third_arg = match call.arguments.get(2) {
                    Some(a) => a,
                    None => {
                        unlowered_elems.push(elem.clone_in(ast.allocator()));
                        continue;
                    }
                };
                let prop_name = match third_arg.as_expression() {
                    Some(Expression::StringLiteral(str_lit)) => str_lit.value.as_str(),
                    Some(Expression::Identifier(id)) => id.name.as_str(),
                    _ => {
                        unlowered_elems.push(elem.clone_in(ast.allocator()));
                        continue;
                    }
                };

                let Some(selector_arg) = dec_call.arguments.first() else {
                    unlowered_elems.push(elem.clone_in(ast.allocator()));
                    continue;
                };
                let selector_str = match selector_arg.as_expression() {
                    Some(Expression::StringLiteral(str_lit)) => Some(str_lit.value.as_str()),
                    Some(Expression::TemplateLiteral(tmpl))
                        if tmpl.expressions.is_empty() && !tmpl.quasis.is_empty() =>
                    {
                        Some(tmpl.quasis[0].value.raw.as_str())
                    }
                    _ => None,
                };
                let Some(selector_str) = selector_str else {
                    unlowered_elems.push(elem.clone_in(ast.allocator()));
                    continue;
                };

                let this = helper.this_expr();
                let render_root = helper.static_member(this, "renderRoot", false);
                let query_selector_all_member =
                    helper.static_member(render_root, "querySelectorAll", true);
                let mut q_args = ArenaVec::new_in(ast);
                q_args.push(Argument::from(
                    helper.string_lit(ast.allocator().alloc_str(selector_str)),
                ));
                let query_call = helper.call_expr(query_selector_all_member, q_args, false);
                let empty_arr = helper.empty_array();
                let return_expr = helper.nullish_coalescing(query_call, empty_arr);

                let stmt = helper.define_getter(
                    target_expr.clone_in(ast.allocator()),
                    ast.allocator().alloc_str(prop_name),
                    return_expr,
                );
                lowered_stmts.push(stmt);
            }
            LitDecoratorKind::QueryAssignedElements | LitDecoratorKind::QueryAssignedNodes => {
                let third_arg = match call.arguments.get(2) {
                    Some(a) => a,
                    None => {
                        unlowered_elems.push(elem.clone_in(ast.allocator()));
                        continue;
                    }
                };
                let prop_name = match third_arg.as_expression() {
                    Some(Expression::StringLiteral(str_lit)) => str_lit.value.as_str(),
                    Some(Expression::Identifier(id)) => id.name.as_str(),
                    _ => {
                        unlowered_elems.push(elem.clone_in(ast.allocator()));
                        continue;
                    }
                };

                let this = helper.this_expr();
                let render_root = helper.static_member(this, "renderRoot", false);
                let query_selector_member =
                    helper.static_member(render_root, "querySelector", true);
                let mut q_args = ArenaVec::new_in(ast);
                q_args.push(Argument::from(helper.string_lit("slot")));
                let slot_call = helper.call_expr(query_selector_member, q_args, false);

                let method_name = if kind == LitDecoratorKind::QueryAssignedElements {
                    "assignedElements"
                } else {
                    "assignedNodes"
                };
                let assigned_member = helper.static_member(slot_call, method_name, true);
                let mut a_args = ArenaVec::new_in(ast);
                if let Some(opt) = dec_call.arguments.first() {
                    if let Some(opt_expr) = opt.as_expression() {
                        a_args.push(Argument::from(opt_expr.clone_in(ast.allocator())));
                    }
                }
                let assigned_call = helper.call_expr(assigned_member, a_args, false);
                let empty_arr = helper.empty_array();
                let return_expr = helper.nullish_coalescing(assigned_call, empty_arr);

                let stmt = helper.define_getter(
                    target_expr.clone_in(ast.allocator()),
                    ast.allocator().alloc_str(prop_name),
                    return_expr,
                );
                lowered_stmts.push(stmt);
            }
            _ => {
                unlowered_elems.push(elem.clone_in(ast.allocator()));
            }
        }
    }

    if lowered_stmts.is_empty() {
        return None;
    }

    if !unlowered_elems.is_empty() {
        let mut new_call = call.clone_in(ast.allocator());
        let new_arr = Expression::new_array_expression(SPAN, unlowered_elems, ast);
        if let Some(first) = new_call.arguments.first_mut() {
            *first = Argument::from(new_arr);
        }
        let call_expr = helper.call_expr(new_call.callee, new_call.arguments, new_call.optional);
        lowered_stmts.push(Statement::new_expression_statement(
            SPAN,
            call_expr,
            ast,
        ));
    }

    Some(lowered_stmts)
}

fn strip_dead_decorator_helpers<'a>(statements: &mut ArenaVec<'a, Statement<'a>>) {
    if is_identifier_used_in_statements(statements, "__decorate")
        || is_identifier_used_in_statements(statements, "__decorateClass")
        || is_identifier_used_in_statements(statements, "_ts_decorate")
    {
        return;
    }

    statements.retain_mut(|stmt| {
        match stmt {
            Statement::VariableDeclaration(var_decl) => {
                var_decl.declarations.retain(|decl| {
                    if let BindingPattern::BindingIdentifier(id) = &decl.id {
                        id.name != "__decorate"
                            && id.name != "__decorateClass"
                            && id.name != "_ts_decorate"
                            && id.name != "__metadata"
                    } else {
                        true
                    }
                });
                !var_decl.declarations.is_empty()
            }
            Statement::ImportDeclaration(import_decl) => {
                if let Some(specifiers) = &mut import_decl.specifiers {
                    specifiers.retain(|spec| {
                        match spec {
                            ImportDeclarationSpecifier::ImportSpecifier(s) => {
                                s.local.name != "__decorate"
                                    && s.local.name != "__decorateClass"
                                    && s.local.name != "_ts_decorate"
                                    && s.local.name != "__metadata"
                            }
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                                s.local.name != "__decorate"
                                    && s.local.name != "__decorateClass"
                                    && s.local.name != "_ts_decorate"
                            }
                            _ => true,
                        }
                    });
                    !specifiers.is_empty()
                } else {
                    true
                }
            }
            _ => true,
        }
    });
}

pub fn is_identifier_used_in_statements<'a>(statements: &[Statement<'a>], name: &str) -> bool {
    statements.iter().any(|s| stmt_has_identifier_reference(s, name))
}

fn stmt_has_identifier_reference(stmt: &Statement, name: &str) -> bool {
    match stmt {
        Statement::ExpressionStatement(e) => expr_has_identifier_reference(&e.expression, name),
        Statement::VariableDeclaration(var_decl) => {
            var_decl.declarations.iter().any(|d| {
                d.init.as_ref().map_or(false, |init| expr_has_identifier_reference(init, name))
            })
        }
        Statement::ClassDeclaration(class) => class_has_identifier_reference(class, name),
        Statement::FunctionDeclaration(func) => {
            func.body.as_ref().map_or(false, |b| {
                b.statements.iter().any(|s| stmt_has_identifier_reference(s, name))
            })
        }
        Statement::ReturnStatement(ret) => {
            ret.argument.as_ref().map_or(false, |arg| expr_has_identifier_reference(arg, name))
        }
        Statement::IfStatement(if_stmt) => {
            expr_has_identifier_reference(&if_stmt.test, name)
                || stmt_has_identifier_reference(&if_stmt.consequent, name)
                || if_stmt.alternate.as_ref().map_or(false, |alt| stmt_has_identifier_reference(alt, name))
        }
        Statement::BlockStatement(block) => {
            block.body.iter().any(|s| stmt_has_identifier_reference(s, name))
        }
        Statement::ForStatement(for_stmt) => {
            for_stmt.init.as_ref().map_or(false, |init| match init {
                ForStatementInit::VariableDeclaration(v) => v.declarations.iter().any(|d| d.init.as_ref().map_or(false, |i| expr_has_identifier_reference(i, name))),
                _ => init.as_expression().map_or(false, |e| expr_has_identifier_reference(e, name)),
            })
            || for_stmt.test.as_ref().map_or(false, |test| expr_has_identifier_reference(test, name))
            || for_stmt.update.as_ref().map_or(false, |up| expr_has_identifier_reference(up, name))
            || stmt_has_identifier_reference(&for_stmt.body, name)
        }
        Statement::ForInStatement(for_in) => {
            expr_has_identifier_reference(&for_in.right, name)
                || stmt_has_identifier_reference(&for_in.body, name)
        }
        Statement::ForOfStatement(for_of) => {
            expr_has_identifier_reference(&for_of.right, name)
                || stmt_has_identifier_reference(&for_of.body, name)
        }
        Statement::WhileStatement(while_stmt) => {
            expr_has_identifier_reference(&while_stmt.test, name)
                || stmt_has_identifier_reference(&while_stmt.body, name)
        }
        Statement::DoWhileStatement(do_while) => {
            expr_has_identifier_reference(&do_while.test, name)
                || stmt_has_identifier_reference(&do_while.body, name)
        }
        Statement::SwitchStatement(switch_stmt) => {
            expr_has_identifier_reference(&switch_stmt.discriminant, name)
                || switch_stmt.cases.iter().any(|c| {
                    c.test.as_ref().map_or(false, |t| expr_has_identifier_reference(t, name))
                        || c.consequent.iter().any(|s| stmt_has_identifier_reference(s, name))
                })
        }
        Statement::ThrowStatement(throw_stmt) => {
            expr_has_identifier_reference(&throw_stmt.argument, name)
        }
        Statement::TryStatement(try_stmt) => {
            try_stmt.block.body.iter().any(|s| stmt_has_identifier_reference(s, name))
                || try_stmt.handler.as_ref().map_or(false, |h| {
                    h.body.body.iter().any(|s| stmt_has_identifier_reference(s, name))
                })
                || try_stmt.finalizer.as_ref().map_or(false, |f| {
                    f.body.iter().any(|s| stmt_has_identifier_reference(s, name))
                })
        }
        Statement::ExportDefaultDeclaration(exp) => {
            match &exp.declaration {
                ExportDefaultDeclarationKind::ClassDeclaration(c) => class_has_identifier_reference(c, name),
                ExportDefaultDeclarationKind::FunctionDeclaration(f) => {
                    f.body.as_ref().map_or(false, |b| {
                        b.statements.iter().any(|s| stmt_has_identifier_reference(s, name))
                    })
                }
                _ => {
                    if let Some(expr) = exp.declaration.as_expression() {
                        expr_has_identifier_reference(expr, name)
                    } else {
                        false
                    }
                }
            }
        }
        Statement::ExportDeclaration(exp) => {
            decl_has_identifier_reference(&exp.declaration, name)
        }
        Statement::ExportNamedDeclaration(exp) => {
            exp.specifiers.iter().any(|s| s.local.name().as_str() == name)
        }
        _ => false,
    }
}

fn decl_has_identifier_reference(decl: &Declaration, name: &str) -> bool {
    match decl {
        Declaration::VariableDeclaration(v) => {
            v.declarations.iter().any(|d| {
                d.init.as_ref().map_or(false, |init| expr_has_identifier_reference(init, name))
            })
        }
        Declaration::ClassDeclaration(c) => class_has_identifier_reference(c, name),
        Declaration::FunctionDeclaration(f) => {
            f.body.as_ref().map_or(false, |b| {
                b.statements.iter().any(|s| stmt_has_identifier_reference(s, name))
            })
        }
        _ => false,
    }
}

fn class_has_identifier_reference(class: &Class, name: &str) -> bool {
    if class
        .heritage
        .as_ref()
        .map_or(false, |h| expr_has_identifier_reference(&h.expression, name))
    {
        return true;
    }
    class.decorators.iter().any(|d| expr_has_identifier_reference(&d.expression, name))
        || class.body.body.iter().any(|elem| match elem {
            ClassElement::MethodDefinition(m) => {
                m.decorators.iter().any(|d| expr_has_identifier_reference(&d.expression, name))
                    || m.value.body.as_ref().map_or(false, |b| {
                        b.statements.iter().any(|s| stmt_has_identifier_reference(s, name))
                    })
            }
            ClassElement::PropertyDefinition(p) => {
                p.decorators.iter().any(|d| expr_has_identifier_reference(&d.expression, name))
                    || p.value.as_ref().map_or(false, |v| expr_has_identifier_reference(v, name))
            }
            ClassElement::StaticBlock(b) => {
                b.body.iter().any(|s| stmt_has_identifier_reference(s, name))
            }
            ClassElement::AccessorProperty(a) => {
                a.decorators.iter().any(|d| expr_has_identifier_reference(&d.expression, name))
                    || a.value.as_ref().map_or(false, |v| expr_has_identifier_reference(v, name))
            }
            _ => false,
        })
}

fn expr_has_identifier_reference(expr: &Expression, name: &str) -> bool {
    match expr {
        Expression::Identifier(id) => id.name == name,
        Expression::CallExpression(call) => {
            expr_has_identifier_reference(&call.callee, name)
                || call.arguments.iter().any(|arg| {
                    arg.as_expression().map_or(false, |e| expr_has_identifier_reference(e, name))
                })
        }
        Expression::StaticMemberExpression(mem) => {
            expr_has_identifier_reference(&mem.object, name)
        }
        Expression::ComputedMemberExpression(mem) => {
            expr_has_identifier_reference(&mem.object, name)
                || expr_has_identifier_reference(&mem.expression, name)
        }
        Expression::AssignmentExpression(assign) => {
            expr_has_identifier_reference(&assign.right, name)
        }
        Expression::BinaryExpression(bin) => {
            expr_has_identifier_reference(&bin.left, name)
                || expr_has_identifier_reference(&bin.right, name)
        }
        Expression::UnaryExpression(unary) => {
            expr_has_identifier_reference(&unary.argument, name)
        }
        Expression::LogicalExpression(log) => {
            expr_has_identifier_reference(&log.left, name)
                || expr_has_identifier_reference(&log.right, name)
        }
        Expression::ConditionalExpression(cond) => {
            expr_has_identifier_reference(&cond.test, name)
                || expr_has_identifier_reference(&cond.consequent, name)
                || expr_has_identifier_reference(&cond.alternate, name)
        }
        Expression::SequenceExpression(seq) => {
            seq.expressions.iter().any(|e| expr_has_identifier_reference(e, name))
        }
        Expression::ParenthesizedExpression(p) => {
            expr_has_identifier_reference(&p.expression, name)
        }
        Expression::ArrayExpression(arr) => {
            arr.elements.iter().any(|elem| {
                elem.as_expression().map_or(false, |e| expr_has_identifier_reference(e, name))
            })
        }
        Expression::ObjectExpression(obj) => {
            obj.properties.iter().any(|prop| {
                match prop {
                    ObjectPropertyKind::ObjectProperty(p) => {
                        expr_has_identifier_reference(&p.value, name)
                    }
                    ObjectPropertyKind::SpreadProperty(p) => {
                        expr_has_identifier_reference(&p.argument, name)
                    }
                }
            })
        }
        Expression::FunctionExpression(func) => {
            func.body.as_ref().map_or(false, |b| {
                b.statements.iter().any(|s| stmt_has_identifier_reference(s, name))
            })
        }
        Expression::ArrowFunctionExpression(arrow) => match &arrow.body {
            ArrowFunctionBody::FunctionBody(b) => {
                b.statements.iter().any(|s| stmt_has_identifier_reference(s, name))
            }
            _ => {
                if let Some(expr) = arrow.body.as_expression() {
                    expr_has_identifier_reference(expr, name)
                } else {
                    false
                }
            }
        },
        Expression::ClassExpression(class) => {
            class_has_identifier_reference(class, name)
        }
        Expression::TemplateLiteral(tmpl) => {
            tmpl.expressions.iter().any(|e| expr_has_identifier_reference(e, name))
        }
        Expression::TaggedTemplateExpression(tagged) => {
            expr_has_identifier_reference(&tagged.tag, name)
                || tagged.quasi.expressions.iter().any(|e| expr_has_identifier_reference(e, name))
        }
        Expression::NewExpression(new_expr) => {
            expr_has_identifier_reference(&new_expr.callee, name)
                || new_expr.arguments.iter().any(|arg| {
                    arg.as_expression().map_or(false, |e| expr_has_identifier_reference(e, name))
                })
        }
        Expression::AwaitExpression(aw) => {
            expr_has_identifier_reference(&aw.argument, name)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_custom_element_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {customElement} from 'lit/decorators.js';

      @customElement('my-element')
      class MyElement extends LitElement {}
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@customElement"));
        assert!(
            res.code
                .contains("customElements.define(\"my-element\", MyElement)")
                || res
                    .code
                    .contains("customElements.define('my-element', MyElement)")
        );
        assert!(!res.code.contains("decorators.js"));
    }

    #[test]
    fn test_property_and_constructor_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {property} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @property({type: String})
        foo = 'bar';
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@property"));
        assert!(res.code.contains("static properties"));
        assert!(
            res.code.contains("foo: { type: String }")
                || res.code.contains("foo:{type:String}")
                || res.code.contains("type: String")
        );
        assert!(res.code.contains("constructor"));
        assert!(res.code.contains("super()"));
        assert!(res.code.contains("this.foo = 'bar'") || res.code.contains("this.foo = \"bar\""));
    }

    #[test]
    fn test_state_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {state} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @state()
        count = 0;
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@state"));
        assert!(res.code.contains("state: true") || res.code.contains("state:true"));
    }

    #[test]
    fn test_query_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {query} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @query('#myDiv')
        div: HTMLDivElement;
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@query"));
        assert!(res.code.contains("get div()"));
        assert!(res.code.contains("querySelector"));
    }

    #[test]
    fn test_query_all_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {queryAll} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @queryAll('.items')
        items: NodeList;
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@queryAll"));
        assert!(res.code.contains("get items()"));
        assert!(res.code.contains("querySelectorAll"));
    }

    #[test]
    fn test_query_async_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {queryAsync} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @queryAsync('#btn')
        btn: Promise<HTMLElement>;
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@queryAsync"));
        assert!(res.code.contains("get btn()"));
        assert!(res.code.contains("this.updateComplete.then"));
        assert!(res.code.contains("querySelector"));
    }

    #[test]
    fn test_query_assigned_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {queryAssignedElements, queryAssignedNodes} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @queryAssignedElements({slot: 'header'})
        headers: HTMLElement[];

        @queryAssignedNodes()
        nodes: Node[];
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@queryAssignedElements"));
        assert!(!res.code.contains("@queryAssignedNodes"));
        assert!(res.code.contains("get headers()"));
        assert!(res.code.contains("assignedElements"));
        assert!(res.code.contains("slot[name=header]"));
        assert!(res.code.contains("get nodes()"));
        assert!(res.code.contains("assignedNodes"));
        assert!(res.code.contains("slot:not([name])"));
    }

    #[test]
    fn test_event_options_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {eventOptions} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @eventOptions({passive: true})
        handleClick(e) {
          console.log(e);
        }
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@eventOptions"));
        assert!(
            res.code
                .contains("Object.assign(MyElement.prototype.handleClick, { passive: true })")
                || res.code.contains("passive: true")
        );
    }

    #[test]
    fn test_localized_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {localized} from '@lit/localize';

      @localized()
      class MyElement extends LitElement {}
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@localized"));
        assert!(
            res.code
                .contains("import { updateWhenLocaleChanges } from \"@lit/localize\"")
                || res.code.contains("updateWhenLocaleChanges")
        );
        assert!(res.code.contains("updateWhenLocaleChanges(this)"));
    }

    #[test]
    fn test_existing_static_properties_merge() {
        let input = r#"
      import {LitElement} from 'lit';
      import {property} from 'lit/decorators.js';

      class MyElement extends LitElement {
        static properties = {
          existing: {type: Number},
        };

        @property({type: String})
        name = 'hello';
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@property"));
        assert!(res.code.contains("existing: { type: Number }") || res.code.contains("existing"));
        assert!(res.code.contains("name: { type: String }") || res.code.contains("name"));
        assert!(
            res.code.contains("this.name = 'hello'") || res.code.contains("this.name = \"hello\"")
        );
    }

    #[test]
    fn test_existing_constructor_append() {
        let input = r#"
      import {LitElement} from 'lit';
      import {property} from 'lit/decorators.js';

      class MyElement extends LitElement {
        constructor() {
          super();
          console.log('init');
        }

        @property()
        msg = 'hi';
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@property"));
        assert!(
            res.code.contains("console.log(\"init\")") || res.code.contains("console.log('init')")
        );
        assert!(res.code.contains("this.msg = \"hi\"") || res.code.contains("this.msg = 'hi'"));
    }

    #[test]
    fn test_compiled_decorate_property() {
        let input = r#"
      import {property} from 'lit/decorators.js';
      class MyElement {}
      __decorate([
        property({type: String})
      ], MyElement.prototype, "label", void 0);
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("__decorate"));
        assert!(res
            .code
            .contains("MyElement.createProperty(\"label\", { type: String })"));
        assert!(!res.code.contains("lit/decorators.js"));
    }

    #[test]
    fn test_compiled_decorate_custom_element() {
        let input = r#"
      import {customElement} from 'lit/decorators.js';
      let MyElement = class MyElement {};
      MyElement = __decorate([
        customElement('my-element')
      ], MyElement);
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("__decorate"));
        assert!(res
            .code
            .contains("customElements.define(\"my-element\", MyElement)"));
        assert!(!res.code.contains("lit/decorators.js"));
    }
}
