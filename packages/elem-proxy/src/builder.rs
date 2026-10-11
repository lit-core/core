use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::extractor::CustomElementTarget;

/// Build the statements for a local/wrapped custom element proxy.
///
/// This embeds `class_decl` directly inside the implementation getter closure:
/// ```js
/// let __impl_Name = null;
/// function __getImpl_Name() {
///   if (!__impl_Name) {
///     <class_decl>
///     __impl_Name = Name;
///   }
///   return __impl_Name;
/// }
/// class NameProxy extends HTMLElement { ... }
/// const __props_Name = [...];
/// for (const __p of __props_Name) { ... }
/// customElements.define('tag-name', NameProxy);
/// export { ... };
/// ```
pub fn build_proxy_wrapper<'a>(
    ast: &AstBuilder<'a>,
    target: &CustomElementTarget,
    class_decl: Statement<'a>,
) -> ArenaVec<'a, Statement<'a>> {
    let mut stmts = ArenaVec::new_in(ast);

    let proxy_name = ast
        .allocator()
        .alloc_str(&format!("{}Proxy", target.class_name));
    let getter_name = ast
        .allocator()
        .alloc_str(&format!("__getImpl_{}", target.class_name));
    let impl_var = ast
        .allocator()
        .alloc_str(&format!("__impl_{}", target.class_name));
    let props_var = ast
        .allocator()
        .alloc_str(&format!("__props_{}", target.class_name));
    let class_name = ast.allocator().alloc_str(&target.class_name);
    let tag_name = ast.allocator().alloc_str(&target.tag_name);

    // 1. let __impl_Name = null;
    stmts.push(build_impl_var_decl(ast, impl_var));

    // 2. function __getImpl_Name() { if (!__impl_Name) { <class_decl>; __impl_Name = Name; } return __impl_Name; }
    stmts.push(build_get_impl_func(
        ast,
        getter_name,
        impl_var,
        class_name,
        class_decl,
    ));

    // 3. class NameProxy extends HTMLElement { ... }
    stmts.push(build_proxy_class(
        ast,
        false,
        class_name,
        proxy_name,
        getter_name,
        &target.observed_attributes,
    ));

    // 4. const __props_Name = [...];
    stmts.push(build_props_decl(ast, props_var, &target.properties));

    // 5. for (const __p of __props_Name) { Object.defineProperty(NameProxy.prototype, __p, { ... }); }
    stmts.push(build_props_loop(ast, proxy_name, props_var));

    // 6. customElements.define('tag-name', NameProxy);
    stmts.push(build_ce_define(ast, tag_name, proxy_name));

    // 7. export statement (if applicable)
    if let Some(exp) = build_export_stmt(ast, target, proxy_name, class_name) {
        stmts.push(exp);
    }

    stmts
}

/// Build the statements for an external custom element proxy.
///
/// ```js
/// class NameProxy extends HTMLElement { ... }
/// customElements.define('tag-name', NameProxy);
/// ```
pub fn build_external_proxy_wrapper<'a>(
    ast: &AstBuilder<'a>,
    tag_name: &str,
    class_name: &str,
) -> ArenaVec<'a, Statement<'a>> {
    let mut stmts = ArenaVec::new_in(ast);

    let proxy_name = ast.allocator().alloc_str(&format!("{}Proxy", class_name));
    let cls = ast.allocator().alloc_str(class_name);
    let tag = ast.allocator().alloc_str(tag_name);

    // 1. class NameProxy extends HTMLElement { ... }
    stmts.push(build_proxy_class(ast, true, cls, proxy_name, "", &[]));

    // 2. customElements.define('tag-name', NameProxy);
    stmts.push(build_ce_define(ast, tag, proxy_name));

    stmts
}

// ---------------------------------------------------------------------------
// Helpers for top-level statements
// ---------------------------------------------------------------------------

fn build_impl_var_decl<'a>(ast: &AstBuilder<'a>, impl_var: &'a str) -> Statement<'a> {
    let mut decls = ArenaVec::new_in(ast);
    decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, impl_var, ast),
        None,
        Some(Expression::new_null_literal(SPAN, ast)),
        false,
        ast,
    ));
    Statement::new_variable_declaration(SPAN, VariableDeclarationKind::Let, decls, false, ast)
}

fn build_get_impl_func<'a>(
    ast: &AstBuilder<'a>,
    getter_name: &'a str,
    impl_var: &'a str,
    class_name: &'a str,
    class_decl: Statement<'a>,
) -> Statement<'a> {
    let mut body_stmts = ArenaVec::new_in(ast);

    // if (!__impl_Name) { <class_decl>; __impl_Name = Name; }
    let test_not_impl = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::LogicalNot,
        Expression::new_identifier(SPAN, impl_var, ast),
        ast,
    );
    let assign_impl = Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(SimpleAssignmentTarget::new_assignment_target_identifier(
                SPAN, impl_var, ast,
            )),
            Expression::new_identifier(SPAN, class_name, ast),
            ast,
        ),
        ast,
    );
    let mut if_body = ArenaVec::new_in(ast);
    if_body.push(class_decl);
    if_body.push(assign_impl);
    let consequent = Statement::new_block_statement(SPAN, if_body, ast);
    body_stmts.push(Statement::new_if_statement(
        SPAN,
        test_not_impl,
        consequent,
        None,
        ast,
    ));

    // return __impl_Name;
    body_stmts.push(Statement::new_return_statement(
        SPAN,
        Some(Expression::new_identifier(SPAN, impl_var, ast)),
        ast,
    ));

    let func_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), body_stmts, ast);
    Statement::new_function_declaration(
        SPAN,
        FunctionType::FunctionDeclaration,
        Some(BindingIdentifier::new(SPAN, getter_name, ast)),
        false,
        false,
        false,
        None,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            ArenaVec::new_in(ast),
            None,
            ast,
        ),
        None,
        Some(func_body),
        ast,
    )
}

fn build_props_decl<'a>(
    ast: &AstBuilder<'a>,
    props_var: &'a str,
    properties: &[String],
) -> Statement<'a> {
    let mut elements = ArenaVec::new_in(ast);
    for prop in properties {
        let str_lit =
            Expression::new_string_literal(SPAN, ast.allocator().alloc_str(prop), None, ast);
        elements.push(ArrayExpressionElement::from(str_lit));
    }
    let array_expr = Expression::new_array_expression(SPAN, elements, ast);

    let mut decls = ArenaVec::new_in(ast);
    decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, props_var, ast),
        None,
        Some(array_expr),
        false,
        ast,
    ));
    Statement::new_variable_declaration(SPAN, VariableDeclarationKind::Const, decls, false, ast)
}

fn build_props_loop<'a>(
    ast: &AstBuilder<'a>,
    proxy_name: &'a str,
    props_var: &'a str,
) -> Statement<'a> {
    let mut loop_body_stmts = ArenaVec::new_in(ast);

    // Object.defineProperty(NameProxy.prototype, __p, { ... });
    let obj_def_prop = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "Object", ast),
        IdentifierName::new(SPAN, "defineProperty", ast),
        false,
        ast,
    );

    let proxy_proto = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, proxy_name, ast),
        IdentifierName::new(SPAN, "prototype", ast),
        false,
        ast,
    );

    let mut desc_props = ArenaVec::new_in(ast);

    // get() { this.__upgrade(); return this[__p]; }
    let mut get_stmts = ArenaVec::new_in(ast);
    get_stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "__upgrade", ast),
                false,
                ast,
            ),
            None,
            ArenaVec::new_in(ast),
            false,
            ast,
        ),
        ast,
    ));
    get_stmts.push(Statement::new_return_statement(
        SPAN,
        Some(Expression::new_computed_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            Expression::new_identifier(SPAN, "__p", ast),
            false,
            ast,
        )),
        ast,
    ));
    let get_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), get_stmts, ast);
    let get_fn = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        false,
        false,
        None,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            ArenaVec::new_in(ast),
            None,
            ast,
        ),
        None,
        Some(get_body),
        ast,
    );
    desc_props.push(ObjectPropertyKind::new_object_property(
        SPAN,
        PropertyKind::Get,
        PropertyKey::new_static_identifier(SPAN, "get", ast),
        Expression::FunctionExpression(get_fn),
        false,
        false,
        false,
        ast,
    ));

    // set(__v) { this.__upgrade(); this[__p] = __v; }
    let mut set_stmts = ArenaVec::new_in(ast);
    set_stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "__upgrade", ast),
                false,
                ast,
            ),
            None,
            ArenaVec::new_in(ast),
            false,
            ast,
        ),
        ast,
    ));
    set_stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_computed_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                Expression::new_identifier(SPAN, "__p", ast),
                false,
                ast,
            )),
            Expression::new_identifier(SPAN, "__v", ast),
            ast,
        ),
        ast,
    ));
    let mut set_params = ArenaVec::new_in(ast);
    set_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "__v", ast),
        ast,
    ));
    let set_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), set_stmts, ast);
    let set_fn = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        false,
        false,
        None,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            set_params,
            None,
            ast,
        ),
        None,
        Some(set_body),
        ast,
    );
    desc_props.push(ObjectPropertyKind::new_object_property(
        SPAN,
        PropertyKind::Set,
        PropertyKey::new_static_identifier(SPAN, "set", ast),
        Expression::FunctionExpression(set_fn),
        false,
        false,
        false,
        ast,
    ));

    // configurable: true
    desc_props.push(ObjectPropertyKind::new_object_property(
        SPAN,
        PropertyKind::Init,
        PropertyKey::new_static_identifier(SPAN, "configurable", ast),
        Expression::new_boolean_literal(SPAN, true, ast),
        false,
        false,
        false,
        ast,
    ));

    // enumerable: true
    desc_props.push(ObjectPropertyKind::new_object_property(
        SPAN,
        PropertyKind::Init,
        PropertyKey::new_static_identifier(SPAN, "enumerable", ast),
        Expression::new_boolean_literal(SPAN, true, ast),
        false,
        false,
        false,
        ast,
    ));

    let desc_obj = Expression::new_object_expression(SPAN, desc_props, ast);

    let mut define_args = ArenaVec::new_in(ast);
    define_args.push(Argument::from(proxy_proto));
    define_args.push(Argument::from(Expression::new_identifier(SPAN, "__p", ast)));
    define_args.push(Argument::from(desc_obj));

    let call_def =
        Expression::new_call_expression(SPAN, obj_def_prop, None, define_args, false, ast);
    loop_body_stmts.push(Statement::new_expression_statement(SPAN, call_def, ast));

    let mut left_decls = ArenaVec::new_in(ast);
    left_decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "__p", ast),
        None,
        None,
        false,
        ast,
    ));
    let for_left = ForStatementLeft::VariableDeclaration(VariableDeclaration::boxed(
        SPAN,
        VariableDeclarationKind::Const,
        left_decls,
        false,
        ast,
    ));

    Statement::new_for_of_statement(
        SPAN,
        false,
        for_left,
        Expression::new_identifier(SPAN, props_var, ast),
        Statement::new_block_statement(SPAN, loop_body_stmts, ast),
        ast,
    )
}

