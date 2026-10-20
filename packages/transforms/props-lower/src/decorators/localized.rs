use lit_analysis::symbol::{CanonicalLitSymbol, SymbolProofContext};
use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::ast_helpers::AstHelper;

/// Checks if class has `@localized()`.
/// If found, removes the decorator and returns `updateWhenLocaleChanges(this);` constructor statement.
pub fn transform_localized<'a>(
    class: &mut Class<'a>,
    symbol_ctx: &SymbolProofContext<'_>,
    ast: &AstBuilder<'a>,
) -> Option<Statement<'a>> {
    let mut remove_index = None;
    let mut binding_name = "updateWhenLocaleChanges";
    let mut namespace_name: Option<String> = None;

    for (i, dec) in class.decorators.iter().enumerate() {
        if symbol_ctx.resolve_decorator(dec) == Some(CanonicalLitSymbol::LocalizedDecorator) {
            remove_index = Some(i);
            match &dec.expression {
                Expression::CallExpression(call) => match &call.callee {
                    Expression::Identifier(id) => {
                        if id.name != "localized" {
                            binding_name = ast.allocator().alloc_str(id.name.as_str());
                        }
                    }
                    Expression::StaticMemberExpression(mem) => {
                        if let Expression::Identifier(obj) = &mem.object {
                            namespace_name = Some(obj.name.as_str().to_string());
                        }
                    }
                    _ => {}
                },
                Expression::Identifier(id) => {
                    if id.name != "localized" {
                        binding_name = ast.allocator().alloc_str(id.name.as_str());
                    }
                }
                Expression::StaticMemberExpression(mem) => {
                    if let Expression::Identifier(obj) = &mem.object {
                        namespace_name = Some(obj.name.as_str().to_string());
                    }
                }
                _ => {}
            }
            break;
        }
    }

    let idx = remove_index?;
    class.decorators.remove(idx);

    // updateWhenLocaleChanges(this) or loc.updateWhenLocaleChanges(this)
    let helper = AstHelper::new(ast);
    let callee = if let Some(ns) = namespace_name {
        let ns_ident = helper.ident_ref(ast.allocator().alloc_str(&ns));
        helper.static_member(ns_ident, "updateWhenLocaleChanges", false)
    } else {
        helper.ident_ref(binding_name)
    };
    let mut args = ArenaVec::new_in(ast);
    args.push(Argument::from(helper.this_expr()));

    let call = helper.call_expr(callee, args, false);
    Some(Statement::new_expression_statement(SPAN, call, ast))
}
