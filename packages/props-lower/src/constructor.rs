use crate::ast_helpers::AstHelper;
use oxc_allocator::{ArenaVec, CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

/// Analyzes constructor property assignments (`this.disabled = false; this.size = 'lg';`),
/// hoists scalar property defaults onto the class prototype (`Component.prototype.disabled = false;`),
/// and eliminates redundant assignment statements from the constructor body.
pub fn hoist_constructor_defaults<'a>(
    class: &mut Class<'a>,
    ast: &AstBuilder<'a>,
) -> Vec<Statement<'a>> {
    let class_name = match &class.id {
        Some(id) => id.name.as_str().to_string(),
        None => return Vec::new(),
    };

    let helper = AstHelper::new(ast);
    let mut prototype_statements = Vec::new();

    for element in &mut class.body.body {
        if let ClassElement::MethodDefinition(method_def) = element {
            if method_def.kind == MethodDefinitionKind::Constructor {
                if let Some(ref mut body) = method_def.value.body {
                    let mut retained_statements = ArenaVec::new_in(ast);
                    let old_statements =
                        std::mem::replace(&mut body.statements, ArenaVec::new_in(ast));

                    for stmt in old_statements {
                        let mut hoisted = false;
                        if let Statement::ExpressionStatement(ref expr_stmt) = stmt {
                            if let Expression::AssignmentExpression(ref assign_expr) =
                                expr_stmt.expression
                            {
                                if assign_expr.operator == AssignmentOperator::Assign {
                                    if let Some(SimpleAssignmentTarget::StaticMemberExpression(
                                        mem,
                                    )) = assign_expr.left.as_simple_assignment_target()
                                    {
                                        let is_this =
                                            matches!(&mem.object, Expression::ThisExpression(_));
                                        let is_scalar = matches!(
                                            &assign_expr.right,
                                            Expression::BooleanLiteral(_)
                                                | Expression::StringLiteral(_)
                                                | Expression::NumericLiteral(_)
                                                | Expression::NullLiteral(_)
                                        );

                                        if is_this && is_scalar {
                                            let prop_name = mem.property.name.as_str();
                                            let scalar_val =
                                                assign_expr.right.clone_in(ast.allocator());

                                            // Component.prototype.prop = scalar_val;
                                            let class_ref = helper
                                                .ident_ref(ast.allocator().alloc_str(&class_name));
                                            let proto_ref =
                                                helper.static_member(class_ref, "prototype", false);
                                            let target =
                                                AssignmentTarget::new_static_member_expression(
                                                    SPAN,
                                                    proto_ref,
                                                    helper.ident_name(
                                                        ast.allocator().alloc_str(prop_name),
                                                    ),
                                                    false,
                                                    ast,
                                                );
                                            let proto_assign =
                                                Expression::new_assignment_expression(
                                                    SPAN,
                                                    AssignmentOperator::Assign,
                                                    target,
                                                    scalar_val,
                                                    ast,
                                                );
                                            let proto_stmt = helper.expr_stmt(proto_assign);
                                            prototype_statements.push(proto_stmt);
                                            hoisted = true;
                                        }
                                    }
                                }
                            }
                        }

                        if !hoisted {
                            retained_statements.push(stmt);
                        }
                    }

                    body.statements = retained_statements;
                }
                break;
            }
        }
    }

    prototype_statements
}

pub fn inject_constructor_statements<'a>(
    class: &mut Class<'a>,
    extra_statements: Vec<Statement<'a>>,
    ast: &AstBuilder<'a>,
) {
    if extra_statements.is_empty() {
        return;
    }

    // 1. Check if class already has a constructor
    for element in &mut class.body.body {
        if let ClassElement::MethodDefinition(method_def) = element {
            if method_def.kind == MethodDefinitionKind::Constructor {
                if let Some(ref mut body) = method_def.value.body {
                    for stmt in extra_statements {
                        body.statements.push(stmt);
                    }
                }
                return;
            }
        }
    }

    // 2. Synthesize a new constructor
    // constructor() {
    //   super();
    //   ...extra_statements
    // }
    let mut body_statements = ArenaVec::new_in(ast);

    // super();
    let super_expr = Expression::new_super(SPAN, ast);
    let super_call =
        Expression::new_call_expression(SPAN, super_expr, None, ArenaVec::new_in(ast), false, ast);
    body_statements.push(Statement::new_expression_statement(SPAN, super_call, ast));

    for stmt in extra_statements {
        body_statements.push(stmt);
    }

    let func_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), body_statements, ast);
    let params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        ArenaVec::new_in(ast),
        None,
        ast,
    );

    let func_expr = Function::boxed(
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

    let ctor_key = PropertyKey::new_static_identifier(SPAN, "constructor", ast);
    let ctor_element = ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        ctor_key,
        func_expr,
        MethodDefinitionKind::Constructor,
        false,
        false,
        false,
        false,
        None,
        ast,
    );

    // Position constructor: if static properties is at index 0, place constructor at index 1; else index 0.
    let insert_idx = if !class.body.body.is_empty() {
        if let ClassElement::PropertyDefinition(prop) = &class.body.body[0] {
            if prop.r#static && prop.key.is_specific_static_name("properties") {
                1
            } else {
                0
            }
        } else {
            0
        }
    } else {
        0
    };

    class.body.body.insert(insert_idx, ctor_element);
}