fn build_ce_define<'a>(
    ast: &AstBuilder<'a>,
    tag_name: &'a str,
    proxy_name: &'a str,
) -> Statement<'a> {
    let ce_define = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "customElements", ast),
        IdentifierName::new(SPAN, "define", ast),
        false,
        ast,
    );
    let mut args = ArenaVec::new_in(ast);
    args.push(Argument::from(Expression::new_string_literal(
        SPAN, tag_name, None, ast,
    )));
    args.push(Argument::from(Expression::new_identifier(
        SPAN, proxy_name, ast,
    )));
    let call = Expression::new_call_expression(SPAN, ce_define, None, args, false, ast);
    Statement::new_expression_statement(SPAN, call, ast)
}

fn build_export_stmt<'a>(
    ast: &AstBuilder<'a>,
    target: &CustomElementTarget,
    proxy_name: &'a str,
    class_name: &'a str,
) -> Option<Statement<'a>> {
    if target.is_default_export {
        Some(Statement::new_export_default_declaration(
            SPAN,
            ExportDefaultDeclarationKind::from(Expression::new_identifier(SPAN, proxy_name, ast)),
            ast,
        ))
    } else if target.is_export {
        let mut specifiers = ArenaVec::new_in(ast);
        specifiers.push(ExportSpecifier::new(
            SPAN,
            ModuleExportName::new_identifier_name(SPAN, proxy_name, ast),
            ModuleExportName::new_identifier_name(SPAN, class_name, ast),
            ImportOrExportKind::Value,
            ast,
        ));
        Some(Statement::new_export_named_declaration(
            SPAN,
            specifiers,
            ImportOrExportKind::Value,
            ast,
        ))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Proxy Class Definition
// ---------------------------------------------------------------------------

fn build_proxy_class<'a>(
    ast: &AstBuilder<'a>,
    is_external: bool,
    class_name: &'a str,
    proxy_name: &'a str,
    getter_name: &'a str,
    observed_attributes: &[String],
) -> Statement<'a> {
    let mut elements = ArenaVec::new_in(ast);

    // 1. static get observedAttributes() { ... }
    elements.push(build_observed_attributes_method(
        ast,
        is_external,
        class_name,
        observed_attributes,
    ));

    // 2. static [Symbol.hasInstance](instance) { ... }
    elements.push(build_has_instance_method(
        ast,
        is_external,
        class_name,
        getter_name,
    ));

    // 3. static getImplementation() { ... }
    elements.push(build_get_implementation_method(
        ast,
        is_external,
        class_name,
        getter_name,
    ));

    // 4. static get formAssociated() { ... }
    elements.push(build_form_associated_method(
        ast,
        is_external,
        class_name,
        getter_name,
    ));

    // 5. constructor() { ... }
    elements.push(build_constructor_method(
        ast,
        is_external,
        class_name,
        proxy_name,
        getter_name,
    ));

    // 6. attributeChangedCallback(name, oldValue, newValue) { ... }
    elements.push(build_attribute_changed_callback_method(ast));

    // 7. connectedCallback() { ... }
    elements.push(build_connected_callback_method(ast));

    // 8. __upgrade() { ... }
    elements.push(build_upgrade_method(
        ast,
        is_external,
        class_name,
        getter_name,
    ));

    let super_class = Expression::new_identifier(SPAN, "HTMLElement", ast);
    let class_body = ClassBody::boxed(SPAN, elements, ast);

    Statement::new_class_declaration(
        SPAN,
        ClassType::ClassDeclaration,
        ArenaVec::new_in(ast),
        Some(BindingIdentifier::new(SPAN, proxy_name, ast)),
        None,
        Some(ClassHeritage {
            expression: super_class,
            type_arguments: None,
        }),
        ArenaVec::new_in(ast),
        class_body,
        false,
        false,
        ast,
    )
}

fn build_observed_attributes_method<'a>(
    ast: &AstBuilder<'a>,
    is_external: bool,
    class_name: &'a str,
    observed_attributes: &[String],
) -> ClassElement<'a> {
    let ret_expr = if is_external {
        let type_of = Expression::new_unary_expression(
            SPAN,
            UnaryOperator::Typeof,
            Expression::new_identifier(SPAN, class_name, ast),
            ast,
        );
        let ne_undef = Expression::new_binary_expression(
            SPAN,
            type_of,
            BinaryOperator::StrictInequality,
            Expression::new_string_literal(SPAN, "undefined", None, ast),
            ast,
        );
        let class_obs = Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, class_name, ast),
            IdentifierName::new(SPAN, "observedAttributes", ast),
            false,
            ast,
        );
        let and_expr = Expression::new_logical_expression(
            SPAN,
            ne_undef,
            LogicalOperator::And,
            class_obs,
            ast,
        );
        let paren_and = Expression::new_parenthesized_expression(SPAN, and_expr, ast);
        Expression::new_logical_expression(
            SPAN,
            paren_and,
            LogicalOperator::Or,
            Expression::new_array_expression(SPAN, ArenaVec::new_in(ast), ast),
            ast,
        )
    } else {
        let mut elements = ArenaVec::new_in(ast);
        for attr in observed_attributes {
            elements.push(ArrayExpressionElement::from(
                Expression::new_string_literal(SPAN, ast.allocator().alloc_str(attr), None, ast),
            ));
        }
        Expression::new_array_expression(SPAN, elements, ast)
    };

    let mut stmts = ArenaVec::new_in(ast);
    stmts.push(Statement::new_return_statement(SPAN, Some(ret_expr), ast));
    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let func = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        false,
        false,
        None,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            ArenaVec::new_in(ast),
            None,
            ast,
        ),
        None,
        Some(body),
        ast,
    );

    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        PropertyKey::new_static_identifier(SPAN, "observedAttributes", ast),
        func,
        MethodDefinitionKind::Get,
        false,
        true, // static
        false,
        false,
        None,
        ast,
    )
}

fn build_has_instance_method<'a>(
    ast: &AstBuilder<'a>,
    is_external: bool,
    class_name: &'a str,
    getter_name: &'a str,
) -> ClassElement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    // super[Symbol.hasInstance](instance)
    let super_has_inst = Expression::new_call_expression(
        SPAN,
        Expression::new_computed_member_expression(
            SPAN,
            Expression::new_super(SPAN, ast),
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "Symbol", ast),
                IdentifierName::new(SPAN, "hasInstance", ast),
                false,
                ast,
            ),
            false,
            ast,
        ),
        None,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(Expression::new_identifier(
                SPAN, "instance", ast,
            )));
            a
        },
        false,
        ast,
    );

    let or_expr = if is_external {
        let type_of = Expression::new_unary_expression(
            SPAN,
            UnaryOperator::Typeof,
            Expression::new_identifier(SPAN, class_name, ast),
            ast,
        );
        let ne_undef = Expression::new_binary_expression(
            SPAN,
            type_of,
            BinaryOperator::StrictInequality,
            Expression::new_string_literal(SPAN, "undefined", None, ast),
            ast,
        );
        let and1 = Expression::new_logical_expression(
            SPAN,
            ne_undef,
            LogicalOperator::And,
            Expression::new_identifier(SPAN, class_name, ast),
            ast,
        );
        let inst_of = Expression::new_binary_expression(
            SPAN,
            Expression::new_identifier(SPAN, "instance", ast),
            BinaryOperator::Instanceof,
            Expression::new_identifier(SPAN, class_name, ast),
            ast,
        );
        let and2 =
            Expression::new_logical_expression(SPAN, and1, LogicalOperator::And, inst_of, ast);
        let paren_and = Expression::new_parenthesized_expression(SPAN, and2, ast);
        Expression::new_logical_expression(
            SPAN,
            paren_and,
            LogicalOperator::Or,
            super_has_inst,
            ast,
        )
    } else {
        let mut d = ArenaVec::new_in(ast);
        d.push(VariableDeclarator::new(
            SPAN,
            BindingPattern::new_binding_identifier(SPAN, "Impl", ast),
            None,
            Some(Expression::new_call_expression(
                SPAN,
                Expression::new_identifier(SPAN, getter_name, ast),
                None,
                ArenaVec::new_in(ast),
                false,
                ast,
            )),
            false,
            ast,
        ));
        stmts.push(Statement::new_variable_declaration(
            SPAN,
            VariableDeclarationKind::Const,
            d,
            false,
            ast,
        ));

        let inst_of = Expression::new_binary_expression(
            SPAN,
            Expression::new_identifier(SPAN, "instance", ast),
            BinaryOperator::Instanceof,
            Expression::new_identifier(SPAN, "Impl", ast),
            ast,
        );
        let and_expr = Expression::new_logical_expression(
            SPAN,
            Expression::new_identifier(SPAN, "Impl", ast),
            LogicalOperator::And,
            inst_of,
            ast,
        );
        let paren_and = Expression::new_parenthesized_expression(SPAN, and_expr, ast);
        Expression::new_logical_expression(
            SPAN,
            paren_and,
            LogicalOperator::Or,
            super_has_inst,
            ast,
        )
    };

    stmts.push(Statement::new_return_statement(SPAN, Some(or_expr), ast));
    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);

    let mut params = ArenaVec::new_in(ast);
    params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "instance", ast),
        ast,
    ));

    let func = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        false,
        false,
        None,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            params,
            None,
            ast,
        ),
        None,
        Some(body),
        ast,
    );

    let key_expr = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "Symbol", ast),
        IdentifierName::new(SPAN, "hasInstance", ast),
        false,
        ast,
    );

    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        PropertyKey::from(key_expr),
        func,
        MethodDefinitionKind::Method,
        true, // computed: true
        true, // static: true
        false,
        false,
        None,
        ast,
    )
}

