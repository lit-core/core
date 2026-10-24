use oxc_ast::ast::*;
use oxc_span::Span;

use crate::resolver::SymbolResolver;

#[derive(Debug, Clone)]
pub enum RegistrationKind {
    /// `customElements.define('tag', Component)` or `window.customElements.define('tag', Component)`
    CustomElementsDefine {
        component_name: String,
        component_span: Span,
    },
    /// Static component registration via `Component.define('tag')`.
    StaticMethodDefine {
        component_name: String,
        component_span: Span,
    },
    /// `@customElement('tag') class Component ...`
    ClassDecorator {
        decorator_index: usize,
        decorator_name: String,
    },
    /// `__decorate([customElement('tag')], Component)`
    TranspiledDecorate {
        component_name: String,
        component_span: Span,
        decorator_name: String,
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
        resolver: &SymbolResolver,
    ) -> Option<DetectedRegistration> {
        match stmt {
            Statement::ExpressionStatement(expr_stmt) => {
                Self::detect_expression(&expr_stmt.expression, stmt_index, resolver)
            }
            Statement::ClassDeclaration(class) => {
                Self::detect_class_decorators(class, stmt_index, resolver)
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &var_decl.declarations {
                    if let Some(init) = &decl.init
                        && let Expression::ClassExpression(class) = init.without_parentheses()
                        && let Some(reg) =
                            Self::detect_class_decorators(class, stmt_index, resolver)
                    {
                        return Some(reg);
                    }
                }
                None
            }
            Statement::ExportDeclaration(export_decl) => match &export_decl.declaration {
                Declaration::ClassDeclaration(class) => {
                    Self::detect_class_decorators(class, stmt_index, resolver)
                }
                Declaration::VariableDeclaration(var_decl) => {
                    for decl in &var_decl.declarations {
                        if let Some(init) = &decl.init
                            && let Expression::ClassExpression(class) = init.without_parentheses()
                            && let Some(reg) =
                                Self::detect_class_decorators(class, stmt_index, resolver)
                        {
                            return Some(reg);
                        }
                    }
                    None
                }
                _ => None,
            },
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &export_decl.declaration
                {
                    Self::detect_class_decorators(class, stmt_index, resolver)
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
        resolver: &SymbolResolver,
    ) -> Option<DetectedRegistration> {
        let call = match expr {
            Expression::CallExpression(call) => call,
            Expression::AssignmentExpression(assign) => match &assign.right {
                Expression::CallExpression(call) => call,
                _ => return None,
            },
            _ => return None,
        };

        // 1. Check customElements.define(...) via SymbolProofContext
        if let Some(reg) = resolver.symbol_ctx.is_custom_elements_define(call) {
            let (tag, is_dynamic) = match reg.tag {
                Some(t) => (t, false),
                None => ("".to_string(), true),
            };

            let (comp_name, comp_span) = match reg.class_expr.without_parentheses() {
                Expression::Identifier(ident) => (ident.name.as_str().to_string(), ident.span),
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

        // 2. Check static component registration via Component.define('tag')
        if let Expression::StaticMemberExpression(mem) = &call.callee
            && mem.property.name == "define"
            && let Expression::Identifier(cls_ident) = &mem.object
            && cls_ident.name != "customElements"
            && cls_ident.name != "window"
            && cls_ident.name != "globalThis"
            && resolver.is_component_reference(cls_ident)
            && let Some(first_arg) = call.arguments.first()
        {
            let (tag, is_dynamic) = match first_arg
                .as_expression()
                .and_then(lit_analysis::SymbolProofContext::extract_static_string)
            {
                Some(s) => (s, false),
                None => ("".to_string(), true),
            };

            // Ensure static define calls are only shaken if tag name contains a hyphen
            if !is_dynamic && !tag.contains('-') {
                return None;
            }

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

        // 3. Check transpiled decorators: __decorate([customElement('tag')], Component)
        if resolver.is_decorator_helper_callee(&call.callee)
            && call.arguments.len() >= 2
            && let (Some(Expression::ArrayExpression(arr)), Some(second_arg)) = (
                call.arguments.first().and_then(|a| a.as_expression()),
                call.arguments.get(1).and_then(|a| a.as_expression()),
            )
        {
            for elem in &arr.elements {
                if let Some(dec_expr) = elem.as_expression()
                    && let Expression::CallExpression(dec_call) = dec_expr.without_parentheses()
                {
                    let matched_tag = if resolver.is_custom_element_decorator(&dec_call.callee) {
                        Some(
                            match dec_call
                                .arguments
                                .first()
                                .and_then(|a| a.as_expression())
                                .and_then(lit_analysis::SymbolProofContext::extract_static_string)
                            {
                                Some(s) => (s, false),
                                None => ("".to_string(), true),
                            },
                        )
                    } else {
                        resolver
                            .symbol_ctx
                            .is_class_custom_element_decorator_call(dec_expr)
                            .map(|t| (t, false))
                    };

                    if let Some((tag, is_dynamic)) = matched_tag {
                        let (comp_name, comp_span) = match second_arg.without_parentheses() {
                            Expression::Identifier(ident) => {
                                (ident.name.as_str().to_string(), ident.span)
                            }
                            _ => ("".to_string(), Span::default()),
                        };

                        let dec_name = match dec_call.callee.without_parentheses() {
                            Expression::Identifier(id) => id.name.as_str().to_string(),
                            _ => String::new(),
                        };

                        return Some(DetectedRegistration {
                            tag,
                            kind: RegistrationKind::TranspiledDecorate {
                                component_name: comp_name,
                                component_span: comp_span,
                                decorator_name: dec_name,
                            },
                            statement_index: stmt_index,
                            is_dynamic,
                        });
                    }
                }
            }
        }

        None
    }

    fn detect_class_decorators<'a>(
        class: &'a Class<'a>,
        stmt_index: usize,
        resolver: &SymbolResolver,
    ) -> Option<DetectedRegistration> {
        for (idx, dec) in class.decorators.iter().enumerate() {
            if let Expression::CallExpression(call) = dec.expression.without_parentheses() {
                let matched_tag = if resolver.is_custom_element_decorator(&call.callee) {
                    Some(
                        match call
                            .arguments
                            .first()
                            .and_then(|a| a.as_expression())
                            .and_then(lit_analysis::SymbolProofContext::extract_static_string)
                        {
                            Some(s) => (s, false),
                            None => ("".to_string(), true),
                        },
                    )
                } else {
                    resolver
                        .symbol_ctx
                        .is_class_custom_element_decorator_call(&dec.expression)
                        .map(|t| (t, false))
                };

                if let Some((tag, is_dynamic)) = matched_tag {
                    let dec_name = match call.callee.without_parentheses() {
                        Expression::Identifier(id) => id.name.as_str().to_string(),
                        _ => String::new(),
                    };

                    return Some(DetectedRegistration {
                        tag,
                        kind: RegistrationKind::ClassDecorator {
                            decorator_index: idx,
                            decorator_name: dec_name,
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
