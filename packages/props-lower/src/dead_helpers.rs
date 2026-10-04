use oxc_allocator::ArenaVec;
use oxc_ast::ast::*;

pub fn strip_dead_decorator_helpers<'a>(statements: &mut ArenaVec<'a, Statement<'a>>) {
    let decorate_used = is_identifier_used_in_statements(statements, "__decorate")
        || is_identifier_used_in_statements(statements, "__decorateClass")
        || is_identifier_used_in_statements(statements, "_ts_decorate");
    let metadata_used = is_identifier_used_in_statements(statements, "__metadata");

    if decorate_used && metadata_used {
        return;
    }

    statements.retain_mut(|stmt| match stmt {
        Statement::VariableDeclaration(var_decl) => {
            var_decl.declarations.retain(|decl| {
                if let BindingPattern::BindingIdentifier(id) = &decl.id {
                    let name = id.name.as_str();
                    let is_decorate =
                        name == "__decorate" || name == "__decorateClass" || name == "_ts_decorate";
                    let is_metadata = name == "__metadata";
                    let remove = (!decorate_used && is_decorate) || (!metadata_used && is_metadata);
                    !remove
                } else {
                    true
                }
            });
            !var_decl.declarations.is_empty()
        }
        Statement::ImportDeclaration(import_decl) => {
            if let Some(specifiers) = &mut import_decl.specifiers {
                specifiers.retain(|spec| match spec {
                    ImportDeclarationSpecifier::ImportSpecifier(s) => {
                        let name = s.local.name.as_str();
                        let is_decorate = name == "__decorate"
                            || name == "__decorateClass"
                            || name == "_ts_decorate";
                        let is_metadata = name == "__metadata";
                        let remove =
                            (!decorate_used && is_decorate) || (!metadata_used && is_metadata);
                        !remove
                    }
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                        let name = s.local.name.as_str();
                        let is_decorate = name == "__decorate"
                            || name == "__decorateClass"
                            || name == "_ts_decorate";
                        !(!decorate_used && is_decorate)
                    }
                    _ => true,
                });
                !specifiers.is_empty()
            } else {
                true
            }
        }
        _ => true,
    });
}

pub fn is_identifier_used_in_statements<'a>(statements: &[Statement<'a>], name: &str) -> bool {
    statements
        .iter()
        .any(|s| stmt_has_identifier_reference(s, name))
}

fn stmt_has_identifier_reference(stmt: &Statement, name: &str) -> bool {
    match stmt {
        Statement::ExpressionStatement(e) => expr_has_identifier_reference(&e.expression, name),
        Statement::VariableDeclaration(var_decl) => var_decl.declarations.iter().any(|d| {
            d.init
                .as_ref()
                .is_some_and(|init| expr_has_identifier_reference(init, name))
        }),
        Statement::ClassDeclaration(class) => class_has_identifier_reference(class, name),
        Statement::FunctionDeclaration(func) => func.body.as_ref().is_some_and(|b| {
            b.statements
                .iter()
                .any(|s| stmt_has_identifier_reference(s, name))
        }),
        Statement::ReturnStatement(ret) => ret
            .argument
            .as_ref()
            .is_some_and(|arg| expr_has_identifier_reference(arg, name)),
        Statement::IfStatement(if_stmt) => {
            expr_has_identifier_reference(&if_stmt.test, name)
                || stmt_has_identifier_reference(&if_stmt.consequent, name)
                || if_stmt
                    .alternate
                    .as_ref()
                    .is_some_and(|alt| stmt_has_identifier_reference(alt, name))
        }
        Statement::BlockStatement(block) => block
            .body
            .iter()
            .any(|s| stmt_has_identifier_reference(s, name)),
        Statement::ForStatement(for_stmt) => {
            for_stmt.init.as_ref().is_some_and(|init| match init {
                ForStatementInit::VariableDeclaration(v) => v.declarations.iter().any(|d| {
                    d.init
                        .as_ref()
                        .is_some_and(|i| expr_has_identifier_reference(i, name))
                }),
                _ => init
                    .as_expression()
                    .is_some_and(|e| expr_has_identifier_reference(e, name)),
            }) || for_stmt
                .test
                .as_ref()
                .is_some_and(|test| expr_has_identifier_reference(test, name))
                || for_stmt
                    .update
                    .as_ref()
                    .is_some_and(|up| expr_has_identifier_reference(up, name))
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
                    c.test
                        .as_ref()
                        .is_some_and(|t| expr_has_identifier_reference(t, name))
                        || c.consequent
                            .iter()
                            .any(|s| stmt_has_identifier_reference(s, name))
                })
        }
        Statement::ThrowStatement(throw_stmt) => {
            expr_has_identifier_reference(&throw_stmt.argument, name)
        }
        Statement::TryStatement(try_stmt) => {
            try_stmt
                .block
                .body
                .iter()
                .any(|s| stmt_has_identifier_reference(s, name))
                || try_stmt.handler.as_ref().is_some_and(|h| {
                    h.body
                        .body
                        .iter()
                        .any(|s| stmt_has_identifier_reference(s, name))
                })
                || try_stmt.finalizer.as_ref().is_some_and(|f| {
                    f.body
                        .iter()
                        .any(|s| stmt_has_identifier_reference(s, name))
                })
        }
        Statement::ExportDefaultDeclaration(exp) => match &exp.declaration {
            ExportDefaultDeclarationKind::ClassDeclaration(c) => {
                class_has_identifier_reference(c, name)
            }
            ExportDefaultDeclarationKind::FunctionDeclaration(f) => {
                f.body.as_ref().is_some_and(|b| {
                    b.statements
                        .iter()
                        .any(|s| stmt_has_identifier_reference(s, name))
                })
            }
            _ => {
                if let Some(expr) = exp.declaration.as_expression() {
                    expr_has_identifier_reference(expr, name)
                } else {
                    false
                }
            }
        },
        Statement::ExportDeclaration(exp) => decl_has_identifier_reference(&exp.declaration, name),
        Statement::ExportNamedDeclaration(exp) => exp
            .specifiers
            .iter()
            .any(|s| s.local.name().as_str() == name),
        _ => false,
    }
}