fn build_get_implementation_method<'a>(
    ast: &AstBuilder<'a>,
    is_external: bool,
    class_name: &'a str,
    getter_name: &'a str,
) -> ClassElement<'a> {
    let ret_expr = if is_external {
        Expression::new_identifier(SPAN, class_name, ast)
    } else {
        Expression::new_call_expression(
            SPAN,
            Expression::new_identifier(SPAN, getter_name, ast),
            None,
            ArenaVec::new_in(ast),
            false,
            ast,
        )
    };
    let mut stmts = ArenaVec::new_in(ast);
    stmts.push(Statement::new_return_statement(SPAN, Some(ret_expr), ast));
    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let func = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        false,
        false,
        None,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            ArenaVec::new_in(ast),
            None,
            ast,
        ),
        None,
        Some(body),
        ast,
    );
    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        PropertyKey::new_static_identifier(SPAN, "getImplementation", ast),
        func,
        MethodDefinitionKind::Method,
        false,
        true, // static: true
        false,
        false,
        None,
        ast,
    )
}

fn build_form_associated_method<'a>(
    ast: &AstBuilder<'a>,
    is_external: bool,
    class_name: &'a str,
    getter_name: &'a str,
) -> ClassElement<'a> {
    let mut stmts = ArenaVec::new_in(ast);
    let bool_arg = if is_external {
        let type_of = Expression::new_unary_expression(
            SPAN,
            UnaryOperator::Typeof,
            Expression::new_identifier(SPAN, class_name, ast),
            ast,
        );
        let ne_undef = Expression::new_binary_expression(
            SPAN,
            type_of,
            BinaryOperator::StrictInequality,
            Expression::new_string_literal(SPAN, "undefined", None, ast),
            ast,
        );
        let and1 = Expression::new_logical_expression(
            SPAN,
            ne_undef,
            LogicalOperator::And,
            Expression::new_identifier(SPAN, class_name, ast),
            ast,
        );
        let class_fa = Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, class_name, ast),
            IdentifierName::new(SPAN, "formAssociated", ast),
            false,
            ast,
        );
        Expression::new_logical_expression(SPAN, and1, LogicalOperator::And, class_fa, ast)
    } else {
        let mut d = ArenaVec::new_in(ast);
        d.push(VariableDeclarator::new(
            SPAN,
            BindingPattern::new_binding_identifier(SPAN, "Impl", ast),
            None,
            Some(Expression::new_call_expression(
                SPAN,
                Expression::new_identifier(SPAN, getter_name, ast),
                None,
                ArenaVec::new_in(ast),
                false,
                ast,
            )),
            false,
            ast,
        ));
        stmts.push(Statement::new_variable_declaration(
            SPAN,
            VariableDeclarationKind::Const,
            d,
            false,
            ast,
        ));
        let impl_fa = Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "Impl", ast),
            IdentifierName::new(SPAN, "formAssociated", ast),
            false,
            ast,
        );
        Expression::new_logical_expression(
            SPAN,
            Expression::new_identifier(SPAN, "Impl", ast),
            LogicalOperator::And,
            impl_fa,
            ast,
        )
    };

    let mut call_args = ArenaVec::new_in(ast);
    call_args.push(Argument::from(bool_arg));
    let bool_call = Expression::new_call_expression(
        SPAN,
        Expression::new_identifier(SPAN, "Boolean", ast),
        None,
        call_args,
        false,
        ast,
    );
    stmts.push(Statement::new_return_statement(SPAN, Some(bool_call), ast));
    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let func = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        false,
        false,
        None,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            ArenaVec::new_in(ast),
            None,
            ast,
        ),
        None,
        Some(body),
        ast,
    );
    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        PropertyKey::new_static_identifier(SPAN, "formAssociated", ast),
        func,
        MethodDefinitionKind::Get,
        false,
        true, // static: true
        false,
        false,
        None,
        ast,
    )
}

fn build_constructor_method<'a>(
    ast: &AstBuilder<'a>,
    is_external: bool,
    class_name: &'a str,
    proxy_name: &'a str,
    getter_name: &'a str,
) -> ClassElement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    let real_class_init = if is_external {
        let type_of = Expression::new_unary_expression(
            SPAN,
            UnaryOperator::Typeof,
            Expression::new_identifier(SPAN, class_name, ast),
            ast,
        );
        let cond = Expression::new_binary_expression(
            SPAN,
            type_of,
            BinaryOperator::StrictInequality,
            Expression::new_string_literal(SPAN, "undefined", None, ast),
            ast,
        );
        Expression::new_conditional_expression(
            SPAN,
            cond,
            Expression::new_identifier(SPAN, class_name, ast),
            Expression::new_null_literal(SPAN, ast),
            ast,
        )
    } else {
        Expression::new_call_expression(
            SPAN,
            Expression::new_identifier(SPAN, getter_name, ast),
            None,
            ArenaVec::new_in(ast),
            false,
            ast,
        )
    };

    let mut d = ArenaVec::new_in(ast);
    d.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "RealClass", ast),
        None,
        Some(real_class_init),
        false,
        ast,
    ));
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        d,
        false,
        ast,
    ));

    // if (RealClass) { ... }
    let mut if_real_stmts = ArenaVec::new_in(ast);

    let get_proto = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "Object", ast),
            IdentifierName::new(SPAN, "getPrototypeOf", ast),
            false,
            ast,
        ),
        None,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, proxy_name, ast),
                IdentifierName::new(SPAN, "prototype", ast),
                false,
                ast,
            )));
            a
        },
        false,
        ast,
    );
    let real_proto = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "RealClass", ast),
        IdentifierName::new(SPAN, "prototype", ast),
        false,
        ast,
    );
    let proto_ne = Expression::new_binary_expression(
        SPAN,
        get_proto,
        BinaryOperator::StrictInequality,
        real_proto,
        ast,
    );

    let mut set_proto_stmts = ArenaVec::new_in(ast);
    set_proto_stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "Object", ast),
                IdentifierName::new(SPAN, "setPrototypeOf", ast),
                false,
                ast,
            ),
            None,
            {
                let mut a = ArenaVec::new_in(ast);
                a.push(Argument::from(Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, proxy_name, ast),
                    IdentifierName::new(SPAN, "prototype", ast),
                    false,
                    ast,
                )));
                a.push(Argument::from(Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, "RealClass", ast),
                    IdentifierName::new(SPAN, "prototype", ast),
                    false,
                    ast,
                )));
                a
            },
            false,
            ast,
        ),
        ast,
    ));
    set_proto_stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "Object", ast),
                IdentifierName::new(SPAN, "setPrototypeOf", ast),
                false,
                ast,
            ),
            None,
            {
                let mut a = ArenaVec::new_in(ast);
                a.push(Argument::from(Expression::new_identifier(
                    SPAN, proxy_name, ast,
                )));
                a.push(Argument::from(Expression::new_identifier(
                    SPAN,
                    "RealClass",
                    ast,
                )));
                a
            },
            false,
            ast,
        ),
        ast,
    ));

    if_real_stmts.push(Statement::new_if_statement(
        SPAN,
        proto_ne,
        Statement::new_block_statement(SPAN, set_proto_stmts, ast),
        None,
        ast,
    ));

    let reflect_construct = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "Reflect", ast),
            IdentifierName::new(SPAN, "construct", ast),
            false,
            ast,
        ),
        None,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(Expression::new_identifier(
                SPAN,
                "RealClass",
                ast,
            )));
            a.push(Argument::from(Expression::new_array_expression(
                SPAN,
                ArenaVec::new_in(ast),
                ast,
            )));
            a.push(Argument::from(Expression::new_new_target(SPAN, ast)));
            a
        },
        false,
        ast,
    );
    if_real_stmts.push(Statement::new_return_statement(
        SPAN,
        Some(reflect_construct),
        ast,
    ));

    stmts.push(Statement::new_if_statement(
        SPAN,
        Expression::new_identifier(SPAN, "RealClass", ast),
        Statement::new_block_statement(SPAN, if_real_stmts, ast),
        None,
        ast,
    ));

    // super();
    stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_super(SPAN, ast),
            None,
            ArenaVec::new_in(ast),
            false,
            ast,
        ),
        ast,
    ));

    // this.__upgraded = false;
    stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "__upgraded", ast),
                false,
                ast,
            )),
            Expression::new_boolean_literal(SPAN, false, ast),
            ast,
        ),
        ast,
    ));

    // this.__attrBuffer = null;
    stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "__attrBuffer", ast),
                false,
                ast,
            )),
            Expression::new_null_literal(SPAN, ast),
            ast,
        ),
        ast,
    ));

    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let func = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        false,
        false,
        None,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            ArenaVec::new_in(ast),
            None,
            ast,
        ),
        None,
        Some(body),
        ast,
    );

    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        PropertyKey::new_static_identifier(SPAN, "constructor", ast),
        func,
        MethodDefinitionKind::Constructor,
        false,
        false,
        false,
        false,
        None,
        ast,
    )
}

