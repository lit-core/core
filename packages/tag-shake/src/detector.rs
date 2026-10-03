use oxc_ast::ast::*;
use oxc_span::Span;

#[derive(Debug, Clone)]
pub enum RegistrationKind {
    /// `customElements.define('tag', Component)` or `window.customElements.define('tag', Component)`
    CustomElementsDefine {
        component_name: String,
        component_span: Span,
    },
    /// `Component.define('tag')` (Shoelace / Web Awesome style)
    StaticMethodDefine {
        component_name: String,
        component_span: Span,
    },
    /// `@customElement('tag') class Component ...`
    ClassDecorator { decorator_index: usize },
    /// `__decorate([customElement('tag')], Component)`
    TranspiledDecorate {
        component_name: String,
        component_span: Span,
    },
}

#[derive(Debug, Clone)]
pub struct DetectedRegistration {
    pub tag: String,
    pub kind: RegistrationKind,
    pub statement_index: usize,
    pub is_dynamic: bool,
}

pub struct RegistrationDetector;

impl RegistrationDetector {
    /// Inspect a statement and detect if it contains a custom element registration.
    pub fn detect_statement<'a>(
        stmt: &'a Statement<'a>,
        stmt_index: usize,
    ) -> Option<DetectedRegistration> {
        match stmt {
            Statement::ExpressionStatement(expr_stmt) => {
                Self::detect_expression(&expr_stmt.expression, stmt_index)
            }
            Statement::ClassDeclaration(class) => Self::detect_class_decorators(class, stmt_index),
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &export_decl.declaration {
                    Self::detect_class_decorators(class, stmt_index)
                } else {
                    None
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &export_decl.declaration
                {
                    Self::detect_class_decorators(class, stmt_index)
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    fn detect_expression<'a>(
        expr: &'a Expression<'a>,
        stmt_index: usize,
    ) -> Option<DetectedRegistration> {
        let Expression::CallExpression(call) = expr else {
            return None;
        };

        // 1. Check customElements.define(...) or window.customElements.define(...) or globalThis.customElements.define(...)
        if Self::is_custom_elements_define(&call.callee) {
            let first_arg = call.arguments.first()?;
            let second_arg = call.arguments.get(1)?;

            let (tag, is_dynamic) = match first_arg.as_expression() {
                Some(Expression::StringLiteral(str_lit)) => {
                    (str_lit.value.as_str().to_string(), false)
                }
                _ => ("".to_string(), true),
            };

            let (comp_name, comp_span) = match second_arg.as_expression() {
                Some(Expression::Identifier(ident)) => {
                    (ident.name.as_str().to_string(), ident.span)
                }
                _ => ("".to_string(), Span::default()),
            };

            return Some(DetectedRegistration {
                tag,
                kind: RegistrationKind::CustomElementsDefine {
                    component_name: comp_name,
                    component_span: comp_span,
                },
                statement_index: stmt_index,
                is_dynamic,
            });
        }

        // 2. Check Component.define('tag') (Shoelace / Web Awesome style)
        if let Expression::StaticMemberExpression(mem) = &call.callee {
            if mem.property.name == "define" {
                if let Expression::Identifier(cls_ident) = &mem.object {
                    // Check first argument for tag name
                    if let Some(first_arg) = call.arguments.first() {
                        let (tag, is_dynamic) = match first_arg.as_expression() {
                            Some(Expression::StringLiteral(str_lit)) => {
                                (str_lit.value.as_str().to_string(), false)
                            }
                            _ => ("".to_string(), true),
                        };

                        return Some(DetectedRegistration {
                            tag,
                            kind: RegistrationKind::StaticMethodDefine {
                                component_name: cls_ident.name.as_str().to_string(),
                                component_span: cls_ident.span,
                            },
                            statement_index: stmt_index,
                            is_dynamic,
                        });
                    }
                }
            }
        }

        // 3. Check transpiled decorators: __decorate([customElement('tag')], Component)
        if let Expression::Identifier(callee_ident) = &call.callee {
            if (callee_ident.name == "__decorate" || callee_ident.name == "_ts_decorate")
                && call.arguments.len() >= 2
            {
                if let (Some(Expression::ArrayExpression(arr)), Some(second_arg)) = (
                    call.arguments.first().and_then(|a| a.as_expression()),
                    call.arguments.get(1).and_then(|a| a.as_expression()),
                ) {
                    for elem in &arr.elements {
                        if let Some(Expression::CallExpression(dec_call)) = elem.as_expression() {
                            if Self::is_custom_element_decorator_callee(&dec_call.callee) {
                                let (tag, is_dynamic) = match dec_call
                                    .arguments
                                    .first()
                                    .and_then(|a| a.as_expression())
                                {
                                    Some(Expression::StringLiteral(str_lit)) => {
                                        (str_lit.value.as_str().to_string(), false)
                                    }
                                    _ => ("".to_string(), true),
                                };

                                let (comp_name, comp_span) = match second_arg {
                                    Expression::Identifier(ident) => {
                                        (ident.name.as_str().to_string(), ident.span)
                                    }
                                    _ => ("".to_string(), Span::default()),
                                };

                                return Some(DetectedRegistration {
                                    tag,
                                    kind: RegistrationKind::TranspiledDecorate {
                                        component_name: comp_name,
                                        component_span: comp_span,
                                    },
                                    statement_index: stmt_index,
                                    is_dynamic,
                                });
                            }
                        }
                    }
                }
            }
        }

        None
    }

    fn is_custom_elements_define(callee: &Expression) -> bool {
        let Expression::StaticMemberExpression(mem) = callee else {
            return false;
        };
        if mem.property.name != "define" {
            return false;
        }

        match &mem.object {
            Expression::Identifier(id) => id.name == "customElements",
            Expression::StaticMemberExpression(inner)
                if inner.property.name == "customElements" =>
            {
                match &inner.object {
                    Expression::Identifier(global_id) => {
                        global_id.name == "window" || global_id.name == "globalThis"
                    }
                    _ => false,
                }
            }
            _ => false,
        }
    }

    fn is_custom_element_decorator_callee(callee: &Expression) -> bool {
        match callee {
            Expression::Identifier(id) => id.name == "customElement",
            Expression::StaticMemberExpression(mem) => mem.property.name == "customElement",
            _ => false,
        }
    }

    fn detect_class_decorators<'a>(
        class: &'a Class<'a>,
        stmt_index: usize,
    ) -> Option<DetectedRegistration> {
        for (idx, dec) in class.decorators.iter().enumerate() {
            if let Expression::CallExpression(call) = &dec.expression {
                if Self::is_custom_element_decorator_callee(&call.callee) {
                    let (tag, is_dynamic) =
                        match call.arguments.first().and_then(|a| a.as_expression()) {
                            Some(Expression::StringLiteral(str_lit)) => {
                                (str_lit.value.as_str().to_string(), false)
                            }
                            _ => ("".to_string(), true),
                        };

                    return Some(DetectedRegistration {
                        tag,
                        kind: RegistrationKind::ClassDecorator {
                            decorator_index: idx,
                        },
                        statement_index: stmt_index,
                        is_dynamic,
                    });
                }
            }
        }
        None
    }
}