fn decl_has_identifier_reference(decl: &Declaration, name: &str) -> bool {
    match decl {
        Declaration::VariableDeclaration(v) => v.declarations.iter().any(|d| {
            d.init
                .as_ref()
                .is_some_and(|init| expr_has_identifier_reference(init, name))
        }),
        Declaration::ClassDeclaration(c) => class_has_identifier_reference(c, name),
        Declaration::FunctionDeclaration(f) => f.body.as_ref().is_some_and(|b| {
            b.statements
                .iter()
                .any(|s| stmt_has_identifier_reference(s, name))
        }),
        _ => false,
    }
}

fn class_has_identifier_reference(class: &Class, name: &str) -> bool {
    if class
        .heritage
        .as_ref()
        .is_some_and(|h| expr_has_identifier_reference(&h.expression, name))
    {
        return true;
    }
    class
        .decorators
        .iter()
        .any(|d| expr_has_identifier_reference(&d.expression, name))
        || class.body.body.iter().any(|elem| match elem {
            ClassElement::MethodDefinition(m) => {
                m.decorators
                    .iter()
                    .any(|d| expr_has_identifier_reference(&d.expression, name))
                    || m.value.body.as_ref().is_some_and(|b| {
                        b.statements
                            .iter()
                            .any(|s| stmt_has_identifier_reference(s, name))
                    })
            }
            ClassElement::PropertyDefinition(p) => {
                p.decorators
                    .iter()
                    .any(|d| expr_has_identifier_reference(&d.expression, name))
                    || p.value
                        .as_ref()
                        .is_some_and(|v| expr_has_identifier_reference(v, name))
            }
            ClassElement::StaticBlock(b) => b
                .body
                .iter()
                .any(|s| stmt_has_identifier_reference(s, name)),
            ClassElement::AccessorProperty(a) => {
                a.decorators
                    .iter()
                    .any(|d| expr_has_identifier_reference(&d.expression, name))
                    || a.value
                        .as_ref()
                        .is_some_and(|v| expr_has_identifier_reference(v, name))
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
                    arg.as_expression()
                        .is_some_and(|e| expr_has_identifier_reference(e, name))
                })
        }
        Expression::StaticMemberExpression(mem) => expr_has_identifier_reference(&mem.object, name),
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
        Expression::UnaryExpression(unary) => expr_has_identifier_reference(&unary.argument, name),
        Expression::LogicalExpression(log) => {
            expr_has_identifier_reference(&log.left, name)
                || expr_has_identifier_reference(&log.right, name)
        }
        Expression::ConditionalExpression(cond) => {
            expr_has_identifier_reference(&cond.test, name)
                || expr_has_identifier_reference(&cond.consequent, name)
                || expr_has_identifier_reference(&cond.alternate, name)
        }
        Expression::SequenceExpression(seq) => seq
            .expressions
            .iter()
            .any(|e| expr_has_identifier_reference(e, name)),
        Expression::ParenthesizedExpression(p) => {
            expr_has_identifier_reference(&p.expression, name)
        }
        Expression::ArrayExpression(arr) => arr.elements.iter().any(|elem| {
            elem.as_expression()
                .is_some_and(|e| expr_has_identifier_reference(e, name))
        }),
        Expression::ObjectExpression(obj) => obj.properties.iter().any(|prop| match prop {
            ObjectPropertyKind::ObjectProperty(p) => expr_has_identifier_reference(&p.value, name),
            ObjectPropertyKind::SpreadProperty(p) => {
                expr_has_identifier_reference(&p.argument, name)
            }
        }),
        Expression::FunctionExpression(func) => func.body.as_ref().is_some_and(|b| {
            b.statements
                .iter()
                .any(|s| stmt_has_identifier_reference(s, name))
        }),
        Expression::ArrowFunctionExpression(arrow) => match &arrow.body {
            ArrowFunctionBody::FunctionBody(b) => b
                .statements
                .iter()
                .any(|s| stmt_has_identifier_reference(s, name)),
            _ => {
                if let Some(expr) = arrow.body.as_expression() {
                    expr_has_identifier_reference(expr, name)
                } else {
                    false
                }
            }
        },
        Expression::ClassExpression(class) => class_has_identifier_reference(class, name),
        Expression::TemplateLiteral(tmpl) => tmpl
            .expressions
            .iter()
            .any(|e| expr_has_identifier_reference(e, name)),
        Expression::TaggedTemplateExpression(tagged) => {
            expr_has_identifier_reference(&tagged.tag, name)
                || tagged
                    .quasi
                    .expressions
                    .iter()
                    .any(|e| expr_has_identifier_reference(e, name))
        }
        Expression::NewExpression(new_expr) => {
            expr_has_identifier_reference(&new_expr.callee, name)
                || new_expr.arguments.iter().any(|arg| {
                    arg.as_expression()
                        .is_some_and(|e| expr_has_identifier_reference(e, name))
                })
        }
        Expression::AwaitExpression(aw) => expr_has_identifier_reference(&aw.argument, name),
        _ => false,
    }
}