fn build_attribute_changed_callback_method<'a>(ast: &AstBuilder<'a>) -> ClassElement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    let super_cb_type = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::Typeof,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_super(SPAN, ast),
            IdentifierName::new(SPAN, "attributeChangedCallback", ast),
            false,
            ast,
        ),
        ast,
    );
    let is_fn = Expression::new_binary_expression(
        SPAN,
        super_cb_type,
        BinaryOperator::StrictEquality,
        Expression::new_string_literal(SPAN, "function", None, ast),
        ast,
    );
    let call_super_cb = Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_super(SPAN, ast),
                IdentifierName::new(SPAN, "attributeChangedCallback", ast),
                false,
                ast,
            ),
            None,
            {
                let mut a = ArenaVec::new_in(ast);
                a.push(Argument::from(Expression::new_identifier(
                    SPAN, "name", ast,
                )));
                a.push(Argument::from(Expression::new_identifier(
                    SPAN, "oldValue", ast,
                )));
                a.push(Argument::from(Expression::new_identifier(
                    SPAN, "newValue", ast,
                )));
                a
            },
            false,
            ast,
        ),
        ast,
    );
    let if_super_cb = Statement::new_if_statement(
        SPAN,
        is_fn,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(call_super_cb);
                s
            },
            ast,
        ),
        None,
        ast,
    );

    let mut else_stmts = ArenaVec::new_in(ast);
    let not_buffer = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::LogicalNot,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "__attrBuffer", ast),
            false,
            ast,
        ),
        ast,
    );
    let assign_map = Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "__attrBuffer", ast),
                false,
                ast,
            )),
            Expression::new_new_expression(
                SPAN,
                Expression::new_identifier(SPAN, "Map", ast),
                None,
                ArenaVec::new_in(ast),
                ast,
            ),
            ast,
        ),
        ast,
    );
    else_stmts.push(Statement::new_if_statement(
        SPAN, not_buffer, assign_map, None, ast,
    ));

    else_stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_this_expression(SPAN, ast),
                    IdentifierName::new(SPAN, "__attrBuffer", ast),
                    false,
                    ast,
                ),
                IdentifierName::new(SPAN, "set", ast),
                false,
                ast,
            ),
            None,
            {
                let mut a = ArenaVec::new_in(ast);
                a.push(Argument::from(Expression::new_identifier(
                    SPAN, "name", ast,
                )));
                a.push(Argument::from(Expression::new_identifier(
                    SPAN, "newValue", ast,
                )));
                a
            },
            false,
            ast,
        ),
        ast,
    ));

    let consequent = Statement::new_block_statement(
        SPAN,
        {
            let mut s = ArenaVec::new_in(ast);
            s.push(if_super_cb);
            s
        },
        ast,
    );
    let alternate = Statement::new_block_statement(SPAN, else_stmts, ast);

    let test_upgraded = Expression::new_static_member_expression(
        SPAN,
        Expression::new_this_expression(SPAN, ast),
        IdentifierName::new(SPAN, "__upgraded", ast),
        false,
        ast,
    );

    stmts.push(Statement::new_if_statement(
        SPAN,
        test_upgraded,
        consequent,
        Some(alternate),
        ast,
    ));

    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let mut params = ArenaVec::new_in(ast);
    params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "name", ast),
        ast,
    ));
    params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "oldValue", ast),
        ast,
    ));
    params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "newValue", ast),
        ast,
    ));
    let func = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        false,
        false,
        None,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            params,
            None,
            ast,
        ),
        None,
        Some(body),
        ast,
    );

    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        PropertyKey::new_static_identifier(SPAN, "attributeChangedCallback", ast),
        func,
        MethodDefinitionKind::Method,
        false,
        false,
        false,
        false,
        None,
        ast,
    )
}

fn build_connected_callback_method<'a>(ast: &AstBuilder<'a>) -> ClassElement<'a> {
    let mut stmts = ArenaVec::new_in(ast);
    stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "__upgrade", ast),
                false,
                ast,
            ),
            None,
            ArenaVec::new_in(ast),
            false,
            ast,
        ),
        ast,
    ));
    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let func = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        false,
        false,
        None,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            ArenaVec::new_in(ast),
            None,
            ast,
        ),
        None,
        Some(body),
        ast,
    );
    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        PropertyKey::new_static_identifier(SPAN, "connectedCallback", ast),
        func,
        MethodDefinitionKind::Method,
        false,
        false,
        false,
        false,
        None,
        ast,
    )
}

fn build_upgrade_method<'a>(
    ast: &AstBuilder<'a>,
    is_external: bool,
    class_name: &'a str,
    getter_name: &'a str,
) -> ClassElement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    // 1. if (this.__upgraded) return this;
    stmts.push(Statement::new_if_statement(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "__upgraded", ast),
            false,
            ast,
        ),
        Statement::new_return_statement(
            SPAN,
            Some(Expression::new_this_expression(SPAN, ast)),
            ast,
        ),
        None,
        ast,
    ));

    // 2. this.__upgraded = true;
    stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "__upgraded", ast),
                false,
                ast,
            )),
            Expression::new_boolean_literal(SPAN, true, ast),
            ast,
        ),
        ast,
    ));

    // 3. const RealClass = ...;
    let real_class_init = if is_external {
        Expression::new_identifier(SPAN, class_name, ast)
    } else {
        Expression::new_call_expression(
            SPAN,
            Expression::new_identifier(SPAN, getter_name, ast),
            None,
            ArenaVec::new_in(ast),
            false,
            ast,
        )
    };
    let mut d = ArenaVec::new_in(ast);
    d.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "RealClass", ast),
        None,
        Some(real_class_init),
        false,
        ast,
    ));
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        d,
        false,
        ast,
    ));

    // 4. if (!RealClass) return this;
    stmts.push(Statement::new_if_statement(
        SPAN,
        Expression::new_unary_expression(
            SPAN,
            UnaryOperator::LogicalNot,
            Expression::new_identifier(SPAN, "RealClass", ast),
            ast,
        ),
        Statement::new_return_statement(
            SPAN,
            Some(Expression::new_this_expression(SPAN, ast)),
            ast,
        ),
        None,
        ast,
    ));

    // 5. if (typeof RealClass.finalize === 'function') { RealClass.finalize(); }
    let fnz_type = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::Typeof,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "RealClass", ast),
            IdentifierName::new(SPAN, "finalize", ast),
            false,
            ast,
        ),
        ast,
    );
    let fnz_is_fn = Expression::new_binary_expression(
        SPAN,
        fnz_type,
        BinaryOperator::StrictEquality,
        Expression::new_string_literal(SPAN, "function", None, ast),
        ast,
    );
    let call_fnz = Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "RealClass", ast),
                IdentifierName::new(SPAN, "finalize", ast),
                false,
                ast,
            ),
            None,
            ArenaVec::new_in(ast),
            false,
            ast,
        ),
        ast,
    );
    stmts.push(Statement::new_if_statement(
        SPAN,
        fnz_is_fn,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(call_fnz);
                s
            },
            ast,
        ),
        None,
        ast,
    ));

    // 6. Object.setPrototypeOf(this, RealClass.prototype);
    stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "Object", ast),
                IdentifierName::new(SPAN, "setPrototypeOf", ast),
                false,
                ast,
            ),
            None,
            {
                let mut a = ArenaVec::new_in(ast);
                a.push(Argument::from(Expression::new_this_expression(SPAN, ast)));
                a.push(Argument::from(Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, "RealClass", ast),
                    IdentifierName::new(SPAN, "prototype", ast),
                    false,
                    ast,
                )));
                a
            },
            false,
            ast,
        ),
        ast,
    ));

    // 7. if (RealClass.elementStyles && !this.shadowRoot && typeof this.attachShadow === 'function') { ... }
    stmts.push(build_upgrade_shadow_root(ast));

    // 8. if (!this.renderOptions) { this.renderOptions = { host: this }; }
    stmts.push(build_upgrade_render_options(ast));

    // 9. this.isUpdatePending = false; this.hasUpdated = false; this._$Em = null;
    stmts.push(build_upgrade_flags(ast));

    // 10. _$Ev callback
    stmts.push(build_upgrade_ev(ast));

    // 11. if (this._$AL === undefined) { this._$AL = new Map(); }
    stmts.push(build_upgrade_al(ast));

    // 12. if (this.__attrBuffer) { ... }
    stmts.push(build_upgrade_attr_buffer(ast));

    // 13. internals & customStates
    stmts.push(build_upgrade_internals(ast));
    stmts.push(build_upgrade_custom_states(ast));

    // 14. instance properties reflection
    stmts.push(build_upgrade_reflect_instance(ast));

    // 15. initial collections: initialReflectedProperties, assumeInteractionOn, validators, emittedEvents
    stmts.push(build_upgrade_initial_collections(ast));

    // 16. connectedCallback & requestUpdate
    stmts.push(build_upgrade_connected_cb(ast, is_external));

    // 17. return this;
    stmts.push(Statement::new_return_statement(
        SPAN,
        Some(Expression::new_this_expression(SPAN, ast)),
        ast,
    ));

    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let func = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        false,
        false,
        None,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            ArenaVec::new_in(ast),
            None,
            ast,
        ),
        None,
        Some(body),
        ast,
    );
    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        PropertyKey::new_static_identifier(SPAN, "__upgrade", ast),
        func,
        MethodDefinitionKind::Method,
        false,
        false,
        false,
        false,
        None,
        ast,
    )
}

