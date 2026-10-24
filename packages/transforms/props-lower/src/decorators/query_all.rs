use lit_analysis::symbol::{CanonicalLitSymbol, SymbolProofContext};
use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::ast_helpers::AstHelper;

pub fn try_transform_query_all<'a>(
    element: &mut ClassElement<'a>,
    symbol_ctx: &SymbolProofContext<'_>,
    ast: &AstBuilder<'a>,
) -> Option<ClassElement<'a>> {
    let ClassElement::PropertyDefinition(prop_def) = element else {
        return None;
    };

    let mut selector = None;
    let mut has_query_all = false;

    for dec in &prop_def.decorators {
        if symbol_ctx.resolve_decorator(dec) == Some(CanonicalLitSymbol::QueryAllDecorator) {
            has_query_all = true;
            if let Expression::CallExpression(call) = &dec.expression
                && let Some(arg0) = call.arguments.first()
                && let Some(Expression::StringLiteral(lit)) = arg0.as_expression()
            {
                selector = Some(lit.value.as_str().to_string());
            }
            break;
        }
    }

    if !has_query_all {
        return None;
    }

    let selector_str = selector?;
    let prop_name = prop_def.key.static_name()?.to_string();

    let helper = AstHelper::new(ast);

    // this.renderRoot?.querySelectorAll('selector') ?? []
    let this = helper.this_expr();
    let render_root = helper.static_member(this, "renderRoot", false);
    let query_selector_all_member = helper.static_member(render_root, "querySelectorAll", true);

    let mut args = ArenaVec::new_in(ast);
    args.push(Argument::from(
        helper.string_lit(ast.allocator().alloc_str(&selector_str)),
    ));

    let query_call = helper.call_expr(query_selector_all_member, args, false);
    let empty_arr = helper.empty_array();
    let return_expr = helper.nullish_coalescing(query_call, empty_arr);

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
