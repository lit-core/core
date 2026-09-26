use oxc_allocator::{CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;

use crate::ast_helpers::AstHelper;
use crate::lit_import_scanner::{ImportContext, LitDecoratorKind};
use crate::static_properties::ReactiveProp;

pub struct PropertyTransformResult<'a> {
    pub reactive_prop: ReactiveProp<'a>,
    pub constructor_init: Option<Statement<'a>>,
    pub remove_member: bool,
}

pub fn try_transform_property<'a>(
    element: &mut ClassElement<'a>,
    import_ctx: &ImportContext,
    ast: &AstBuilder<'a>,
) -> Option<PropertyTransformResult<'a>> {
    match element {
        ClassElement::PropertyDefinition(prop_def) => {
            let mut decorator_idx = None;
            let mut options = None;

            for (i, dec) in prop_def.decorators.iter().enumerate() {
                if let Some(kind) = get_lit_decorator_kind(&dec.expression, import_ctx) {
                    if kind == LitDecoratorKind::Property {
                        decorator_idx = Some(i);
                        options = extract_options(&dec.expression, ast);
                        break;
                    }
                }
            }

            let idx = decorator_idx?;
            prop_def.decorators.remove(idx);

            let prop_name = prop_def.key.static_name()?.to_string();

            let helper = AstHelper::new(ast);
            let constructor_init = prop_def.value.take().map(|val| {
                let name_str = ast.allocator().alloc_str(&prop_name);
                helper.this_prop_assign(name_str, val)
            });

            Some(PropertyTransformResult {
                reactive_prop: ReactiveProp {
                    name: prop_name,
                    options,
                },
                constructor_init,
                remove_member: true,
            })
        }
        ClassElement::MethodDefinition(method_def) => {
            if method_def.kind != MethodDefinitionKind::Get {
                return None;
            }

            let mut decorator_idx = None;
            let mut options = None;

            for (i, dec) in method_def.decorators.iter().enumerate() {
                if let Some(kind) = get_lit_decorator_kind(&dec.expression, import_ctx) {
                    if kind == LitDecoratorKind::Property {
                        decorator_idx = Some(i);
                        options = extract_options(&dec.expression, ast);
                        break;
                    }
                }
            }

            let idx = decorator_idx?;
            method_def.decorators.remove(idx);

            let getter_name = method_def.key.static_name()?.to_string();

            Some(PropertyTransformResult {
                reactive_prop: ReactiveProp {
                    name: getter_name,
                    options,
                },
                constructor_init: None,
                remove_member: false,
            })
        }
        _ => None,
    }
}

pub fn get_lit_decorator_kind<'a>(
    expr: &Expression<'a>,
    import_ctx: &ImportContext,
) -> Option<LitDecoratorKind> {
    match expr {
        Expression::CallExpression(call) => match &call.callee {
            Expression::Identifier(ident) => import_ctx.get_decorator_kind(ident.name.as_str()),
            _ => None,
        },
        Expression::Identifier(ident) => import_ctx.get_decorator_kind(ident.name.as_str()),
        _ => None,
    }
}

pub fn extract_options<'a>(expr: &Expression<'a>, ast: &AstBuilder<'a>) -> Option<Expression<'a>> {
    if let Expression::CallExpression(call) = expr {
        if let Some(arg) = call.arguments.first() {
            if let Some(expr) = arg.as_expression() {
                return Some(expr.clone_in(ast.allocator()));
            }
        }
    }
    None
}