fn build_upgrade_shadow_root<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    // if (RealClass.elementStyles && !this.shadowRoot && typeof this.attachShadow === 'function')
    let c1 = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "RealClass", ast),
        IdentifierName::new(SPAN, "elementStyles", ast),
        false,
        ast,
    );
    let c2 = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::LogicalNot,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "shadowRoot", ast),
            false,
            ast,
        ),
        ast,
    );
    let and1 = Expression::new_logical_expression(SPAN, c1, LogicalOperator::And, c2, ast);
    let attach_type = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::Typeof,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "attachShadow", ast),
            false,
            ast,
        ),
        ast,
    );
    let is_fn = Expression::new_binary_expression(
        SPAN,
        attach_type,
        BinaryOperator::StrictEquality,
        Expression::new_string_literal(SPAN, "function", None, ast),
        ast,
    );
    let test_expr =
        Expression::new_logical_expression(SPAN, and1, LogicalOperator::And, is_fn, ast);

    let mut body_stmts = ArenaVec::new_in(ast);
    // const root = this.attachShadow(RealClass.shadowRootOptions || { mode: 'open' });
    let mut default_mode_props = ArenaVec::new_in(ast);
    default_mode_props.push(ObjectPropertyKind::new_object_property(
        SPAN,
        PropertyKind::Init,
        PropertyKey::new_static_identifier(SPAN, "mode", ast),
        Expression::new_string_literal(SPAN, "open", None, ast),
        false,
        false,
        false,
        ast,
    ));
    let default_mode = Expression::new_object_expression(SPAN, default_mode_props, ast);
    let shadow_opts = Expression::new_logical_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "RealClass", ast),
            IdentifierName::new(SPAN, "shadowRootOptions", ast),
            false,
            ast,
        ),
        LogicalOperator::Or,
        default_mode,
        ast,
    );
    let call_attach = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "attachShadow", ast),
            false,
            ast,
        ),
        None,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(shadow_opts));
            a
        },
        false,
        ast,
    );
    let mut root_decl = ArenaVec::new_in(ast);
    root_decl.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "root", ast),
        None,
        Some(call_attach),
        false,
        ast,
    ));
    body_stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        root_decl,
        false,
        ast,
    ));

    // if (Array.isArray(RealClass.elementStyles)) {
    //   root.adoptedStyleSheets = RealClass.elementStyles.map((s) => s?.styleSheet || s).filter(Boolean);
    // } else if (RealClass.elementStyles?.styleSheet) {
    //   root.adoptedStyleSheets = [RealClass.elementStyles.styleSheet];
    // }
    let is_arr_call = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "Array", ast),
            IdentifierName::new(SPAN, "isArray", ast),
            false,
            ast,
        ),
        None,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "RealClass", ast),
                IdentifierName::new(SPAN, "elementStyles", ast),
                false,
                ast,
            )));
            a
        },
        false,
        ast,
    );

    // root.adoptedStyleSheets = RealClass.elementStyles.map((s) => s?.styleSheet || s).filter(Boolean);
    let s_or = Expression::new_logical_expression(
        SPAN,
        Expression::new_chain_expression(
            SPAN,
            ChainElement::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "s", ast),
                IdentifierName::new(SPAN, "styleSheet", ast),
                true,
                ast,
            ),
            ast,
        ),
        LogicalOperator::Or,
        Expression::new_identifier(SPAN, "s", ast),
        ast,
    );
    let mut s_params = ArenaVec::new_in(ast);
    s_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "s", ast),
        ast,
    ));
    let arrow_s = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            s_params,
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::from(s_or),
        ast,
    );
    let map_call = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "RealClass", ast),
                IdentifierName::new(SPAN, "elementStyles", ast),
                false,
                ast,
            ),
            IdentifierName::new(SPAN, "map", ast),
            false,
            ast,
        ),
        None,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(arrow_s));
            a
        },
        false,
        ast,
    );
    let filter_call = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            map_call,
            IdentifierName::new(SPAN, "filter", ast),
            false,
            ast,
        ),
        None,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(Expression::new_identifier(
                SPAN, "Boolean", ast,
            )));
            a
        },
        false,
        ast,
    );
    let assign_arr = Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "root", ast),
                IdentifierName::new(SPAN, "adoptedStyleSheets", ast),
                false,
                ast,
            )),
            filter_call,
            ast,
        ),
        ast,
    );

    // else if (RealClass.elementStyles?.styleSheet) { root.adoptedStyleSheets = [RealClass.elementStyles.styleSheet]; }
    let es_sheet = Expression::new_chain_expression(
        SPAN,
        ChainElement::new_static_member_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "RealClass", ast),
                IdentifierName::new(SPAN, "elementStyles", ast),
                false,
                ast,
            ),
            IdentifierName::new(SPAN, "styleSheet", ast),
            true,
            ast,
        ),
        ast,
    );
    let mut single_elem = ArenaVec::new_in(ast);
    single_elem.push(ArrayExpressionElement::from(
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "RealClass", ast),
                IdentifierName::new(SPAN, "elementStyles", ast),
                false,
                ast,
            ),
            IdentifierName::new(SPAN, "styleSheet", ast),
            false,
            ast,
        ),
    ));
    let assign_single = Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "root", ast),
                IdentifierName::new(SPAN, "adoptedStyleSheets", ast),
                false,
                ast,
            )),
            Expression::new_array_expression(SPAN, single_elem, ast),
            ast,
        ),
        ast,
    );
    let if_single = Statement::new_if_statement(
        SPAN,
        es_sheet,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(assign_single);
                s
            },
            ast,
        ),
        None,
        ast,
    );

    body_stmts.push(Statement::new_if_statement(
        SPAN,
        is_arr_call,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(assign_arr);
                s
            },
            ast,
        ),
        Some(if_single),
        ast,
    ));

    Statement::new_if_statement(
        SPAN,
        test_expr,
        Statement::new_block_statement(SPAN, body_stmts, ast),
        None,
        ast,
    )
}

fn build_upgrade_render_options<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    // if (!this.renderOptions) { this.renderOptions = { host: this }; }
    let not_ro = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::LogicalNot,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "renderOptions", ast),
            false,
            ast,
        ),
        ast,
    );
    let mut ro_props = ArenaVec::new_in(ast);
    ro_props.push(ObjectPropertyKind::new_object_property(
        SPAN,
        PropertyKind::Init,
        PropertyKey::new_static_identifier(SPAN, "host", ast),
        Expression::new_this_expression(SPAN, ast),
        false,
        false,
        false,
        ast,
    ));
    let assign_ro = Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "renderOptions", ast),
                false,
                ast,
            )),
            Expression::new_object_expression(SPAN, ro_props, ast),
            ast,
        ),
        ast,
    );
    Statement::new_if_statement(
        SPAN,
        not_ro,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(assign_ro);
                s
            },
            ast,
        ),
        None,
        ast,
    )
}

fn build_upgrade_flags<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    // this.isUpdatePending = false; this.hasUpdated = false; this._$Em = null;
    let mut stmts = ArenaVec::new_in(ast);
    stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "isUpdatePending", ast),
                false,
                ast,
            )),
            Expression::new_boolean_literal(SPAN, false, ast),
            ast,
        ),
        ast,
    ));
    stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "hasUpdated", ast),
                false,
                ast,
            )),
            Expression::new_boolean_literal(SPAN, false, ast),
            ast,
        ),
        ast,
    ));
    stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "_$Em", ast),
                false,
                ast,
            )),
            Expression::new_null_literal(SPAN, ast),
            ast,
        ),
        ast,
    ));
    Statement::new_block_statement(SPAN, stmts, ast)
}

