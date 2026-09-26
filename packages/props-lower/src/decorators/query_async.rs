use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::ast_helpers::AstHelper;
use crate::decorators::property::get_lit_decorator_kind;
use crate::lit_import_scanner::{ImportContext, LitDecoratorKind};

pub fn try_transform_query_async<'a>(
    element: &mut ClassElement<'a>,
    import_ctx: &ImportContext,
    ast: &AstBuilder<'a>,
) -> Option<ClassElement<'a>> {
    let ClassElement::PropertyDefinition(prop_def) = element else {
        return None;
    };

    let mut selector = None;
    let mut has_query_async = false;

    for dec in &prop_def.decorators {
        if let Some(kind) = get_lit_decorator_kind(&dec.expression, import_ctx) {
            if kind == LitDecoratorKind::QueryAsync {
                has_query_async = true;
                if let Expression::CallExpression(call) = &dec.expression {
                    if let Some(arg0) = call.arguments.first() {
                        if let Some(Expression::StringLiteral(lit)) = arg0.as_expression() {
                            selector = Some(lit.value.as_str().to_string());
                        }
                    }
                }
                break;
            }
        }
    }

    if !has_query_async {
        return None;
    }

    let selector_str = selector?;
    let prop_name = prop_def.key.static_name()?.to_string();

    let helper = AstHelper::new(ast);

    // () => this.renderRoot?.querySelector('selector')
    let this_inner = helper.this_expr();
    let render_root = helper.static_member(this_inner, "renderRoot", false);
    let query_selector_member = helper.static_member(render_root, "querySelector", true);

    let mut query_args = ArenaVec::new_in(ast);
    query_args.push(Argument::from(
        helper.string_lit(ast.allocator().alloc_str(&selector_str)),
    ));

    let query_call = helper.call_expr(query_selector_member, query_args, false);
    let arrow_params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        ArenaVec::new_in(ast),
        None,
        ast,
    );
    let arrow_body = ArrowFunctionBody::from(query_call);
    let arrow_func = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        arrow_params,
        None,
        arrow_body,
        ast,
    );

    // this.updateComplete.then(...)
    let this_outer = helper.this_expr();
    let update_complete = helper.static_member(this_outer, "updateComplete", false);
    let then_member = helper.static_member(update_complete, "then", false);

    let mut then_args = ArenaVec::new_in(ast);
    then_args.push(Argument::from(arrow_func));

    let return_expr = helper.call_expr(then_member, then_args, false);

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
