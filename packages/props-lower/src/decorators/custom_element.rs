use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::lit_import_scanner::ImportContext;

/// Checks if class has `@customElement('tag-name')`.
/// If found, removes the decorator and returns `customElements.define('tag-name', ClassName);` statement.
pub fn transform_custom_element<'a>(
    class: &mut Class<'a>,
    import_ctx: &ImportContext,
    ast: &AstBuilder<'a>,
) -> Option<Statement<'a>> {
    let mut tag_name: Option<String> = None;
    let mut remove_index: Option<usize> = None;

    for (i, dec) in class.decorators.iter().enumerate() {
        if let Expression::CallExpression(call) = &dec.expression {
            if let Expression::Identifier(ident) = &call.callee {
                if import_ctx.get_decorator_kind(ident.name.as_str())
                    == Some(crate::lit_import_scanner::LitDecoratorKind::CustomElement)
                {
                    if let Some(first_arg) = call.arguments.first() {
                        if let Some(Expression::StringLiteral(str_lit)) = first_arg.as_expression()
                        {
                            tag_name = Some(str_lit.value.as_str().to_string());
                            remove_index = Some(i);
                            break;
                        }
                    }
                }
            }
        }
    }

    if let (Some(tag), Some(idx)) = (tag_name, remove_index) {
        class.decorators.remove(idx);

        let class_name = class.id.as_ref().map(|id| id.name.as_str())?;

        // customElements.define('tag', ClassName);
        let custom_elements_ident = Expression::new_identifier(SPAN, "customElements", ast);
        let define_ident = IdentifierName::new(SPAN, "define", ast);
        let callee = Expression::new_static_member_expression(
            SPAN,
            custom_elements_ident,
            define_ident,
            false,
            ast,
        );

        let mut args = ArenaVec::new_in(ast);
        let tag_str_lit =
            Expression::new_string_literal(SPAN, ast.allocator().alloc_str(&tag), None, ast);
        args.push(Argument::from(tag_str_lit));

        let class_ref =
            Expression::new_identifier(SPAN, ast.allocator().alloc_str(class_name), ast);
        args.push(Argument::from(class_ref));

        let call = Expression::new_call_expression(SPAN, callee, None, args, false, ast);
        Some(Statement::new_expression_statement(SPAN, call, ast))
    } else {
        None
    }
}