fn build_upgrade_ev<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    // if (typeof this._$Ev === 'function') { this._$Ev(); }
    // else if (typeof RealClass.prototype._$Ev === 'function') { RealClass.prototype._$Ev.call(this); }
    let this_ev_type = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::Typeof,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "_$Ev", ast),
            false,
            ast,
        ),
        ast,
    );
    let test_this_ev = Expression::new_binary_expression(
        SPAN,
        this_ev_type,
        BinaryOperator::StrictEquality,
        Expression::new_string_literal(SPAN, "function", None, ast),
        ast,
    );
    let call_this_ev = Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "_$Ev", ast),
                false,
                ast,
            ),
            None,
            ArenaVec::new_in(ast),
            false,
            ast,
        ),
        ast,
    );

    let proto_ev = Expression::new_static_member_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "RealClass", ast),
            IdentifierName::new(SPAN, "prototype", ast),
            false,
            ast,
        ),
        IdentifierName::new(SPAN, "_$Ev", ast),
        false,
        ast,
    );
    let proto_ev_type =
        Expression::new_unary_expression(SPAN, UnaryOperator::Typeof, proto_ev, ast);
    let test_proto_ev = Expression::new_binary_expression(
        SPAN,
        proto_ev_type,
        BinaryOperator::StrictEquality,
        Expression::new_string_literal(SPAN, "function", None, ast),
        ast,
    );
    let call_proto_ev = Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_static_member_expression(
                        SPAN,
                        Expression::new_identifier(SPAN, "RealClass", ast),
                        IdentifierName::new(SPAN, "prototype", ast),
                        false,
                        ast,
                    ),
                    IdentifierName::new(SPAN, "_$Ev", ast),
                    false,
                    ast,
                ),
                IdentifierName::new(SPAN, "call", ast),
                false,
                ast,
            ),
            None,
            {
                let mut a = ArenaVec::new_in(ast);
                a.push(Argument::from(Expression::new_this_expression(SPAN, ast)));
                a
            },
            false,
            ast,
        ),
        ast,
    );
    let else_if_proto = Statement::new_if_statement(
        SPAN,
        test_proto_ev,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(call_proto_ev);
                s
            },
            ast,
        ),
        None,
        ast,
    );

    Statement::new_if_statement(
        SPAN,
        test_this_ev,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(call_this_ev);
                s
            },
            ast,
        ),
        Some(else_if_proto),
        ast,
    )
}

fn build_upgrade_al<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    // if (this._$AL === undefined) { this._$AL = new Map(); }
    let test_al = Expression::new_binary_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "_$AL", ast),
            false,
            ast,
        ),
        BinaryOperator::StrictEquality,
        Expression::new_identifier(SPAN, "undefined", ast),
        ast,
    );
    let assign_al = Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "_$AL", ast),
                false,
                ast,
            )),
            Expression::new_new_expression(
                SPAN,
                Expression::new_identifier(SPAN, "Map", ast),
                None,
                ArenaVec::new_in(ast),
                ast,
            ),
            ast,
        ),
        ast,
    );
    Statement::new_if_statement(
        SPAN,
        test_al,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(assign_al);
                s
            },
            ast,
        ),
        None,
        ast,
    )
}

fn build_upgrade_attr_buffer<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    // if (this.__attrBuffer) {
    //   for (const [k, v] of this.__attrBuffer) {
    //     if (typeof this.attributeChangedCallback === 'function') {
    //       this.attributeChangedCallback(k, null, v);
    //     }
    //   }
    //   this.__attrBuffer = null;
    // }
    let test_buf = Expression::new_static_member_expression(
        SPAN,
        Expression::new_this_expression(SPAN, ast),
        IdentifierName::new(SPAN, "__attrBuffer", ast),
        false,
        ast,
    );

    let mut body_stmts = ArenaVec::new_in(ast);

    // loop body:
    let cb_type = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::Typeof,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "attributeChangedCallback", ast),
            false,
            ast,
        ),
        ast,
    );
    let is_fn = Expression::new_binary_expression(
        SPAN,
        cb_type,
        BinaryOperator::StrictEquality,
        Expression::new_string_literal(SPAN, "function", None, ast),
        ast,
    );
    let call_cb = Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "attributeChangedCallback", ast),
                false,
                ast,
            ),
            None,
            {
                let mut a = ArenaVec::new_in(ast);
                a.push(Argument::from(Expression::new_identifier(SPAN, "k", ast)));
                a.push(Argument::from(Expression::new_null_literal(SPAN, ast)));
                a.push(Argument::from(Expression::new_identifier(SPAN, "v", ast)));
                a
            },
            false,
            ast,
        ),
        ast,
    );
    let if_cb = Statement::new_if_statement(
        SPAN,
        is_fn,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(call_cb);
                s
            },
            ast,
        ),
        None,
        ast,
    );

    // for (const [k, v] of this.__attrBuffer)
    let mut arr_elems = ArenaVec::new_in(ast);
    arr_elems.push(Some(BindingPattern::new_binding_identifier(SPAN, "k", ast)));
    arr_elems.push(Some(BindingPattern::new_binding_identifier(SPAN, "v", ast)));
    let pat = BindingPattern::new_array_pattern(SPAN, arr_elems, None, ast);
    let mut left_decls = ArenaVec::new_in(ast);
    left_decls.push(VariableDeclarator::new(SPAN, pat, None, None, false, ast));
    let for_left = ForStatementLeft::VariableDeclaration(VariableDeclaration::boxed(
        SPAN,
        VariableDeclarationKind::Const,
        left_decls,
        false,
        ast,
    ));

    let for_of = Statement::new_for_of_statement(
        SPAN,
        false,
        for_left,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "__attrBuffer", ast),
            false,
            ast,
        ),
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(if_cb);
                s
            },
            ast,
        ),
        ast,
    );
    body_stmts.push(for_of);

    // this.__attrBuffer = null;
    body_stmts.push(Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "__attrBuffer", ast),
                false,
                ast,
            )),
            Expression::new_null_literal(SPAN, ast),
            ast,
        ),
        ast,
    ));

    Statement::new_if_statement(
        SPAN,
        test_buf,
        Statement::new_block_statement(SPAN, body_stmts, ast),
        None,
        ast,
    )
}

fn build_upgrade_internals<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    // if (!this.internals && typeof this.attachInternals === 'function') { try { this.internals = this.attachInternals(); } catch {} }
    let not_internals = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::LogicalNot,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "internals", ast),
            false,
            ast,
        ),
        ast,
    );
    let attach_type = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::Typeof,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "attachInternals", ast),
            false,
            ast,
        ),
        ast,
    );
    let is_fn = Expression::new_binary_expression(
        SPAN,
        attach_type,
        BinaryOperator::StrictEquality,
        Expression::new_string_literal(SPAN, "function", None, ast),
        ast,
    );
    let test_expr =
        Expression::new_logical_expression(SPAN, not_internals, LogicalOperator::And, is_fn, ast);

    let assign = Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "internals", ast),
                false,
                ast,
            )),
            Expression::new_call_expression(
                SPAN,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_this_expression(SPAN, ast),
                    IdentifierName::new(SPAN, "attachInternals", ast),
                    false,
                    ast,
                ),
                None,
                ArenaVec::new_in(ast),
                false,
                ast,
            ),
            ast,
        ),
        ast,
    );
    let try_block = BlockStatement::boxed(
        SPAN,
        {
            let mut s = ArenaVec::new_in(ast);
            s.push(assign);
            s
        },
        ast,
    );
    let catch_block = CatchClause::boxed(
        SPAN,
        None,
        BlockStatement::boxed(SPAN, ArenaVec::new_in(ast), ast),
        ast,
    );
    let try_stmt = Statement::new_try_statement(SPAN, try_block, Some(catch_block), None, ast);

    Statement::new_if_statement(
        SPAN,
        test_expr,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(try_stmt);
                s
            },
            ast,
        ),
        None,
        ast,
    )
}

