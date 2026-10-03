use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::ast_helpers::AstHelper;
use crate::decorators::property::get_lit_decorator_kind;
use crate::lit_import_scanner::{ImportContext, LitDecoratorKind};

pub fn try_transform_query_assigned<'a>(
    element: &mut ClassElement<'a>,
    import_ctx: &ImportContext,
    ast: &AstBuilder<'a>,
) -> Option<ClassElement<'a>> {
    let ClassElement::PropertyDefinition(prop_def) = element else {
        return None;
    };

    let mut method_name = None;
    let mut slot_name = None;
    let mut flatten = None;
    let mut selector = None;

    for dec in &prop_def.decorators {
        if let Some(kind) = get_lit_decorator_kind(&dec.expression, import_ctx) {
            match kind {
                LitDecoratorKind::QueryAssignedElements => {
                    method_name = Some("assignedElements");
                }
                LitDecoratorKind::QueryAssignedNodes => {
                    method_name = Some("assignedNodes");
                }
                _ => {}
            }

            if method_name.is_some() {
                let (s_name, flat, sel) = extract_query_assigned_options(&dec.expression);
                slot_name = s_name;
                flatten = flat;
                selector = sel;
                break;
            }
        }
    }

    let method = method_name?;
    let prop_name = prop_def.key.static_name()?.to_string();

    let return_expr = build_query_assigned_return_expr(
        method,
        slot_name.as_deref(),
        flatten,
        selector.as_deref(),
        ast,
    );

    let mut statements = ArenaVec::new_in(ast);
    statements.push(Statement::new_return_statement(
        SPAN,
        Some(return_expr),
        ast,
    ));

    let func_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), statements, ast);
    let params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        ArenaVec::new_in(ast),
        None,
        ast,
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
        ast,
    );

    let getter_key =
        PropertyKey::new_static_identifier(SPAN, ast.allocator().alloc_str(&prop_name), ast);
    let getter = ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        getter_key,
        func,
        MethodDefinitionKind::Get,
        false,
        false,
        false,
        false,
        None,
        ast,
    );

    Some(getter)
}

pub fn extract_query_assigned_options<'a>(
    expr: &Expression<'a>,
) -> (Option<String>, Option<bool>, Option<String>) {
    let mut slot_name = None;
    let mut flatten = None;
    let mut selector = None;

    if let Expression::CallExpression(call) = expr {
        if let Some(arg0) = call.arguments.first() {
            if let Some(Expression::ObjectExpression(obj)) = arg0.as_expression() {
                for prop in &obj.properties {
                    if let ObjectPropertyKind::ObjectProperty(p) = prop {
                        if let Some(key_name) = p.key.static_name() {
                            match key_name.as_ref() {
                                "slot" => {
                                    if let Expression::StringLiteral(s) = &p.value {
                                        slot_name = Some(s.value.as_str().to_string());
                                    }
                                }
                                "flatten" => {
                                    if let Expression::BooleanLiteral(b) = &p.value {
                                        flatten = Some(b.value);
                                    }
                                }
                                "selector" => {
                                    if let Expression::StringLiteral(s) = &p.value {
                                        selector = Some(s.value.as_str().to_string());
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
    }

    (slot_name, flatten, selector)
}

pub fn build_query_assigned_return_expr<'a>(
    method: &'a str,
    slot_name: Option<&str>,
    flatten: Option<bool>,
    selector: Option<&str>,
    ast: &AstBuilder<'a>,
) -> Expression<'a> {
    let helper = AstHelper::new(ast);

    // Slot selector string
    let slot_selector = match slot_name {
        Some(slot) => format!("slot[name={}]", slot),
        None => "slot:not([name])".to_string(),
    };

    // this.renderRoot?.querySelector(...)?.assignedElements/Nodes(...)
    let this = helper.this_expr();
    let render_root = helper.static_member(this, "renderRoot", false);
    let query_selector_member = helper.static_member(render_root, "querySelector", true);

    let mut qs_args = ArenaVec::new_in(ast);
    qs_args.push(Argument::from(
        helper.string_lit(ast.allocator().alloc_str(&slot_selector)),
    ));
    let qs_call = helper.call_expr(query_selector_member, qs_args, false);

    let assigned_member = helper.static_member(qs_call, method, true);

    let mut assigned_args = ArenaVec::new_in(ast);
    if let Some(flat) = flatten {
        let mut obj_props = ArenaVec::new_in(ast);
        let key = PropertyKey::new_static_identifier(SPAN, "flatten", ast);
        let val = helper.bool_lit(flat);
        obj_props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key,
            val,
            false,
            false,
            false,
            ast,
        ));
        let opts_obj = Expression::new_object_expression(SPAN, obj_props, ast);
        assigned_args.push(Argument::from(opts_obj));
    }

    let assigned_call = helper.call_expr(assigned_member, assigned_args, false);

    // Optional: ?.filter(node => node.matches('selector'))
    let result_expr = if let Some(sel) = selector {
        let filter_member = helper.static_member(assigned_call, "filter", true);

        // node => node.matches('selector')
        let node_ident_name = "node";
        let node_ref = helper.ident_ref(node_ident_name);
        let matches_member = helper.static_member(node_ref, "matches", false);

        let mut matches_args = ArenaVec::new_in(ast);
        matches_args.push(Argument::from(
            helper.string_lit(ast.allocator().alloc_str(sel)),
        ));
        let matches_call = helper.call_expr(matches_member, matches_args, false);

        let mut arrow_params = ArenaVec::new_in(ast);
        let param_pattern = BindingPattern::new_binding_identifier(SPAN, node_ident_name, ast);
        let formal_param = FormalParameter::new_plain(SPAN, param_pattern, ast);
        arrow_params.push(formal_param);

        let arrow_params_box = FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            arrow_params,
            None,
            ast,
        );

        let arrow = Expression::new_arrow_function_expression(
            SPAN,
            false,
            None,
            arrow_params_box,
            None,
            ArrowFunctionBody::from(matches_call),
            ast,
        );

        let mut filter_args = ArenaVec::new_in(ast);
        filter_args.push(Argument::from(arrow));
        helper.call_expr(filter_member, filter_args, false)
    } else {
        assigned_call
    };

    // result ?? []
    let empty_arr = helper.empty_array();
    helper.nullish_coalescing(result_expr, empty_arr)
}
