use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::ast_helpers::AstHelper;
use crate::lit_import_scanner::{ImportContext, LitDecoratorKind};

/// Checks if class has `@localized()`.
/// If found, removes the decorator and returns `updateWhenLocaleChanges(this);` constructor statement.
pub fn transform_localized<'a>(
    class: &mut Class<'a>,
    import_ctx: &ImportContext,
    ast: &AstBuilder<'a>,
) -> Option<Statement<'a>> {
    let mut remove_index = None;
    let mut binding_name = "updateWhenLocaleChanges";

    for (i, dec) in class.decorators.iter().enumerate() {
        if let Some(kind) =
            crate::decorators::property::get_lit_decorator_kind(&dec.expression, import_ctx)
        {
            if kind == LitDecoratorKind::Localized {
                remove_index = Some(i);
                let callee_ident = match &dec.expression {
                    Expression::CallExpression(call) => match &call.callee {
                        Expression::Identifier(id) => Some(id.name.as_str()),
                        _ => None,
                    },
                    Expression::Identifier(id) => Some(id.name.as_str()),
                    _ => None,
                };
                if let Some(ident) = callee_ident {
                    if ident != "localized" {
                        binding_name = ast.allocator().alloc_str(ident);
                    }
                }
                break;
            }
        }
    }

    let idx = remove_index?;
    class.decorators.remove(idx);

    // updateWhenLocaleChanges(this);
    let helper = AstHelper::new(ast);
    let callee = helper.ident_ref(binding_name);
    let mut args = ArenaVec::new_in(ast);
    args.push(Argument::from(helper.this_expr()));

    let call = helper.call_expr(callee, args, false);
    Some(Statement::new_expression_statement(SPAN, call, ast))
}
