use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::ast_helpers::AstHelper;
use crate::template_parser::{BindingKind, ParsedTemplate};
use crate::vanilla::PropertyInfo;

/// Synthesizes module-level hoisted stylesheet and template constants:
/// ```js
/// const __lit_sheet_Foo = new CSSStyleSheet();
/// __lit_sheet_Foo.replaceSync(`<css>`);
/// const __lit_tmpl_Foo = document.createElement('template');
/// __lit_tmpl_Foo.innerHTML = `<html content>`;
/// ```
pub fn build_hoisted_statements<'a>(
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    styles_css: Option<&str>,
    html_content: &str,
    sheet_var: &str,
    tmpl_var: &str,
) -> Vec<Statement<'a>> {
    let helper = AstHelper::new(ast);
    let mut stmts = Vec::new();

    if let Some(css) = styles_css {
        // const __lit_sheet = new CSSStyleSheet();
        let new_css_sheet = Expression::new_new_expression(
            SPAN,
            helper.ident_ref("CSSStyleSheet"),
            None,
            ArenaVec::new_in(ast),
            ast,
        );
        stmts.push(helper.const_declaration(allocator.alloc_str(sheet_var), new_css_sheet));

        // __lit_sheet.replaceSync(`...`);
        let replace_sync = helper.static_member(
            helper.ident_ref(allocator.alloc_str(sheet_var)),
            "replaceSync",
            false,
        );
        let mut replace_args = ArenaVec::new_in(ast);
        replace_args.push(Argument::from(helper.string_lit(allocator.alloc_str(css))));
        let call_replace = helper.call_expr(replace_sync, replace_args, false);
        stmts.push(helper.expr_stmt(call_replace));
    }

    // const __lit_tmpl = document.createElement('template');
    let doc_create = helper.static_member(helper.ident_ref("document"), "createElement", false);
    let mut create_args = ArenaVec::new_in(ast);
    create_args.push(Argument::from(helper.string_lit("template")));
    let call_create = helper.call_expr(doc_create, create_args, false);
    stmts.push(helper.const_declaration(allocator.alloc_str(tmpl_var), call_create));

    // __lit_tmpl.innerHTML = `...`;
    let inner_html_target = AssignmentTarget::from(MemberExpression::new_static_member_expression(
        SPAN,
        helper.ident_ref(allocator.alloc_str(tmpl_var)),
        helper.ident_name("innerHTML"),
        false,
        ast,
    ));
    let assign_html = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        inner_html_target,
        helper.string_lit(allocator.alloc_str(html_content)),
        ast,
    );
    stmts.push(helper.expr_stmt(assign_html));

    stmts
}

/// Builds `static observedAttributes = ['attr1', 'attr2'];`
pub fn build_observed_attributes_element<'a>(
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    properties: &[PropertyInfo],
) -> Option<ClassElement<'a>> {
    let helper = AstHelper::new(ast);
    let observed: Vec<&PropertyInfo> = properties
        .iter()
        .filter(|p| !p.attribute_name.is_empty())
        .collect();
    if observed.is_empty() {
        return None;
    }

    let mut elements = ArenaVec::new_in(ast);
    for p in observed {
        elements.push(ArrayExpressionElement::from(
            helper.string_lit(allocator.alloc_str(&p.attribute_name)),
        ));
    }
    let arr_expr = Expression::new_array_expression(SPAN, elements, ast);

    Some(ClassElement::new_property_definition(
        SPAN,
        PropertyDefinitionType::PropertyDefinition,
        ArenaVec::new_in(ast),
        PropertyKey::new_static_identifier(SPAN, "observedAttributes", ast),
        None,
        Some(arr_expr),
        false,
        true, // static
        false,
        false,
        false,
        false,
        false,
        None,
        ast,
    ))
}