fn build_upgrade_custom_states<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    // if (!this.customStates && this.internals?.states) { ... }
    let not_cs = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::LogicalNot,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "customStates", ast),
            false,
            ast,
        ),
        ast,
    );
    let int_states = Expression::new_chain_expression(
        SPAN,
        ChainElement::new_static_member_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "internals", ast),
                false,
                ast,
            ),
            IdentifierName::new(SPAN, "states", ast),
            true,
            ast,
        ),
        ast,
    );
    let test_expr =
        Expression::new_logical_expression(SPAN, not_cs, LogicalOperator::And, int_states, ast);

    // set: (customState, active) => { if (!this.internals?.states) return; try { if (active) this.internals.states.add(customState); else this.internals.states.delete(customState); } catch {} }
    let mut set_fn_stmts = ArenaVec::new_in(ast);
    let not_states = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::LogicalNot,
        Expression::new_chain_expression(
            SPAN,
            ChainElement::new_static_member_expression(
                SPAN,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_this_expression(SPAN, ast),
                    IdentifierName::new(SPAN, "internals", ast),
                    false,
                    ast,
                ),
                IdentifierName::new(SPAN, "states", ast),
                true,
                ast,
            ),
            ast,
        ),
        ast,
    );
    set_fn_stmts.push(Statement::new_if_statement(
        SPAN,
        not_states,
        Statement::new_return_statement(SPAN, None, ast),
        None,
        ast,
    ));

    let call_add = Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_static_member_expression(
                        SPAN,
                        Expression::new_this_expression(SPAN, ast),
                        IdentifierName::new(SPAN, "internals", ast),
                        false,
                        ast,
                    ),
                    IdentifierName::new(SPAN, "states", ast),
                    false,
                    ast,
                ),
                IdentifierName::new(SPAN, "add", ast),
                false,
                ast,
            ),
            None,
            {
                let mut a = ArenaVec::new_in(ast);
                a.push(Argument::from(Expression::new_identifier(
                    SPAN,
                    "customState",
                    ast,
                )));
                a
            },
            false,
            ast,
        ),
        ast,
    );
    let call_del = Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_static_member_expression(
                        SPAN,
                        Expression::new_this_expression(SPAN, ast),
                        IdentifierName::new(SPAN, "internals", ast),
                        false,
                        ast,
                    ),
                    IdentifierName::new(SPAN, "states", ast),
                    false,
                    ast,
                ),
                IdentifierName::new(SPAN, "delete", ast),
                false,
                ast,
            ),
            None,
            {
                let mut a = ArenaVec::new_in(ast);
                a.push(Argument::from(Expression::new_identifier(
                    SPAN,
                    "customState",
                    ast,
                )));
                a
            },
            false,
            ast,
        ),
        ast,
    );
    let if_active = Statement::new_if_statement(
        SPAN,
        Expression::new_identifier(SPAN, "active", ast),
        call_add,
        Some(call_del),
        ast,
    );
    let try_set = Statement::new_try_statement(
        SPAN,
        BlockStatement::boxed(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(if_active);
                s
            },
            ast,
        ),
        Some(CatchClause::boxed(
            SPAN,
            None,
            BlockStatement::boxed(SPAN, ArenaVec::new_in(ast), ast),
            ast,
        )),
        None,
        ast,
    );
    set_fn_stmts.push(try_set);

    let mut set_params = ArenaVec::new_in(ast);
    set_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "customState", ast),
        ast,
    ));
    set_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "active", ast),
        ast,
    ));
    let arrow_set = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            set_params,
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::FunctionBody(FunctionBody::boxed(
            SPAN,
            ArenaVec::new_in(ast),
            set_fn_stmts,
            ast,
        )),
        ast,
    );

    // has: (customState) => { if (!this.internals?.states) return false; try { return this.internals.states.has(customState); } catch { return false; } }
    let mut has_fn_stmts = ArenaVec::new_in(ast);
    has_fn_stmts.push(Statement::new_if_statement(
        SPAN,
        Expression::new_unary_expression(
            SPAN,
            UnaryOperator::LogicalNot,
            Expression::new_chain_expression(
                SPAN,
                ChainElement::new_static_member_expression(
                    SPAN,
                    Expression::new_static_member_expression(
                        SPAN,
                        Expression::new_this_expression(SPAN, ast),
                        IdentifierName::new(SPAN, "internals", ast),
                        false,
                        ast,
                    ),
                    IdentifierName::new(SPAN, "states", ast),
                    true,
                    ast,
                ),
                ast,
            ),
            ast,
        ),
        Statement::new_return_statement(
            SPAN,
            Some(Expression::new_boolean_literal(SPAN, false, ast)),
            ast,
        ),
        None,
        ast,
    ));

    let call_has = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_this_expression(SPAN, ast),
                    IdentifierName::new(SPAN, "internals", ast),
                    false,
                    ast,
                ),
                IdentifierName::new(SPAN, "states", ast),
                false,
                ast,
            ),
            IdentifierName::new(SPAN, "has", ast),
            false,
            ast,
        ),
        None,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(Expression::new_identifier(
                SPAN,
                "customState",
                ast,
            )));
            a
        },
        false,
        ast,
    );
    let try_has = Statement::new_try_statement(
        SPAN,
        BlockStatement::boxed(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(Statement::new_return_statement(SPAN, Some(call_has), ast));
                s
            },
            ast,
        ),
        Some(CatchClause::boxed(
            SPAN,
            None,
            BlockStatement::boxed(
                SPAN,
                {
                    let mut s = ArenaVec::new_in(ast);
                    s.push(Statement::new_return_statement(
                        SPAN,
                        Some(Expression::new_boolean_literal(SPAN, false, ast)),
                        ast,
                    ));
                    s
                },
                ast,
            ),
            ast,
        )),
        None,
        ast,
    );
    has_fn_stmts.push(try_has);

    let mut has_params = ArenaVec::new_in(ast);
    has_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "customState", ast),
        ast,
    ));
    let arrow_has = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            has_params,
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::FunctionBody(FunctionBody::boxed(
            SPAN,
            ArenaVec::new_in(ast),
            has_fn_stmts,
            ast,
        )),
        ast,
    );

    let mut cs_props = ArenaVec::new_in(ast);
    cs_props.push(ObjectPropertyKind::new_object_property(
        SPAN,
        PropertyKind::Init,
        PropertyKey::new_static_identifier(SPAN, "set", ast),
        arrow_set,
        false,
        false,
        false,
        ast,
    ));
    cs_props.push(ObjectPropertyKind::new_object_property(
        SPAN,
        PropertyKind::Init,
        PropertyKey::new_static_identifier(SPAN, "has", ast),
        arrow_has,
        false,
        false,
        false,
        ast,
    ));
    let cs_obj = Expression::new_object_expression(SPAN, cs_props, ast);

    let assign_cs = Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "customStates", ast),
                false,
                ast,
            )),
            cs_obj,
            ast,
        ),
        ast,
    );

    Statement::new_if_statement(
        SPAN,
        test_expr,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(assign_cs);
                s
            },
            ast,
        ),
        None,
        ast,
    )
}

fn build_upgrade_reflect_instance<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    // try {
    //   const instance = Reflect.construct(RealClass, [], this.constructor);
    //   for (const k of Object.getOwnPropertyNames(instance)) {
    //     if (!(k in this)) {
    //       try { const desc = Object.getOwnPropertyDescriptor(instance, k); if (desc) Object.defineProperty(this, k, desc); } catch {}
    //     }
    //   }
    //   for (const s of Object.getOwnPropertySymbols(instance)) { ... }
    // } catch {
    //   try {
    //     const dummy = new RealClass();
    //     for (const k of Object.getOwnPropertyNames(dummy)) { ... }
    //   } catch {}
    // }
    let mut try_stmts = ArenaVec::new_in(ast);

    // const instance = Reflect.construct(RealClass, [], this.constructor);
    let reflect_inst = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "Reflect", ast),
            IdentifierName::new(SPAN, "construct", ast),
            false,
            ast,
        ),
        None,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(Expression::new_identifier(
                SPAN,
                "RealClass",
                ast,
            )));
            a.push(Argument::from(Expression::new_array_expression(
                SPAN,
                ArenaVec::new_in(ast),
                ast,
            )));
            a.push(Argument::from(Expression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "constructor", ast),
                false,
                ast,
            )));
            a
        },
        false,
        ast,
    );
    let mut inst_decl = ArenaVec::new_in(ast);
    inst_decl.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "instance", ast),
        None,
        Some(reflect_inst),
        false,
        ast,
    ));
    try_stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        inst_decl,
        false,
        ast,
    ));

    // for (const k of Object.getOwnPropertyNames(instance))
    try_stmts.push(build_copy_props_loop(
        ast,
        "instance",
        "getOwnPropertyNames",
        "k",
    ));
    // for (const s of Object.getOwnPropertySymbols(instance))
    try_stmts.push(build_copy_props_loop(
        ast,
        "instance",
        "getOwnPropertySymbols",
        "s",
    ));

    // catch block:
    let mut catch_stmts = ArenaVec::new_in(ast);
    let mut dummy_try_stmts = ArenaVec::new_in(ast);
    // const dummy = new RealClass();
    let new_real = Expression::new_new_expression(
        SPAN,
        Expression::new_identifier(SPAN, "RealClass", ast),
        None,
        ArenaVec::new_in(ast),
        ast,
    );
    let mut dummy_decl = ArenaVec::new_in(ast);
    dummy_decl.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "dummy", ast),
        None,
        Some(new_real),
        false,
        ast,
    ));
    dummy_try_stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        dummy_decl,
        false,
        ast,
    ));
    dummy_try_stmts.push(build_copy_props_loop(
        ast,
        "dummy",
        "getOwnPropertyNames",
        "k",
    ));

    catch_stmts.push(Statement::new_try_statement(
        SPAN,
        BlockStatement::boxed(SPAN, dummy_try_stmts, ast),
        Some(CatchClause::boxed(
            SPAN,
            None,
            BlockStatement::boxed(SPAN, ArenaVec::new_in(ast), ast),
            ast,
        )),
        None,
        ast,
    ));

    Statement::new_try_statement(
        SPAN,
        BlockStatement::boxed(SPAN, try_stmts, ast),
        Some(CatchClause::boxed(
            SPAN,
            None,
            BlockStatement::boxed(SPAN, catch_stmts, ast),
            ast,
        )),
        None,
        ast,
    )
}

fn build_copy_props_loop<'a>(
    ast: &AstBuilder<'a>,
    src_obj: &'a str,
    method_name: &'a str,
    var_name: &'a str,
) -> Statement<'a> {
    // if (!(k in this)) { try { const desc = Object.getOwnPropertyDescriptor(src_obj, k); if (desc) Object.defineProperty(this, k, desc); } catch {} }
    let k_in_this = Expression::new_binary_expression(
        SPAN,
        Expression::new_identifier(SPAN, var_name, ast),
        BinaryOperator::In,
        Expression::new_this_expression(SPAN, ast),
        ast,
    );
    let not_in = Expression::new_unary_expression(SPAN, UnaryOperator::LogicalNot, k_in_this, ast);

    let get_desc = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "Object", ast),
            IdentifierName::new(SPAN, "getOwnPropertyDescriptor", ast),
            false,
            ast,
        ),
        None,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(Expression::new_identifier(
                SPAN, src_obj, ast,
            )));
            a.push(Argument::from(Expression::new_identifier(
                SPAN, var_name, ast,
            )));
            a
        },
        false,
        ast,
    );
    let mut desc_decl = ArenaVec::new_in(ast);
    desc_decl.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "desc", ast),
        None,
        Some(get_desc),
        false,
        ast,
    ));

    let call_def = Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "Object", ast),
                IdentifierName::new(SPAN, "defineProperty", ast),
                false,
                ast,
            ),
            None,
            {
                let mut a = ArenaVec::new_in(ast);
                a.push(Argument::from(Expression::new_this_expression(SPAN, ast)));
                a.push(Argument::from(Expression::new_identifier(
                    SPAN, var_name, ast,
                )));
                a.push(Argument::from(Expression::new_identifier(
                    SPAN, "desc", ast,
                )));
                a
            },
            false,
            ast,
        ),
        ast,
    );
    let if_desc = Statement::new_if_statement(
        SPAN,
        Expression::new_identifier(SPAN, "desc", ast),
        call_def,
        None,
        ast,
    );

    let mut inner_try = ArenaVec::new_in(ast);
    inner_try.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        desc_decl,
        false,
        ast,
    ));
    inner_try.push(if_desc);

    let try_desc = Statement::new_try_statement(
        SPAN,
        BlockStatement::boxed(SPAN, inner_try, ast),
        Some(CatchClause::boxed(
            SPAN,
            None,
            BlockStatement::boxed(SPAN, ArenaVec::new_in(ast), ast),
            ast,
        )),
        None,
        ast,
    );

    let if_not_in = Statement::new_if_statement(
        SPAN,
        not_in,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(try_desc);
                s
            },
            ast,
        ),
        None,
        ast,
    );

    let get_names = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "Object", ast),
            IdentifierName::new(SPAN, method_name, ast),
            false,
            ast,
        ),
        None,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(Expression::new_identifier(
                SPAN, src_obj, ast,
            )));
            a
        },
        false,
        ast,
    );

    let mut left_decls = ArenaVec::new_in(ast);
    left_decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, var_name, ast),
        None,
        None,
        false,
        ast,
    ));
    let for_left = ForStatementLeft::VariableDeclaration(VariableDeclaration::boxed(
        SPAN,
        VariableDeclarationKind::Const,
        left_decls,
        false,
        ast,
    ));

    Statement::new_for_of_statement(
        SPAN,
        false,
        for_left,
        get_names,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(if_not_in);
                s
            },
            ast,
        ),
        ast,
    )
}

