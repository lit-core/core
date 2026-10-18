use crate::emit_css::build_jsx_style_element;
use lit_analysis::LitComponentInfo;
use oxc_allocator::{Allocator, ArenaBox, ArenaVec, CloneIn};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

/// Emits an explicit @lit/react-style wrapper fallback around the original custom element
/// with structured event wiring and ref forwarding.
pub fn emit_bailout_component<'a>(
    allocator: &'a Allocator,
    component: &LitComponentInfo,
    scoped_css: Option<&str>,
    stylesheet_id: Option<&str>,
    emit_css_flag: bool,
    comp_tag: &str,
) -> Result<Program<'a>, String> {
    let ast = AstBuilder::new(allocator);

    // 1. Build React imports:
    // import React, { forwardRef, useRef, useLayoutEffect, useImperativeHandle } from 'react';
    let mut react_specs = ArenaVec::new_in(&ast);
    react_specs.push(ImportDeclarationSpecifier::new_import_default_specifier(
        SPAN,
        BindingIdentifier::new(SPAN, allocator.alloc_str("React"), &ast),
        &ast,
    ));

    let helper_names = [
        "forwardRef",
        "useRef",
        "useLayoutEffect",
        "useImperativeHandle",
    ];
    for name in &helper_names {
        let imported = ModuleExportName::new_identifier_name(SPAN, allocator.alloc_str(name), &ast);
        let local = BindingIdentifier::new(SPAN, allocator.alloc_str(name), &ast);
        react_specs.push(ImportDeclarationSpecifier::new_import_specifier(
            SPAN,
            imported,
            local,
            ImportOrExportKind::Value,
            &ast,
        ));
    }

    let react_source = StringLiteral::new(SPAN, allocator.alloc_str("react"), None, &ast);
    let react_import = Statement::new_import_declaration(
        SPAN,
        Some(react_specs),
        react_source,
        None,
        None,
        ImportOrExportKind::Value,
        &ast,
    );

    // 2. Build inner function body statements
    let mut body_stmts = ArenaVec::new_in(&ast);

    // const elementRef = useRef(null);
    let elem_ref_decl = {
        let callee = Expression::new_identifier(SPAN, allocator.alloc_str("useRef"), &ast);
        let mut args = ArenaVec::new_in(&ast);
        args.push(Argument::from(Expression::new_null_literal(SPAN, &ast)));
        let init_expr = Expression::new_call_expression(SPAN, callee, None, args, false, &ast);
        let pat =
            BindingPattern::new_binding_identifier(SPAN, allocator.alloc_str("elementRef"), &ast);
        let mut declarators = ArenaVec::new_in(&ast);
        declarators.push(VariableDeclarator::new(
            SPAN,
            pat,
            None,
            Some(init_expr),
            false,
            &ast,
        ));
        Statement::VariableDeclaration(VariableDeclaration::boxed(
            SPAN,
            VariableDeclarationKind::Const,
            declarators,
            false,
            &ast,
        ))
    };
    body_stmts.push(elem_ref_decl);

    // useImperativeHandle(forwardedRef, () => elementRef.current);
    let imperative_handle_stmt = {
        let callee =
            Expression::new_identifier(SPAN, allocator.alloc_str("useImperativeHandle"), &ast);
        let mut args = ArenaVec::new_in(&ast);
        args.push(Argument::from(Expression::new_identifier(
            SPAN,
            allocator.alloc_str("forwardedRef"),
            &ast,
        )));

        // Arrow function: () => elementRef.current
        let ret_val = Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, allocator.alloc_str("elementRef"), &ast),
            IdentifierName::new(SPAN, allocator.alloc_str("current"), &ast),
            false,
            &ast,
        );
        let mut arrow_stmts = ArenaVec::new_in(&ast);
        arrow_stmts.push(Statement::new_return_statement(SPAN, Some(ret_val), &ast));
        let arrow_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(&ast), arrow_stmts, &ast);
        let arrow_params = FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            ArenaVec::new_in(&ast),
            None,
            &ast,
        );
        let arrow_fn = Expression::ArrowFunctionExpression(ArrowFunctionExpression::boxed(
            SPAN,
            false,
            None,
            arrow_params,
            None,
            ArrowFunctionBody::FunctionBody(arrow_body),
            &ast,
        ));
        args.push(Argument::from(arrow_fn));

        let call_expr = Expression::new_call_expression(SPAN, callee, None, args, false, &ast);
        Statement::ExpressionStatement(ExpressionStatement::boxed(SPAN, call_expr, &ast))
    };
    body_stmts.push(imperative_handle_stmt);

    // 3. Attach useLayoutEffect for custom event listeners if component has events
    if !component.events.is_empty() {
        let callee = Expression::new_identifier(SPAN, allocator.alloc_str("useLayoutEffect"), &ast);
        let mut effect_args = ArenaVec::new_in(&ast);

        // effect body:
        // const el = elementRef.current;
        // if (!el) return;
        // const cleanups = [];
        // ... (for each event in component.events)
        // return () => { for (const cleanup of cleanups) cleanup(); };
        let mut effect_stmts = ArenaVec::new_in(&ast);

        // const el = elementRef.current;
        let el_decl = {
            let init_expr = Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, allocator.alloc_str("elementRef"), &ast),
                IdentifierName::new(SPAN, allocator.alloc_str("current"), &ast),
                false,
                &ast,
            );
            let pat = BindingPattern::new_binding_identifier(SPAN, allocator.alloc_str("el"), &ast);
            let mut decls = ArenaVec::new_in(&ast);
            decls.push(VariableDeclarator::new(
                SPAN,
                pat,
                None,
                Some(init_expr),
                false,
                &ast,
            ));
            Statement::VariableDeclaration(VariableDeclaration::boxed(
                SPAN,
                VariableDeclarationKind::Const,
                decls,
                false,
                &ast,
            ))
        };
        effect_stmts.push(el_decl);

        // if (!el) return;
        let guard_stmt = {
            let test = Expression::new_unary_expression(
                SPAN,
                UnaryOperator::LogicalNot,
                Expression::new_identifier(SPAN, allocator.alloc_str("el"), &ast),
                &ast,
            );
            let ret = Statement::new_return_statement(SPAN, None, &ast);
            Statement::new_if_statement(SPAN, test, ret, None, &ast)
        };
        effect_stmts.push(guard_stmt);

        // const cleanups = [];
        let cleanups_decl = {
            let init_expr = Expression::new_array_expression(SPAN, ArenaVec::new_in(&ast), &ast);
            let pat =
                BindingPattern::new_binding_identifier(SPAN, allocator.alloc_str("cleanups"), &ast);
            let mut decls = ArenaVec::new_in(&ast);
            decls.push(VariableDeclarator::new(
                SPAN,
                pat,
                None,
                Some(init_expr),
                false,
                &ast,
            ));
            Statement::VariableDeclaration(VariableDeclaration::boxed(
                SPAN,
                VariableDeclarationKind::Const,
                decls,
                false,
                &ast,
            ))
        };
        effect_stmts.push(cleanups_decl);

        // For each event:
        // if (props[prop_name]) {
        //     const handler = (e) => props[prop_name](e);
        //     el.addEventListener(event_name, handler);
        //     cleanups.push(() => el.removeEventListener(event_name, handler));
        // }
        for ev in &component.events {
            let prop_access = Expression::new_computed_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, allocator.alloc_str("props"), &ast),
                Expression::new_string_literal(
                    SPAN,
                    allocator.alloc_str(&ev.prop_name),
                    None,
                    &ast,
                ),
                false,
                &ast,
            );

            // Handler: (e) => props[prop_name](e)
            let mut call_args = ArenaVec::new_in(&ast);
            call_args.push(Argument::from(Expression::new_identifier(
                SPAN,
                allocator.alloc_str("e"),
                &ast,
            )));
            let call_prop = Expression::new_call_expression(
                SPAN,
                prop_access.clone_in(allocator),
                None,
                call_args,
                false,
                &ast,
            );
            let mut handler_params = ArenaVec::new_in(&ast);
            handler_params.push(FormalParameter::new_plain(
                SPAN,
                BindingPattern::new_binding_identifier(SPAN, allocator.alloc_str("e"), &ast),
                &ast,
            ));
            let handler_formal = FormalParameters::boxed(
                SPAN,
                FormalParameterKind::FormalParameter,
                handler_params,
                None,
                &ast,
            );
            let mut handler_body_stmts = ArenaVec::new_in(&ast);
            handler_body_stmts.push(Statement::ExpressionStatement(ExpressionStatement::boxed(
                SPAN, call_prop, &ast,
            )));
            let handler_body =
                FunctionBody::boxed(SPAN, ArenaVec::new_in(&ast), handler_body_stmts, &ast);
            let handler_fn = Expression::ArrowFunctionExpression(ArrowFunctionExpression::boxed(
                SPAN,
                false,
                None,
                handler_formal,
                None,
                ArrowFunctionBody::FunctionBody(handler_body),
                &ast,
            ));

            // const handler = (e) => ...;
            let handler_decl = {
                let pat = BindingPattern::new_binding_identifier(
                    SPAN,
                    allocator.alloc_str("handler"),
                    &ast,
                );
                let mut decls = ArenaVec::new_in(&ast);
                decls.push(VariableDeclarator::new(
                    SPAN,
                    pat,
                    None,
                    Some(handler_fn),
                    false,
                    &ast,
                ));
                Statement::VariableDeclaration(VariableDeclaration::boxed(
                    SPAN,
                    VariableDeclarationKind::Const,
                    decls,
                    false,
                    &ast,
                ))
            };

            // el.addEventListener(event_name, handler);
            let add_listener_stmt = {
                let callee = Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, allocator.alloc_str("el"), &ast),
                    IdentifierName::new(SPAN, allocator.alloc_str("addEventListener"), &ast),
                    false,
                    &ast,
                );
                let mut args = ArenaVec::new_in(&ast);
                args.push(Argument::from(Expression::new_string_literal(
                    SPAN,
                    allocator.alloc_str(&ev.name),
                    None,
                    &ast,
                )));
                args.push(Argument::from(Expression::new_identifier(
                    SPAN,
                    allocator.alloc_str("handler"),
                    &ast,
                )));
                let call = Expression::new_call_expression(SPAN, callee, None, args, false, &ast);
                Statement::ExpressionStatement(ExpressionStatement::boxed(SPAN, call, &ast))
            };

            // cleanups.push(() => el.removeEventListener(event_name, handler));
            let push_cleanup_stmt = {
                let callee = Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, allocator.alloc_str("cleanups"), &ast),
                    IdentifierName::new(SPAN, allocator.alloc_str("push"), &ast),
                    false,
                    &ast,
                );

                // Arrow: () => el.removeEventListener(event_name, handler)
                let rem_callee = Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, allocator.alloc_str("el"), &ast),
                    IdentifierName::new(SPAN, allocator.alloc_str("removeEventListener"), &ast),
                    false,
                    &ast,
                );
                let mut rem_args = ArenaVec::new_in(&ast);
                rem_args.push(Argument::from(Expression::new_string_literal(
                    SPAN,
                    allocator.alloc_str(&ev.name),
                    None,
                    &ast,
                )));
                rem_args.push(Argument::from(Expression::new_identifier(
                    SPAN,
                    allocator.alloc_str("handler"),
                    &ast,
                )));
                let rem_call =
                    Expression::new_call_expression(SPAN, rem_callee, None, rem_args, false, &ast);
                let mut cleanup_stmts = ArenaVec::new_in(&ast);
                cleanup_stmts.push(Statement::ExpressionStatement(ExpressionStatement::boxed(
                    SPAN, rem_call, &ast,
                )));
                let cleanup_body =
                    FunctionBody::boxed(SPAN, ArenaVec::new_in(&ast), cleanup_stmts, &ast);
                let cleanup_params = FormalParameters::boxed(
                    SPAN,
                    FormalParameterKind::FormalParameter,
                    ArenaVec::new_in(&ast),
                    None,
                    &ast,
                );
                let cleanup_arrow =
                    Expression::ArrowFunctionExpression(ArrowFunctionExpression::boxed(
                        SPAN,
                        false,
                        None,
                        cleanup_params,
                        None,
                        ArrowFunctionBody::FunctionBody(cleanup_body),
                        &ast,
                    ));

                let mut push_args = ArenaVec::new_in(&ast);
                push_args.push(Argument::from(cleanup_arrow));
                let push_call =
                    Expression::new_call_expression(SPAN, callee, None, push_args, false, &ast);
                Statement::ExpressionStatement(ExpressionStatement::boxed(SPAN, push_call, &ast))
            };

            let mut if_body_stmts = ArenaVec::new_in(&ast);
            if_body_stmts.push(handler_decl);
            if_body_stmts.push(add_listener_stmt);
            if_body_stmts.push(push_cleanup_stmt);

            let if_stmt = Statement::new_if_statement(
                SPAN,
                prop_access,
                Statement::new_block_statement(SPAN, if_body_stmts, &ast),
                None,
                &ast,
            );
            effect_stmts.push(if_stmt);
        }

        // return () => { for (const cleanup of cleanups) cleanup(); };
        let ret_cleanup_stmt = {
            // Arrow cleanup: () => { for (const c of cleanups) c(); }
            let mut cleanup_loop_stmts = ArenaVec::new_in(&ast);
            let loop_call = Expression::new_call_expression(
                SPAN,
                Expression::new_identifier(SPAN, allocator.alloc_str("c"), &ast),
                None,
                ArenaVec::new_in(&ast),
                false,
                &ast,
            );
            cleanup_loop_stmts.push(Statement::ExpressionStatement(ExpressionStatement::boxed(
                SPAN, loop_call, &ast,
            )));
            let for_of = Statement::ForOfStatement(ForOfStatement::boxed(
                SPAN,
                false,
                ForStatementLeft::VariableDeclaration(VariableDeclaration::boxed(
                    SPAN,
                    VariableDeclarationKind::Const,
                    {
                        let mut decls = ArenaVec::new_in(&ast);
                        decls.push(VariableDeclarator::new(
                            SPAN,
                            BindingPattern::new_binding_identifier(
                                SPAN,
                                allocator.alloc_str("c"),
                                &ast,
                            ),
                            None,
                            None,
                            false,
                            &ast,
                        ));
                        decls
                    },
                    false,
                    &ast,
                )),
                Expression::new_identifier(SPAN, allocator.alloc_str("cleanups"), &ast),
                Statement::new_block_statement(SPAN, cleanup_loop_stmts, &ast),
                &ast,
            ));
            let mut arrow_body_stmts = ArenaVec::new_in(&ast);
            arrow_body_stmts.push(for_of);
            let arrow_body =
                FunctionBody::boxed(SPAN, ArenaVec::new_in(&ast), arrow_body_stmts, &ast);
            let arrow_params = FormalParameters::boxed(
                SPAN,
                FormalParameterKind::FormalParameter,
                ArenaVec::new_in(&ast),
                None,
                &ast,
            );
            let cleanup_arrow =
                Expression::ArrowFunctionExpression(ArrowFunctionExpression::boxed(
                    SPAN,
                    false,
                    None,
                    arrow_params,
                    None,
                    ArrowFunctionBody::FunctionBody(arrow_body),
                    &ast,
                ));
            Statement::new_return_statement(SPAN, Some(cleanup_arrow), &ast)
        };
        effect_stmts.push(ret_cleanup_stmt);

        let effect_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(&ast), effect_stmts, &ast);
        let effect_arrow = Expression::ArrowFunctionExpression(ArrowFunctionExpression::boxed(
            SPAN,
            false,
            None,
            FormalParameters::boxed(
                SPAN,
                FormalParameterKind::FormalParameter,
                ArenaVec::new_in(&ast),
                None,
                &ast,
            ),
            None,
            ArrowFunctionBody::FunctionBody(effect_body),
            &ast,
        ));
        effect_args.push(Argument::from(effect_arrow));

        // Dependency array: [props]
        let mut dep_elements = ArenaVec::new_in(&ast);
        dep_elements.push(ArrayExpressionElement::from(Expression::new_identifier(
            SPAN,
            allocator.alloc_str("props"),
            &ast,
        )));
        let deps_array = Expression::new_array_expression(SPAN, dep_elements, &ast);
        effect_args.push(Argument::from(deps_array));

        let effect_call =
            Expression::new_call_expression(SPAN, callee, None, effect_args, false, &ast);
        body_stmts.push(Statement::ExpressionStatement(ExpressionStatement::boxed(
            SPAN,
            effect_call,
            &ast,
        )));
    }

    // 4. Return JSX element:
    // return (
    //     <comp_tag ref={elementRef} {...props}>
    //         {style_element}
    //         {props.children}
    //     </comp_tag>
    // );
    let tag = allocator.alloc_str(comp_tag);
    let mut attrs = ArenaVec::new_in(&ast);

    // ref={elementRef}
    let ref_name =
        JSXAttributeName::Identifier(JSXIdentifier::boxed(SPAN, allocator.alloc_str("ref"), &ast));
    let ref_val = Some(JSXAttributeValue::ExpressionContainer(
        JSXExpressionContainer::boxed(
            SPAN,
            JSXExpression::from(Expression::new_identifier(
                SPAN,
                allocator.alloc_str("elementRef"),
                &ast,
            )),
            &ast,
        ),
    ));
    attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
        SPAN, ref_name, ref_val, &ast,
    )));

    // {...props}
    attrs.push(JSXAttributeItem::SpreadAttribute(
        JSXSpreadAttribute::boxed(
            SPAN,
            Expression::new_identifier(SPAN, allocator.alloc_str("props"), &ast),
            &ast,
        ),
    ));

    let elem_name = JSXElementName::Identifier(JSXIdentifier::boxed(SPAN, tag, &ast));
    let opening = JSXOpeningElement::boxed(SPAN, elem_name, None, attrs, &ast);
    let closing_elem_name = JSXElementName::Identifier(JSXIdentifier::boxed(SPAN, tag, &ast));
    let closing = Some(JSXClosingElement::boxed(SPAN, closing_elem_name, &ast));

    let mut jsx_children = ArenaVec::new_in(&ast);

    // Style element if scoped_css is present and not external
    if !emit_css_flag {
        if let (Some(css), Some(id)) = (scoped_css, stylesheet_id) {
            let style_elem = build_jsx_style_element(id, css, "default", &ast);
            jsx_children.push(JSXChild::Element(ArenaBox::new_in(style_elem, &ast)));
        }
    }

    // {props.children}
    let props_children = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, allocator.alloc_str("props"), &ast),
        IdentifierName::new(SPAN, allocator.alloc_str("children"), &ast),
        false,
        &ast,
    );
    jsx_children.push(JSXChild::ExpressionContainer(
        JSXExpressionContainer::boxed(SPAN, JSXExpression::from(props_children), &ast),
    ));

    let root_jsx = JSXElement::boxed(SPAN, opening, jsx_children, closing, &ast);
    let ret_stmt =
        Statement::new_return_statement(SPAN, Some(Expression::JSXElement(root_jsx)), &ast);
    body_stmts.push(ret_stmt);

    // 5. Build function expression:
    // function ComponentName(props, forwardedRef) { ... }
    let func_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(&ast), body_stmts, &ast);
    let mut params_vec = ArenaVec::new_in(&ast);
    params_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, allocator.alloc_str("props"), &ast),
        &ast,
    ));
    params_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, allocator.alloc_str("forwardedRef"), &ast),
        &ast,
    ));
    let formal_params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        params_vec,
        None,
        &ast,
    );

    let inner_fn = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        Some(BindingIdentifier::new(
            SPAN,
            allocator.alloc_str(&component.component_name),
            &ast,
        )),
        false,
        false,
        false,
        None,
        None,
        formal_params,
        None,
        Some(func_body),
        &ast,
    );

    // forwardRef(function ComponentName(...) { ... })
    let forward_ref_callee =
        Expression::new_identifier(SPAN, allocator.alloc_str("forwardRef"), &ast);
    let mut fwd_args = ArenaVec::new_in(&ast);
    fwd_args.push(Argument::from(Expression::FunctionExpression(inner_fn)));
    let forward_ref_call =
        Expression::new_call_expression(SPAN, forward_ref_callee, None, fwd_args, false, &ast);

    // export const ComponentName = forwardRef(...);
    let comp_id = BindingPattern::new_binding_identifier(
        SPAN,
        allocator.alloc_str(&component.component_name),
        &ast,
    );
    let mut comp_decls = ArenaVec::new_in(&ast);
    comp_decls.push(VariableDeclarator::new(
        SPAN,
        comp_id,
        None,
        Some(forward_ref_call),
        false,
        &ast,
    ));
    let var_decl = VariableDeclaration::boxed(
        SPAN,
        VariableDeclarationKind::Const,
        comp_decls,
        false,
        &ast,
    );
    let export_decl = Statement::ExportDeclaration(ExportDeclaration::boxed(
        SPAN,
        Declaration::VariableDeclaration(var_decl),
        &ast,
    ));

    let mut prog_stmts = ArenaVec::new_in(&ast);
    prog_stmts.push(react_import);
    prog_stmts.push(export_decl);

    let program = Program::new(
        SPAN,
        SourceType::jsx(),
        "",
        ArenaVec::new_in(&ast),
        None,
        ArenaVec::new_in(&ast),
        prog_stmts,
        &ast,
    );

    Ok(program)
}