/// Builds native constructor:
/// ```js
/// constructor() {
///   super();
///   this.attachShadow({ mode: 'open' });
///   this.shadowRoot.adoptedStyleSheets = [sheet];
///   const __frag = tmpl.content.cloneNode(true);
///   ... node paths ...
///   this.shadowRoot.appendChild(__frag);
///   this._prop = defaultVal;
/// }
/// ```
pub fn build_constructor_element<'a>(
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    sheet_var: &str,
    tmpl_var: &str,
    has_styles: bool,
    parsed_template: &ParsedTemplate,
    properties: &[PropertyInfo],
) -> ClassElement<'a> {
    let helper = AstHelper::new(ast);
    let mut stmts = ArenaVec::new_in(ast);

    // 1. super();
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

    // 2. this.attachShadow({ mode: 'open' });
    let mut shadow_props = ArenaVec::new_in(ast);
    shadow_props.push(ObjectPropertyKind::new_object_property(
        SPAN,
        PropertyKind::Init,
        PropertyKey::new_static_identifier(SPAN, "mode", ast),
        helper.string_lit("open"),
        false,
        false,
        false,
        ast,
    ));
    let call_attach = helper.call_expr(
        helper.static_member(helper.this_expr(), "attachShadow", false),
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(Expression::new_object_expression(
                SPAN,
                shadow_props,
                ast,
            )));
            a
        },
        false,
    );
    stmts.push(helper.expr_stmt(call_attach));

    // 3. if styles: this.shadowRoot.adoptedStyleSheets = [__lit_sheet];
    if has_styles {
        let shadow_root = helper.static_member(helper.this_expr(), "shadowRoot", false);
        let adopted_target =
            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                SPAN,
                shadow_root,
                helper.ident_name("adoptedStyleSheets"),
                false,
                ast,
            ));
        let mut sheets = ArenaVec::new_in(ast);
        sheets.push(ArrayExpressionElement::from(
            helper.ident_ref(allocator.alloc_str(sheet_var)),
        ));
        let assign_sheets = Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            adopted_target,
            Expression::new_array_expression(SPAN, sheets, ast),
            ast,
        );
        stmts.push(helper.expr_stmt(assign_sheets));
    }

    // 4. const __frag = __lit_tmpl.content.cloneNode(true);
    let content_member = helper.static_member(
        helper.ident_ref(allocator.alloc_str(tmpl_var)),
        "content",
        false,
    );
    let clone_node = helper.static_member(content_member, "cloneNode", false);
    let call_clone = helper.call_expr(
        clone_node,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(helper.bool_lit(true)));
            a
        },
        false,
    );
    stmts.push(helper.const_declaration("__frag", call_clone));

    // 5. Node path resolution and text marker replacement
    for (idx, b) in parsed_template.bindings.iter().enumerate() {
        let mut path_expr = helper.ident_ref("__frag");
        for step in &b.path {
            path_expr = helper.computed_member(
                helper.static_member(path_expr, "childNodes", false),
                helper.number_lit(*step as f64),
                false,
            );
        }

        let node_prop_name = allocator.alloc_str(&format!("__lit_node_{}", idx));

        match b.kind {
            BindingKind::Text => {
                let m_var_name = allocator.alloc_str(&format!("__m_{}", idx));
                stmts.push(helper.const_declaration(m_var_name, path_expr));

                // this.__lit_node_X = document.createTextNode('');
                let create_tn = helper.call_expr(
                    helper.static_member(helper.ident_ref("document"), "createTextNode", false),
                    {
                        let mut a = ArenaVec::new_in(ast);
                        a.push(Argument::from(helper.string_lit("")));
                        a
                    },
                    false,
                );
                stmts.push(helper.this_prop_assign(node_prop_name, create_tn));

                // if (__m_X) __m_X.replaceWith(this.__lit_node_X);
                let call_replace = helper.call_expr(
                    helper.static_member(helper.ident_ref(m_var_name), "replaceWith", false),
                    {
                        let mut a = ArenaVec::new_in(ast);
                        a.push(Argument::from(helper.static_member(
                            helper.this_expr(),
                            node_prop_name,
                            false,
                        )));
                        a
                    },
                    false,
                );
                stmts.push(Statement::new_if_statement(
                    SPAN,
                    helper.ident_ref(m_var_name),
                    helper.expr_stmt(call_replace),
                    None,
                    ast,
                ));
            }
            BindingKind::Event => {
                let btn_var_name = allocator.alloc_str(&format!("__btn_{}", idx));
                stmts.push(helper.const_declaration(btn_var_name, path_expr));

                let ev_name = b.name.as_deref().unwrap_or("click");
                let clean_handler = b
                    .expr_str
                    .trim_start_matches("this.")
                    .trim_end_matches("()");
                let clean_handler_alloc = allocator.alloc_str(clean_handler);

                // (e) => this._onClick(e)
                let mut arrow_params = ArenaVec::new_in(ast);
                arrow_params.push(FormalParameter::new_plain(
                    SPAN,
                    BindingPattern::new_binding_identifier(SPAN, "e", ast),
                    ast,
                ));
                let call_handler = helper.call_expr(
                    helper.static_member(helper.this_expr(), clean_handler_alloc, false),
                    {
                        let mut a = ArenaVec::new_in(ast);
                        a.push(Argument::from(helper.ident_ref("e")));
                        a
                    },
                    false,
                );
                let arrow_fn = Expression::new_arrow_function_expression(
                    SPAN,
                    false,
                    None,
                    FormalParameters::boxed(
                        SPAN,
                        FormalParameterKind::ArrowFormalParameters,
                        arrow_params,
                        None,
                        ast,
                    ),
                    None,
                    ArrowFunctionBody::from(call_handler),
                    ast,
                );

                // if (__btn_X) __btn_X.addEventListener('click', (e) => this.handler(e));
                let call_add_listener = helper.call_expr(
                    helper.static_member(helper.ident_ref(btn_var_name), "addEventListener", false),
                    {
                        let mut a = ArenaVec::new_in(ast);
                        a.push(Argument::from(
                            helper.string_lit(allocator.alloc_str(ev_name)),
                        ));
                        a.push(Argument::from(arrow_fn));
                        a
                    },
                    false,
                );
                stmts.push(Statement::new_if_statement(
                    SPAN,
                    helper.ident_ref(btn_var_name),
                    helper.expr_stmt(call_add_listener),
                    None,
                    ast,
                ));
            }
            _ => {
                // this.__lit_node_X = path_expr;
                stmts.push(helper.this_prop_assign(node_prop_name, path_expr));
            }
        }
    }

    // 6. this.shadowRoot.appendChild(__frag);
    let shadow_root = helper.static_member(helper.this_expr(), "shadowRoot", false);
    let append_child = helper.static_member(shadow_root, "appendChild", false);
    let call_append = helper.call_expr(
        append_child,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(helper.ident_ref("__frag")));
            a
        },
        false,
    );
    stmts.push(helper.expr_stmt(call_append));

    // 7. Initialize property backing stores: this._propName = default;
    for p in properties {
        let backing_prop = allocator.alloc_str(&format!("_{}", p.name));
        let default_expr = if let Some(def) = &p.default_value {
            if def == "true" {
                helper.bool_lit(true)
            } else if def == "false" {
                helper.bool_lit(false)
            } else if let Ok(num) = def.parse::<f64>() {
                helper.number_lit(num)
            } else {
                let trimmed = def.trim_matches('\'').trim_matches('"');
                helper.string_lit(allocator.alloc_str(trimmed))
            }
        } else {
            match p.prop_type.as_str() {
                "number" => helper.number_lit(0.0),
                "boolean" => helper.bool_lit(false),
                _ => helper.string_lit(""),
            }
        };
        stmts.push(helper.this_prop_assign(backing_prop, default_expr));
    }

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