fn build_upgrade_initial_collections<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    // if (this.initialReflectedProperties === undefined) { this.initialReflectedProperties = new Map(); }
    stmts.push(build_init_map_prop(ast, "initialReflectedProperties"));
    // if (this.assumeInteractionOn === undefined) { this.assumeInteractionOn = []; }
    stmts.push(build_init_arr_prop(ast, "assumeInteractionOn"));
    // if (this.validators === undefined) { this.validators = []; }
    stmts.push(build_init_arr_prop(ast, "validators"));
    // if (this.emittedEvents === undefined) { this.emittedEvents = []; }
    stmts.push(build_init_arr_prop(ast, "emittedEvents"));

    Statement::new_block_statement(SPAN, stmts, ast)
}

fn build_init_map_prop<'a>(ast: &AstBuilder<'a>, prop_name: &'a str) -> Statement<'a> {
    let test_undef = Expression::new_binary_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, prop_name, ast),
            false,
            ast,
        ),
        BinaryOperator::StrictEquality,
        Expression::new_identifier(SPAN, "undefined", ast),
        ast,
    );
    let assign = Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, prop_name, ast),
                false,
                ast,
            )),
            Expression::new_new_expression(
                SPAN,
                Expression::new_identifier(SPAN, "Map", ast),
                None,
                ArenaVec::new_in(ast),
                ast,
            ),
            ast,
        ),
        ast,
    );
    Statement::new_if_statement(
        SPAN,
        test_undef,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(assign);
                s
            },
            ast,
        ),
        None,
        ast,
    )
}

fn build_init_arr_prop<'a>(ast: &AstBuilder<'a>, prop_name: &'a str) -> Statement<'a> {
    let test_undef = Expression::new_binary_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, prop_name, ast),
            false,
            ast,
        ),
        BinaryOperator::StrictEquality,
        Expression::new_identifier(SPAN, "undefined", ast),
        ast,
    );
    let assign = Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, prop_name, ast),
                false,
                ast,
            )),
            Expression::new_array_expression(SPAN, ArenaVec::new_in(ast), ast),
            ast,
        ),
        ast,
    );
    Statement::new_if_statement(
        SPAN,
        test_undef,
        Statement::new_block_statement(
            SPAN,
            {
                let mut s = ArenaVec::new_in(ast);
                s.push(assign);
                s
            },
            ast,
        ),
        None,
        ast,
    )
}

fn build_upgrade_connected_cb<'a>(ast: &AstBuilder<'a>, is_external: bool) -> Statement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    // if (typeof RealClass.prototype.connectedCallback === 'function') { RealClass.prototype.connectedCallback.call(this); }
    let real_cb = Expression::new_static_member_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "RealClass", ast),
            IdentifierName::new(SPAN, "prototype", ast),
            false,
            ast,
        ),
        IdentifierName::new(SPAN, "connectedCallback", ast),
        false,
        ast,
    );
    let real_cb_type = Expression::new_unary_expression(SPAN, UnaryOperator::Typeof, real_cb, ast);
    let test_real_cb = Expression::new_binary_expression(
        SPAN,
        real_cb_type,
        BinaryOperator::StrictEquality,
        Expression::new_string_literal(SPAN, "function", None, ast),
        ast,
    );
    let call_real_cb = Statement::new_expression_statement(
        SPAN,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_static_member_expression(
                        SPAN,
                        Expression::new_identifier(SPAN, "RealClass", ast),
                        IdentifierName::new(SPAN, "prototype", ast),
                        false,
                        ast,
                    ),
                    IdentifierName::new(SPAN, "connectedCallback", ast),
                    false,
                    ast,
                ),
                IdentifierName::new(SPAN, "call", ast),
                false,
                ast,
            ),
            None,
            {
                let mut a = ArenaVec::new_in(ast);
                a.push(Argument::from(Expression::new_this_expression(SPAN, ast)));
                a
            },
            false,
            ast,
        ),
        ast,
    );

    let if_real_cb = if is_external {
        // else if (typeof this.connectedCallback === 'function' && this.connectedCallback !== RealClass.prototype.connectedCallback) {
        //   RealClass.prototype.connectedCallback?.call(this);
        // }
        let this_cb = Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "connectedCallback", ast),
            false,
            ast,
        );
        let this_cb_type =
            Expression::new_unary_expression(SPAN, UnaryOperator::Typeof, this_cb, ast);
        let test_this_cb = Expression::new_binary_expression(
            SPAN,
            this_cb_type,
            BinaryOperator::StrictEquality,
            Expression::new_string_literal(SPAN, "function", None, ast),
            ast,
        );
        let ne_real_cb = Expression::new_binary_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "connectedCallback", ast),
                false,
                ast,
            ),
            BinaryOperator::StrictInequality,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, "RealClass", ast),
                    IdentifierName::new(SPAN, "prototype", ast),
                    false,
                    ast,
                ),
                IdentifierName::new(SPAN, "connectedCallback", ast),
                false,
                ast,
            ),
            ast,
        );
        let test_else = Expression::new_logical_expression(
            SPAN,
            test_this_cb,
            LogicalOperator::And,
            ne_real_cb,
            ast,
        );

        let call_real_opt = Statement::new_expression_statement(
            SPAN,
            Expression::new_chain_expression(
                SPAN,
                ChainElement::new_call_expression(
                    SPAN,
                    Expression::new_static_member_expression(
                        SPAN,
                        Expression::new_static_member_expression(
                            SPAN,
                            Expression::new_identifier(SPAN, "RealClass", ast),
                            IdentifierName::new(SPAN, "prototype", ast),
                            false,
                            ast,
                        ),
                        IdentifierName::new(SPAN, "connectedCallback", ast),
                        false,
                        ast,
                    ),
                    None,
                    {
                        let mut a = ArenaVec::new_in(ast);
                        a.push(Argument::from(Expression::new_this_expression(SPAN, ast)));
                        a
                    },
                    false,
                    ast,
                ),
                ast,
            ),
            ast,
        );
        let else_branch = Statement::new_if_statement(
            SPAN,
            test_else,
            Statement::new_block_statement(
                SPAN,
                {
                    let mut s = ArenaVec::new_in(ast);
                    s.push(call_real_opt);
                    s
                },
                ast,
            ),
            None,
            ast,
        );

        Statement::new_if_statement(
            SPAN,
            test_real_cb,
            Statement::new_block_statement(
                SPAN,
                {
                    let mut s = ArenaVec::new_in(ast);
                    s.push(call_real_cb);
                    s
                },
                ast,
            ),
            Some(else_branch),
            ast,
        )
    } else {
        Statement::new_if_statement(
            SPAN,
            test_real_cb,
            Statement::new_block_statement(
                SPAN,
                {
                    let mut s = ArenaVec::new_in(ast);
                    s.push(call_real_cb);
                    s
                },
                ast,
            ),
            None,
            ast,
        )
    };
    stmts.push(if_real_cb);

    if is_external {
        // if (typeof this.requestUpdate === 'function') { this.requestUpdate(); }
        let ru_type = Expression::new_unary_expression(
            SPAN,
            UnaryOperator::Typeof,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "requestUpdate", ast),
                false,
                ast,
            ),
            ast,
        );
        let test_ru = Expression::new_binary_expression(
            SPAN,
            ru_type,
            BinaryOperator::StrictEquality,
            Expression::new_string_literal(SPAN, "function", None, ast),
            ast,
        );
        let call_ru = Statement::new_expression_statement(
            SPAN,
            Expression::new_call_expression(
                SPAN,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_this_expression(SPAN, ast),
                    IdentifierName::new(SPAN, "requestUpdate", ast),
                    false,
                    ast,
                ),
                None,
                ArenaVec::new_in(ast),
                false,
                ast,
            ),
            ast,
        );
        stmts.push(Statement::new_if_statement(
            SPAN,
            test_ru,
            Statement::new_block_statement(
                SPAN,
                {
                    let mut s = ArenaVec::new_in(ast);
                    s.push(call_ru);
                    s
                },
                ast,
            ),
            None,
            ast,
        ));
    }

    Statement::new_block_statement(SPAN, stmts, ast)
}