/// Builds getter and setter for a reactive property with direct DOM mutations and reflection.
pub fn build_property_accessors<'a>(
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    p: &PropertyInfo,
    parsed_template: &ParsedTemplate,
) -> (ClassElement<'a>, ClassElement<'a>) {
    let helper = AstHelper::new(ast);
    let p_name = allocator.alloc_str(&p.name);
    let backing_name = allocator.alloc_str(&format!("_{}", p.name));

    // 1. Getter: get prop() { return this._prop; }
    let getter = {
        let mut stmts = ArenaVec::new_in(ast);
        stmts.push(Statement::new_return_statement(
            SPAN,
            Some(helper.static_member(helper.this_expr(), backing_name, false)),
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
            PropertyKey::new_static_identifier(SPAN, p_name, ast),
            func,
            MethodDefinitionKind::Get,
            false,
            false,
            false,
            false,
            None,
            ast,
        )
    };

    // 2. Setter: set prop(v) { if (this._prop === v) return; this._prop = v; ... direct dom updates ... reflect ... }
    let setter = {
        let mut stmts = ArenaVec::new_in(ast);

        // if (this._prop === v) return;
        let test_eq = Expression::new_binary_expression(
            SPAN,
            helper.static_member(helper.this_expr(), backing_name, false),
            BinaryOperator::StrictEquality,
            helper.ident_ref("v"),
            ast,
        );
        stmts.push(Statement::new_if_statement(
            SPAN,
            test_eq,
            Statement::new_return_statement(SPAN, None, ast),
            None,
            ast,
        ));

        // this._prop = v;
        stmts.push(helper.this_prop_assign(backing_name, helper.ident_ref("v")));

        // Direct DOM updates for bindings referencing this property
        for (idx, b) in parsed_template.bindings.iter().enumerate() {
            if b.expr_str.contains(&p.name) {
                let node_prop = allocator.alloc_str(&format!("__lit_node_{}", idx));
                let node_expr = helper.static_member(helper.this_expr(), node_prop, false);

                match b.kind {
                    BindingKind::Text => {
                        // this.__lit_node_X.data = String(v ?? '');
                        let data_target =
                            AssignmentTarget::from(MemberExpression::new_static_member_expression(
                                SPAN,
                                node_expr,
                                helper.ident_name("data"),
                                false,
                                ast,
                            ));
                        let v_coalesce =
                            helper.nullish_coalescing(helper.ident_ref("v"), helper.string_lit(""));
                        let str_call = helper.call_expr(
                            helper.ident_ref("String"),
                            {
                                let mut a = ArenaVec::new_in(ast);
                                a.push(Argument::from(v_coalesce));
                                a
                            },
                            false,
                        );
                        let assign_data = Expression::new_assignment_expression(
                            SPAN,
                            AssignmentOperator::Assign,
                            data_target,
                            str_call,
                            ast,
                        );
                        stmts.push(Statement::new_if_statement(
                            SPAN,
                            helper.static_member(helper.this_expr(), node_prop, false),
                            helper.expr_stmt(assign_data),
                            None,
                            ast,
                        ));
                    }
                    BindingKind::BooleanAttribute => {
                        if let Some(attr) = &b.name {
                            // this.__lit_node_X.toggleAttribute('attr', Boolean(v));
                            let bool_call = helper.call_expr(
                                helper.ident_ref("Boolean"),
                                {
                                    let mut a = ArenaVec::new_in(ast);
                                    a.push(Argument::from(helper.ident_ref("v")));
                                    a
                                },
                                false,
                            );
                            let toggle_call = helper.call_expr(
                                helper.static_member(node_expr, "toggleAttribute", false),
                                {
                                    let mut a = ArenaVec::new_in(ast);
                                    a.push(Argument::from(
                                        helper.string_lit(allocator.alloc_str(attr)),
                                    ));
                                    a.push(Argument::from(bool_call));
                                    a
                                },
                                false,
                            );
                            stmts.push(Statement::new_if_statement(
                                SPAN,
                                helper.static_member(helper.this_expr(), node_prop, false),
                                helper.expr_stmt(toggle_call),
                                None,
                                ast,
                            ));
                        }
                    }
                    BindingKind::Attribute => {
                        if let Some(attr) = &b.name {
                            // this.__lit_node_X.setAttribute('attr', String(v ?? ''));
                            let v_coalesce = helper
                                .nullish_coalescing(helper.ident_ref("v"), helper.string_lit(""));
                            let str_call = helper.call_expr(
                                helper.ident_ref("String"),
                                {
                                    let mut a = ArenaVec::new_in(ast);
                                    a.push(Argument::from(v_coalesce));
                                    a
                                },
                                false,
                            );
                            let set_call = helper.call_expr(
                                helper.static_member(node_expr, "setAttribute", false),
                                {
                                    let mut a = ArenaVec::new_in(ast);
                                    a.push(Argument::from(
                                        helper.string_lit(allocator.alloc_str(attr)),
                                    ));
                                    a.push(Argument::from(str_call));
                                    a
                                },
                                false,
                            );
                            stmts.push(Statement::new_if_statement(
                                SPAN,
                                helper.static_member(helper.this_expr(), node_prop, false),
                                helper.expr_stmt(set_call),
                                None,
                                ast,
                            ));
                        }
                    }
                    _ => {}
                }
            }
        }

        // Attribute reflection
        if p.reflect {
            let attr_alloc = allocator.alloc_str(&p.attribute_name);
            if p.prop_type == "boolean" {
                // if (this.isConnected) { if (this.hasAttribute('attr') !== Boolean(v)) this.toggleAttribute('attr', Boolean(v)); }
                let bool_call = helper.call_expr(
                    helper.ident_ref("Boolean"),
                    {
                        let mut a = ArenaVec::new_in(ast);
                        a.push(Argument::from(helper.ident_ref("v")));
                        a
                    },
                    false,
                );
                let has_attr_call = helper.call_expr(
                    helper.static_member(helper.this_expr(), "hasAttribute", false),
                    {
                        let mut a = ArenaVec::new_in(ast);
                        a.push(Argument::from(helper.string_lit(attr_alloc)));
                        a
                    },
                    false,
                );
                let ne_bool = Expression::new_binary_expression(
                    SPAN,
                    has_attr_call,
                    BinaryOperator::StrictInequality,
                    bool_call,
                    ast,
                );
                let toggle_call = helper.call_expr(
                    helper.static_member(helper.this_expr(), "toggleAttribute", false),
                    {
                        let mut a = ArenaVec::new_in(ast);
                        a.push(Argument::from(helper.string_lit(attr_alloc)));
                        a.push(Argument::from(helper.call_expr(
                            helper.ident_ref("Boolean"),
                            {
                                let mut b = ArenaVec::new_in(ast);
                                b.push(Argument::from(helper.ident_ref("v")));
                                b
                            },
                            false,
                        )));
                        a
                    },
                    false,
                );
                let if_connected_stmt = Statement::new_if_statement(
                    SPAN,
                    ne_bool,
                    helper.expr_stmt(toggle_call),
                    None,
                    ast,
                );

                stmts.push(Statement::new_if_statement(
                    SPAN,
                    helper.static_member(helper.this_expr(), "isConnected", false),
                    if_connected_stmt,
                    None,
                    ast,
                ));
            } else {
                // String attribute reflection:
                // if (this.isConnected) { if (v != null) { if (this.getAttribute('attr') !== String(v)) this.setAttribute('attr', String(v)); } else { this.removeAttribute('attr'); } }
                let v_not_null = Expression::new_binary_expression(
                    SPAN,
                    helper.ident_ref("v"),
                    BinaryOperator::Inequality,
                    helper.null_lit(),
                    ast,
                );
                let str_v = helper.call_expr(
                    helper.ident_ref("String"),
                    {
                        let mut a = ArenaVec::new_in(ast);
                        a.push(Argument::from(helper.ident_ref("v")));
                        a
                    },
                    false,
                );
                let get_attr_call = helper.call_expr(
                    helper.static_member(helper.this_expr(), "getAttribute", false),
                    {
                        let mut a = ArenaVec::new_in(ast);
                        a.push(Argument::from(helper.string_lit(attr_alloc)));
                        a
                    },
                    false,
                );
                let ne_str = Expression::new_binary_expression(
                    SPAN,
                    get_attr_call,
                    BinaryOperator::StrictInequality,
                    str_v,
                    ast,
                );
                let set_attr_call = helper.call_expr(
                    helper.static_member(helper.this_expr(), "setAttribute", false),
                    {
                        let mut a = ArenaVec::new_in(ast);
                        a.push(Argument::from(helper.string_lit(attr_alloc)));
                        a.push(Argument::from(helper.call_expr(
                            helper.ident_ref("String"),
                            {
                                let mut b = ArenaVec::new_in(ast);
                                b.push(Argument::from(helper.ident_ref("v")));
                                b
                            },
                            false,
                        )));
                        a
                    },
                    false,
                );
                let if_ne_stmt = Statement::new_if_statement(
                    SPAN,
                    ne_str,
                    helper.expr_stmt(set_attr_call),
                    None,
                    ast,
                );

                let remove_attr_call = helper.call_expr(
                    helper.static_member(helper.this_expr(), "removeAttribute", false),
                    {
                        let mut a = ArenaVec::new_in(ast);
                        a.push(Argument::from(helper.string_lit(attr_alloc)));
                        a
                    },
                    false,
                );

                let if_v_val = Statement::new_if_statement(
                    SPAN,
                    v_not_null,
                    if_ne_stmt,
                    Some(helper.expr_stmt(remove_attr_call)),
                    ast,
                );

                stmts.push(Statement::new_if_statement(
                    SPAN,
                    helper.static_member(helper.this_expr(), "isConnected", false),
                    if_v_val,
                    None,
                    ast,
                ));
            }
        }

        let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
        let mut params = ArenaVec::new_in(ast);
        params.push(FormalParameter::new_plain(
            SPAN,
            BindingPattern::new_binding_identifier(SPAN, "v", ast),
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
            PropertyKey::new_static_identifier(SPAN, p_name, ast),
            func,
            MethodDefinitionKind::Set,
            false,
            false,
            false,
            false,
            None,
            ast,
        )
    };

    (getter, setter)
}

/// Builds `attributeChangedCallback(name, oldVal, newVal)`:
/// ```js
/// attributeChangedCallback(name, oldVal, newVal) {
///   if (oldVal === newVal) return;
///   switch (name) {
///     case 'attr': this.prop = cast; break;
///   }
/// }
/// ```
pub fn build_attribute_changed_callback_element<'a>(
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    properties: &[PropertyInfo],
) -> Option<ClassElement<'a>> {
    let helper = AstHelper::new(ast);
    let observed: Vec<&PropertyInfo> = properties
        .iter()
        .filter(|p| !p.attribute_name.is_empty())
        .collect();
    if observed.is_empty() {
        return None;
    }

    let mut stmts = ArenaVec::new_in(ast);

    // if (oldVal === newVal) return;
    let test_eq = Expression::new_binary_expression(
        SPAN,
        helper.ident_ref("oldVal"),
        BinaryOperator::StrictEquality,
        helper.ident_ref("newVal"),
        ast,
    );
    stmts.push(Statement::new_if_statement(
        SPAN,
        test_eq,
        Statement::new_return_statement(SPAN, None, ast),
        None,
        ast,
    ));

    // switch (name) { ... }
    let mut cases = ArenaVec::new_in(ast);
    for p in observed {
        let attr_name = allocator.alloc_str(&p.attribute_name);
        let prop_name = allocator.alloc_str(&p.name);

        let cast_expr = match p.prop_type.as_str() {
            "number" => {
                let ne_null = Expression::new_binary_expression(
                    SPAN,
                    helper.ident_ref("newVal"),
                    BinaryOperator::Inequality,
                    helper.null_lit(),
                    ast,
                );
                let num_call = helper.call_expr(
                    helper.ident_ref("Number"),
                    {
                        let mut a = ArenaVec::new_in(ast);
                        a.push(Argument::from(helper.ident_ref("newVal")));
                        a
                    },
                    false,
                );
                Expression::new_conditional_expression(
                    SPAN,
                    ne_null,
                    num_call,
                    helper.number_lit(0.0),
                    ast,
                )
            }
            "boolean" => Expression::new_binary_expression(
                SPAN,
                helper.ident_ref("newVal"),
                BinaryOperator::StrictInequality,
                helper.null_lit(),
                ast,
            ),
            _ => helper.nullish_coalescing(helper.ident_ref("newVal"), helper.string_lit("")),
        };

        let mut case_stmts = ArenaVec::new_in(ast);
        case_stmts.push(helper.this_prop_assign(prop_name, cast_expr));
        case_stmts.push(Statement::new_break_statement(SPAN, None, ast));

        cases.push(SwitchCase::new(
            SPAN,
            Some(helper.string_lit(attr_name)),
            case_stmts,
            ast,
        ));
    }

    let switch_stmt = Statement::new_switch_statement(SPAN, helper.ident_ref("name"), cases, ast);
    stmts.push(switch_stmt);

    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let mut params = ArenaVec::new_in(ast);
    params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "name", ast),
        ast,
    ));
    params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "oldVal", ast),
        ast,
    ));
    params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "newVal", ast),
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

    Some(ClassElement::new_method_definition(
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
    ))
}
