use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec, Box as ArenaBox};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::Codegen;
use oxc_span::{SPAN, SourceType};
use serde::{Deserialize, Serialize};

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct WorkerEntryAction {
    pub name: String,
    pub hash: String,
}

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct WorkerEntryElement {
    pub tag_name: Option<String>,
    pub class_name: Option<String>,
    pub file_path: String,
    pub actions: Vec<WorkerEntryAction>,
}

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct WorkerEntryOptions {
    pub elements: Vec<WorkerEntryElement>,
    pub build_id: Option<String>,
    pub action_route_prefix: Option<String>,
    pub include_wasm: Option<bool>,
    pub additional_imports: Option<Vec<String>>,
}

fn compute_default_build_id(elements: &[WorkerEntryElement]) -> String {
    let mut keys: Vec<&str> = elements
        .iter()
        .map(|el| el.tag_name.as_deref().unwrap_or(el.file_path.as_str()))
        .collect();
    keys.sort_unstable();
    let mut hasher = blake3::Hasher::new();
    for k in keys {
        hasher.update(k.as_bytes());
    }
    let hex = hasher.finalize().to_hex();
    hex.as_str()[..16].to_string()
}

fn ident<'a>(ast: &AstBuilder<'a>, name: &'a str) -> Expression<'a> {
    Expression::new_identifier(SPAN, name, ast)
}

fn str_lit<'a>(ast: &AstBuilder<'a>, val: &'a str) -> Expression<'a> {
    Expression::new_string_literal(SPAN, val, None, ast)
}

fn member<'a>(ast: &AstBuilder<'a>, obj: Expression<'a>, prop: &'a str) -> Expression<'a> {
    Expression::new_static_member_expression(
        SPAN,
        obj,
        IdentifierName::new(SPAN, prop, ast),
        false,
        ast,
    )
}

fn computed<'a>(ast: &AstBuilder<'a>, obj: Expression<'a>, expr: Expression<'a>) -> Expression<'a> {
    Expression::new_computed_member_expression(SPAN, obj, expr, false, ast)
}

fn call<'a>(
    ast: &AstBuilder<'a>,
    callee: Expression<'a>,
    args: Vec<Expression<'a>>,
) -> Expression<'a> {
    let mut arena_args = ArenaVec::new_in(ast);
    for a in args {
        arena_args.push(Argument::from(a));
    }
    Expression::new_call_expression(SPAN, callee, None, arena_args, false, ast)
}

fn default_import<'a>(ast: &AstBuilder<'a>, local_name: &'a str, source: &'a str) -> Statement<'a> {
    let mut specifiers = ArenaVec::new_in(ast);
    specifiers.push(ImportDeclarationSpecifier::ImportDefaultSpecifier(
        ImportDefaultSpecifier::boxed(SPAN, BindingIdentifier::new(SPAN, local_name, ast), ast),
    ));
    Statement::new_import_declaration(
        SPAN,
        Some(specifiers),
        StringLiteral::new(SPAN, source, None, ast),
        None,
        None,
        ImportOrExportKind::Value,
        ast,
    )
}

fn named_import<'a>(ast: &AstBuilder<'a>, names: &[&'a str], source: &'a str) -> Statement<'a> {
    let mut specifiers = ArenaVec::new_in(ast);
    for &name in names {
        specifiers.push(ImportDeclarationSpecifier::ImportSpecifier(
            ArenaBox::new_in(
                ImportSpecifier::new(
                    SPAN,
                    ModuleExportName::new_identifier_name(SPAN, name, ast),
                    BindingIdentifier::new(SPAN, name, ast),
                    ImportOrExportKind::Value,
                    ast,
                ),
                ast,
            ),
        ));
    }
    Statement::new_import_declaration(
        SPAN,
        Some(specifiers),
        StringLiteral::new(SPAN, source, None, ast),
        None,
        None,
        ImportOrExportKind::Value,
        ast,
    )
}

fn export_const<'a>(ast: &AstBuilder<'a>, name: &'a str, init: Expression<'a>) -> Statement<'a> {
    let mut decls = ArenaVec::new_in(ast);
    decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, name, ast),
        None,
        Some(init),
        false,
        ast,
    ));
    let var_decl =
        VariableDeclaration::boxed(SPAN, VariableDeclarationKind::Const, decls, false, ast);
    Statement::ExportDeclaration(ExportDeclaration::boxed(
        SPAN,
        Declaration::VariableDeclaration(var_decl),
        ast,
    ))
}

fn const_decl<'a>(ast: &AstBuilder<'a>, name: &'a str, init: Expression<'a>) -> Statement<'a> {
    let mut decls = ArenaVec::new_in(ast);
    decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, name, ast),
        None,
        Some(init),
        false,
        ast,
    ));
    Statement::new_variable_declaration(SPAN, VariableDeclarationKind::Const, decls, false, ast)
}

fn obj_prop<'a>(
    ast: &AstBuilder<'a>,
    key: PropertyKey<'a>,
    val: Expression<'a>,
    method: bool,
) -> ObjectPropertyKind<'a> {
    ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
        SPAN,
        PropertyKind::Init,
        key,
        val,
        method,
        false,
        false,
        ast,
    ))
}

fn custom_elements_lookup<'a>(ast: &AstBuilder<'a>, tag_expr: Expression<'a>) -> Expression<'a> {
    // typeof customElements !== "undefined" ? customElements.get(tag_expr) : undefined
    let typeof_ce = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::Typeof,
        ident(ast, "customElements"),
        ast,
    );
    let cond = Expression::new_binary_expression(
        SPAN,
        typeof_ce,
        BinaryOperator::StrictInequality,
        str_lit(ast, "undefined"),
        ast,
    );
    let ce_get = call(
        ast,
        member(ast, ident(ast, "customElements"), "get"),
        vec![tag_expr],
    );
    Expression::new_conditional_expression(SPAN, cond, ce_get, ident(ast, "undefined"), ast)
}

fn make_params<'a>(
    ast: &AstBuilder<'a>,
    kind: FormalParameterKind,
    names: &[&'a str],
) -> ArenaBox<'a, FormalParameters<'a>> {
    let mut items = ArenaVec::new_in(ast);
    for &n in names {
        items.push(FormalParameter::new_plain(
            SPAN,
            BindingPattern::new_binding_identifier(SPAN, n, ast),
            ast,
        ));
    }
    FormalParameters::boxed(SPAN, kind, items, None, ast)
}

pub fn build_worker_entry_code(options: WorkerEntryOptions) -> String {
    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);

    let mut sorted_elements = options.elements;
    sorted_elements.sort_by(|a, b| {
        let key_a = a
            .tag_name
            .as_deref()
            .or(a.class_name.as_deref())
            .unwrap_or(a.file_path.as_str());
        let key_b = b
            .tag_name
            .as_deref()
            .or(b.class_name.as_deref())
            .unwrap_or(b.file_path.as_str());
        key_a.cmp(key_b)
    });

    let build_id_owned = options
        .build_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| compute_default_build_id(&sorted_elements));
    let build_id_str = allocator.alloc_str(&build_id_owned);

    let raw_prefix = options.action_route_prefix.as_deref().unwrap_or("/_lit/a/");
    let normalized_prefix_owned = if raw_prefix.ends_with('/') {
        raw_prefix.to_string()
    } else {
        [raw_prefix, "/"].concat()
    };
    let route_prefix_str = allocator.alloc_str(&normalized_prefix_owned);

    let include_wasm = options.include_wasm.unwrap_or(true);

    let mut body = ArenaVec::new_in(&ast);

    // 1. Preload isolate DOM globals before any component module import evaluates (fixes N8)
    body.push(Statement::new_import_declaration(
        SPAN,
        None,
        StringLiteral::new(SPAN, "virtual:lit-core/install-globals", None, &ast),
        None,
        None,
        ImportOrExportKind::Value,
        &ast,
    ));

    // 2. Runtime imports
    if include_wasm {
        body.push(default_import(&ast, "__lit_ssr_wasm", "./ssr_bg.wasm"));
        body.push(named_import(
            &ast,
            &["registerSsrWasmModule"],
            "@lit-core/ssr",
        ));
    }
    body.push(named_import(
        &ast,
        &["handleActionRequest"],
        "@lit-core/server-elements/action-endpoint",
    ));
    body.push(named_import(
        &ast,
        &[
            "renderServerElement",
            "transformServerElementsWithHtmlRewriter",
        ],
        "@lit-core/server-elements/edge",
    ));

    // 3. Component namespace imports: import * as __lit_mod_<i> from "<file_path>";
    let mut mod_names: Vec<&str> = Vec::with_capacity(sorted_elements.len());
    let mut cls_names: Vec<&str> = Vec::with_capacity(sorted_elements.len());
    let mut tag_names: Vec<&str> = Vec::with_capacity(sorted_elements.len());

    for (index, el) in sorted_elements.iter().enumerate() {
        let idx_str = index.to_string();
        let mod_name = allocator.alloc_str(&["__lit_mod_", &idx_str].concat());
        let cls_var_name = allocator.alloc_str(&["__lit_class_", &idx_str].concat());
        let tag_lower = el
            .tag_name
            .as_deref()
            .unwrap_or("server-element")
            .to_ascii_lowercase();
        let tag_str = allocator.alloc_str(&tag_lower);
        let file_path_str = allocator.alloc_str(&el.file_path);

        mod_names.push(mod_name);
        cls_names.push(cls_var_name);
        tag_names.push(tag_str);

        let mut ns_specs = ArenaVec::new_in(&ast);
        ns_specs.push(ImportDeclarationSpecifier::ImportNamespaceSpecifier(
            ImportNamespaceSpecifier::boxed(
                SPAN,
                BindingIdentifier::new(SPAN, mod_name, &ast),
                &ast,
            ),
        ));
        body.push(Statement::new_import_declaration(
            SPAN,
            Some(ns_specs),
            StringLiteral::new(SPAN, file_path_str, None, &ast),
            None,
            None,
            ImportOrExportKind::Value,
            &ast,
        ));
    }

    if let Some(extra_imports) = options.additional_imports {
        let mut sorted_extra: Vec<String> = extra_imports
            .into_iter()
            .filter(|imp| !imp.is_empty() && !sorted_elements.iter().any(|el| el.file_path == *imp))
            .collect();
        sorted_extra.sort_unstable();
        sorted_extra.dedup();
        for imp in sorted_extra {
            let imp_str = allocator.alloc_str(&imp);
            body.push(Statement::new_import_declaration(
                SPAN,
                None,
                StringLiteral::new(SPAN, imp_str, None, &ast),
                None,
                None,
                ImportOrExportKind::Value,
                &ast,
            ));
        }
    }

    // 4. export const buildId = "<build_id>";
    body.push(export_const(&ast, "buildId", str_lit(&ast, build_id_str)));

    // 5. const __lit_class_<i> = __lit_mod_<i>["<className>"] ?? __lit_mod_<i>.default ?? (typeof customElements !== "undefined" ? customElements.get("<tag>") : undefined);
    for (index, el) in sorted_elements.iter().enumerate() {
        let mod_name = mod_names[index];
        let cls_var_name = cls_names[index];
        let tag_str = tag_names[index];
        let export_cls_name = allocator.alloc_str(el.class_name.as_deref().unwrap_or("default"));

        let named_lookup = computed(&ast, ident(&ast, mod_name), str_lit(&ast, export_cls_name));
        let default_lookup = member(&ast, ident(&ast, mod_name), "default");
        let ce_lookup = custom_elements_lookup(&ast, str_lit(&ast, tag_str));

        let coalesce_first = Expression::new_logical_expression(
            SPAN,
            named_lookup,
            LogicalOperator::Coalesce,
            default_lookup,
            &ast,
        );
        let coalesce_all = Expression::new_logical_expression(
            SPAN,
            coalesce_first,
            LogicalOperator::Coalesce,
            ce_lookup,
            &ast,
        );
        body.push(const_decl(&ast, cls_var_name, coalesce_all));
    }

    // 6. export const tagManifest = { "<tag>": __lit_class_<i>, ... };
    let mut tag_manifest_props = ArenaVec::new_in(&ast);
    for index in 0..sorted_elements.len() {
        let tag_key =
            PropertyKey::StringLiteral(StringLiteral::boxed(SPAN, tag_names[index], None, &ast));
        tag_manifest_props.push(obj_prop(
            &ast,
            tag_key,
            ident(&ast, cls_names[index]),
            false,
        ));
    }
    body.push(export_const(
        &ast,
        "tagManifest",
        Expression::new_object_expression(SPAN, tag_manifest_props, &ast),
    ));

    // 7. export const actionManifest = { "<hash>": { tagName: "<tag>", methodName: "<name>" }, ... };
    let mut action_manifest_props = ArenaVec::new_in(&ast);
    for (index, el) in sorted_elements.iter().enumerate() {
        let tag_str = tag_names[index];
        let mut sorted_actions = el.actions.clone();
        sorted_actions.sort_by(|a, b| a.hash.cmp(&b.hash));
        for act in &sorted_actions {
            let hash_str = allocator.alloc_str(&act.hash);
            let method_str = allocator.alloc_str(&act.name);

            let mut entry_props = ArenaVec::new_in(&ast);
            entry_props.push(obj_prop(
                &ast,
                PropertyKey::new_static_identifier(SPAN, "tagName", &ast),
                str_lit(&ast, tag_str),
                false,
            ));
            entry_props.push(obj_prop(
                &ast,
                PropertyKey::new_static_identifier(SPAN, "methodName", &ast),
                str_lit(&ast, method_str),
                false,
            ));
            let entry_obj = Expression::new_object_expression(SPAN, entry_props, &ast);

            action_manifest_props.push(obj_prop(
                &ast,
                PropertyKey::StringLiteral(StringLiteral::boxed(SPAN, hash_str, None, &ast)),
                entry_obj,
                false,
            ));
        }
    }
    body.push(export_const(
        &ast,
        "actionManifest",
        Expression::new_object_expression(SPAN, action_manifest_props, &ast),
    ));

    // 8. export const registry = { get(tagName) { ... } };
    let mut reg_get_stmts = ArenaVec::new_in(&ast);
    // if (!tagName) return undefined;
    reg_get_stmts.push(Statement::new_if_statement(
        SPAN,
        Expression::new_unary_expression(
            SPAN,
            UnaryOperator::LogicalNot,
            ident(&ast, "tagName"),
            &ast,
        ),
        Statement::new_return_statement(SPAN, Some(ident(&ast, "undefined")), &ast),
        None,
        &ast,
    ));
    // const lower = String(tagName).toLowerCase();
    let str_call = call(&ast, ident(&ast, "String"), vec![ident(&ast, "tagName")]);
    let lower_call = call(&ast, member(&ast, str_call, "toLowerCase"), vec![]);
    reg_get_stmts.push(const_decl(&ast, "lower", lower_call));
    // return tagManifest[lower] ?? (typeof customElements !== "undefined" ? customElements.get(lower) : undefined);
    let manifest_lookup = computed(&ast, ident(&ast, "tagManifest"), ident(&ast, "lower"));
    let ce_lower_lookup = custom_elements_lookup(&ast, ident(&ast, "lower"));
    let reg_ret_expr = Expression::new_logical_expression(
        SPAN,
        manifest_lookup,
        LogicalOperator::Coalesce,
        ce_lower_lookup,
        &ast,
    );
    reg_get_stmts.push(Statement::new_return_statement(
        SPAN,
        Some(reg_ret_expr),
        &ast,
    ));

    let reg_get_fn = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        false,
        false,
        None,
        None,
        make_params(&ast, FormalParameterKind::FormalParameter, &["tagName"]),
        None,
        Some(FunctionBody::boxed(
            SPAN,
            ArenaVec::new_in(&ast),
            reg_get_stmts,
            &ast,
        )),
        &ast,
    );
    let mut reg_props = ArenaVec::new_in(&ast);
    reg_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "get", &ast),
        Expression::FunctionExpression(reg_get_fn),
        true,
    ));

    let mut reg_names_stmts = ArenaVec::new_in(&ast);
    let obj_keys_tags = call(
        &ast,
        member(&ast, ident(&ast, "Object"), "keys"),
        vec![ident(&ast, "tagManifest")],
    );
    reg_names_stmts.push(const_decl(&ast, "names", obj_keys_tags));

    let typeof_ce = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::Typeof,
        ident(&ast, "customElements"),
        &ast,
    );
    let ce_defined = Expression::new_binary_expression(
        SPAN,
        typeof_ce,
        BinaryOperator::StrictInequality,
        str_lit(&ast, "undefined"),
        &ast,
    );
    let typeof_get_reg = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::Typeof,
        member(&ast, ident(&ast, "customElements"), "getRegisteredTagNames"),
        &ast,
    );
    let has_get_reg = Expression::new_binary_expression(
        SPAN,
        typeof_get_reg,
        BinaryOperator::StrictEquality,
        str_lit(&ast, "function"),
        &ast,
    );
    let can_list_ce = Expression::new_logical_expression(
        SPAN,
        ce_defined,
        LogicalOperator::And,
        has_get_reg,
        &ast,
    );

    let mut ce_loop_body = ArenaVec::new_in(&ast);
    let not_included = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::LogicalNot,
        call(
            &ast,
            member(&ast, ident(&ast, "names"), "includes"),
            vec![ident(&ast, "tag")],
        ),
        &ast,
    );
    let push_tag = Statement::new_expression_statement(
        SPAN,
        call(
            &ast,
            member(&ast, ident(&ast, "names"), "push"),
            vec![ident(&ast, "tag")],
        ),
        &ast,
    );
    ce_loop_body.push(Statement::new_if_statement(
        SPAN,
        not_included,
        push_tag,
        None,
        &ast,
    ));

    let mut for_decls = ArenaVec::new_in(&ast);
    for_decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "tag", &ast),
        None,
        None,
        false,
        &ast,
    ));
    let for_left = ForStatementLeft::VariableDeclaration(VariableDeclaration::boxed(
        SPAN,
        VariableDeclarationKind::Const,
        for_decls,
        false,
        &ast,
    ));
    let for_right = call(
        &ast,
        member(&ast, ident(&ast, "customElements"), "getRegisteredTagNames"),
        vec![],
    );
    let for_of = Statement::new_for_of_statement(
        SPAN,
        false,
        for_left,
        for_right,
        Statement::new_block_statement(SPAN, ce_loop_body, &ast),
        &ast,
    );
    let mut if_ce_block = ArenaVec::new_in(&ast);
    if_ce_block.push(for_of);
    reg_names_stmts.push(Statement::new_if_statement(
        SPAN,
        can_list_ce,
        Statement::new_block_statement(SPAN, if_ce_block, &ast),
        None,
        &ast,
    ));
    reg_names_stmts.push(Statement::new_return_statement(
        SPAN,
        Some(ident(&ast, "names")),
        &ast,
    ));

    let reg_names_fn = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        false,
        false,
        None,
        None,
        make_params(&ast, FormalParameterKind::FormalParameter, &[]),
        None,
        Some(FunctionBody::boxed(
            SPAN,
            ArenaVec::new_in(&ast),
            reg_names_stmts,
            &ast,
        )),
        &ast,
    );
    reg_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "getRegisteredTagNames", &ast),
        Expression::FunctionExpression(reg_names_fn),
        true,
    ));

    body.push(export_const(
        &ast,
        "registry",
        Expression::new_object_expression(SPAN, reg_props, &ast),
    ));

    // 9. Lazy Wasm registration (emitted only when the worker graph contains runtime templates)
    if include_wasm {
        let wasm_mod_val = Expression::new_logical_expression(
            SPAN,
            member(&ast, ident(&ast, "__lit_ssr_wasm"), "default"),
            LogicalOperator::Coalesce,
            ident(&ast, "__lit_ssr_wasm"),
            &ast,
        );
        let register_call = call(
            &ast,
            ident(&ast, "registerSsrWasmModule"),
            vec![wasm_mod_val],
        );
        body.push(Statement::new_expression_statement(
            SPAN,
            register_call,
            &ast,
        ));
    }

    // Helper: if (<env_expr> && <env_expr>.__LIT_SSR_WASM) registerSsrWasmModule(<env_expr>.__LIT_SSR_WASM);
    let make_env_wasm_check = |env_name: &'static str| {
        let cond = Expression::new_logical_expression(
            SPAN,
            ident(&ast, env_name),
            LogicalOperator::And,
            member(&ast, ident(&ast, env_name), "__LIT_SSR_WASM"),
            &ast,
        );
        let call_register = call(
            &ast,
            ident(&ast, "registerSsrWasmModule"),
            vec![member(&ast, ident(&ast, env_name), "__LIT_SSR_WASM")],
        );
        Statement::new_if_statement(
            SPAN,
            cond,
            Statement::new_expression_statement(SPAN, call_register, &ast),
            None,
            &ast,
        )
    };

    // 10. export async function handleAction(request, env, options) { ... }
    let mut handle_action_stmts = ArenaVec::new_in(&ast);
    // const opts = options || {};
    handle_action_stmts.push(const_decl(
        &ast,
        "opts",
        Expression::new_logical_expression(
            SPAN,
            ident(&ast, "options"),
            LogicalOperator::Or,
            Expression::new_object_expression(SPAN, ArenaVec::new_in(&ast), &ast),
            &ast,
        ),
    ));
    if include_wasm {
        handle_action_stmts.push(make_env_wasm_check("env"));
    }

    let mut action_opts_props = ArenaVec::new_in(&ast);
    action_opts_props.push(ObjectPropertyKind::SpreadProperty(SpreadElement::boxed(
        SPAN,
        ident(&ast, "opts"),
        &ast,
    )));
    action_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "env", &ast),
        Expression::new_logical_expression(
            SPAN,
            ident(&ast, "env"),
            LogicalOperator::Coalesce,
            member(&ast, ident(&ast, "opts"), "env"),
            &ast,
        ),
        false,
    ));
    let env_secret = Expression::new_logical_expression(
        SPAN,
        ident(&ast, "env"),
        LogicalOperator::And,
        member(&ast, ident(&ast, "env"), "LIT_ACTION_SECRET"),
        &ast,
    );
    action_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "secret", &ast),
        Expression::new_logical_expression(
            SPAN,
            member(&ast, ident(&ast, "opts"), "secret"),
            LogicalOperator::Coalesce,
            env_secret,
            &ast,
        ),
        false,
    ));
    action_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "customElements", &ast),
        ident(&ast, "registry"),
        false,
    ));
    action_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "registry", &ast),
        ident(&ast, "registry"),
        false,
    ));
    action_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "buildId", &ast),
        Expression::new_logical_expression(
            SPAN,
            member(&ast, ident(&ast, "opts"), "buildId"),
            LogicalOperator::Coalesce,
            ident(&ast, "buildId"),
            &ast,
        ),
        false,
    ));
    action_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "routePrefix", &ast),
        Expression::new_logical_expression(
            SPAN,
            member(&ast, ident(&ast, "opts"), "routePrefix"),
            LogicalOperator::Coalesce,
            str_lit(&ast, route_prefix_str),
            &ast,
        ),
        false,
    ));

    let call_handle_action = call(
        &ast,
        ident(&ast, "handleActionRequest"),
        vec![
            ident(&ast, "request"),
            Expression::new_object_expression(SPAN, action_opts_props, &ast),
        ],
    );
    handle_action_stmts.push(Statement::new_return_statement(
        SPAN,
        Some(call_handle_action),
        &ast,
    ));

    let handle_action_fn = Function::boxed(
        SPAN,
        FunctionType::FunctionDeclaration,
        Some(BindingIdentifier::new(SPAN, "handleAction", &ast)),
        false,
        true,
        false,
        None,
        None,
        make_params(
            &ast,
            FormalParameterKind::FormalParameter,
            &["request", "env", "options"],
        ),
        None,
        Some(FunctionBody::boxed(
            SPAN,
            ArenaVec::new_in(&ast),
            handle_action_stmts,
            &ast,
        )),
        &ast,
    );
    body.push(Statement::ExportDeclaration(ExportDeclaration::boxed(
        SPAN,
        Declaration::FunctionDeclaration(handle_action_fn),
        &ast,
    )));

    // 11. export async function renderElement(tagOrCtor, props, options) { ... }
    let mut render_el_stmts = ArenaVec::new_in(&ast);
    render_el_stmts.push(const_decl(
        &ast,
        "opts",
        Expression::new_logical_expression(
            SPAN,
            ident(&ast, "options"),
            LogicalOperator::Or,
            Expression::new_object_expression(SPAN, ArenaVec::new_in(&ast), &ast),
            &ast,
        ),
    ));
    render_el_stmts.push(const_decl(
        &ast,
        "resolvedEnv",
        member(&ast, ident(&ast, "opts"), "env"),
    ));
    if include_wasm {
        render_el_stmts.push(make_env_wasm_check("resolvedEnv"));
    }

    let mut render_opts_props = ArenaVec::new_in(&ast);
    render_opts_props.push(ObjectPropertyKind::SpreadProperty(SpreadElement::boxed(
        SPAN,
        ident(&ast, "opts"),
        &ast,
    )));
    render_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "env", &ast),
        ident(&ast, "resolvedEnv"),
        false,
    ));
    let resolved_env_secret = Expression::new_logical_expression(
        SPAN,
        ident(&ast, "resolvedEnv"),
        LogicalOperator::And,
        member(&ast, ident(&ast, "resolvedEnv"), "LIT_ACTION_SECRET"),
        &ast,
    );
    render_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "secret", &ast),
        Expression::new_logical_expression(
            SPAN,
            member(&ast, ident(&ast, "opts"), "secret"),
            LogicalOperator::Coalesce,
            resolved_env_secret,
            &ast,
        ),
        false,
    ));
    render_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "buildId", &ast),
        Expression::new_logical_expression(
            SPAN,
            member(&ast, ident(&ast, "opts"), "buildId"),
            LogicalOperator::Coalesce,
            ident(&ast, "buildId"),
            &ast,
        ),
        false,
    ));
    render_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "customElements", &ast),
        ident(&ast, "registry"),
        false,
    ));

    let safe_props = Expression::new_logical_expression(
        SPAN,
        ident(&ast, "props"),
        LogicalOperator::Or,
        Expression::new_object_expression(SPAN, ArenaVec::new_in(&ast), &ast),
        &ast,
    );
    let call_render_el = call(
        &ast,
        ident(&ast, "renderServerElement"),
        vec![
            ident(&ast, "tagOrCtor"),
            safe_props,
            Expression::new_object_expression(SPAN, render_opts_props, &ast),
        ],
    );
    render_el_stmts.push(Statement::new_return_statement(
        SPAN,
        Some(call_render_el),
        &ast,
    ));

    let render_el_fn = Function::boxed(
        SPAN,
        FunctionType::FunctionDeclaration,
        Some(BindingIdentifier::new(SPAN, "renderElement", &ast)),
        false,
        true,
        false,
        None,
        None,
        make_params(
            &ast,
            FormalParameterKind::FormalParameter,
            &["tagOrCtor", "props", "options"],
        ),
        None,
        Some(FunctionBody::boxed(
            SPAN,
            ArenaVec::new_in(&ast),
            render_el_stmts,
            &ast,
        )),
        &ast,
    );
    body.push(Statement::ExportDeclaration(ExportDeclaration::boxed(
        SPAN,
        Declaration::FunctionDeclaration(render_el_fn),
        &ast,
    )));

    // 12. export default { async fetch(request, env, ctx) { ... } };
    let mut fetch_stmts = ArenaVec::new_in(&ast);
    // const url = new URL(request.url);
    let mut url_args = ArenaVec::new_in(&ast);
    url_args.push(Argument::from(member(&ast, ident(&ast, "request"), "url")));
    fetch_stmts.push(const_decl(
        &ast,
        "url",
        Expression::new_new_expression(SPAN, ident(&ast, "URL"), None, url_args, &ast),
    ));

    // if (request.method === "POST" && url.pathname.startsWith(route_prefix_str)) { return handleAction(request, env); }
    let is_post = Expression::new_binary_expression(
        SPAN,
        member(&ast, ident(&ast, "request"), "method"),
        BinaryOperator::StrictEquality,
        str_lit(&ast, "POST"),
        &ast,
    );
    let path_starts = call(
        &ast,
        member(
            &ast,
            member(&ast, ident(&ast, "url"), "pathname"),
            "startsWith",
        ),
        vec![str_lit(&ast, route_prefix_str)],
    );
    let is_action_req =
        Expression::new_logical_expression(SPAN, is_post, LogicalOperator::And, path_starts, &ast);
    let mut post_block = ArenaVec::new_in(&ast);
    post_block.push(Statement::new_return_statement(
        SPAN,
        Some(call(
            &ast,
            ident(&ast, "handleAction"),
            vec![ident(&ast, "request"), ident(&ast, "env")],
        )),
        &ast,
    ));
    fetch_stmts.push(Statement::new_if_statement(
        SPAN,
        is_action_req,
        Statement::new_block_statement(SPAN, post_block, &ast),
        None,
        &ast,
    ));

    // if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") { ... }
    let env_assets = member(&ast, ident(&ast, "env"), "ASSETS");
    let env_assets_fetch = member(&ast, member(&ast, ident(&ast, "env"), "ASSETS"), "fetch");
    let typeof_assets_fetch = Expression::new_binary_expression(
        SPAN,
        Expression::new_unary_expression(SPAN, UnaryOperator::Typeof, env_assets_fetch, &ast),
        BinaryOperator::StrictEquality,
        str_lit(&ast, "function"),
        &ast,
    );
    let has_assets = Expression::new_logical_expression(
        SPAN,
        Expression::new_logical_expression(
            SPAN,
            ident(&ast, "env"),
            LogicalOperator::And,
            env_assets,
            &ast,
        ),
        LogicalOperator::And,
        typeof_assets_fetch,
        &ast,
    );

    let mut assets_stmts = ArenaVec::new_in(&ast);
    // const assetResponse = await env.ASSETS.fetch(request);
    let call_assets_fetch = call(
        &ast,
        member(&ast, member(&ast, ident(&ast, "env"), "ASSETS"), "fetch"),
        vec![ident(&ast, "request")],
    );
    assets_stmts.push(const_decl(
        &ast,
        "assetResponse",
        Expression::new_await_expression(SPAN, call_assets_fetch, &ast),
    ));

    // const contentType = assetResponse.headers.get("content-type") || "";
    let get_ct = call(
        &ast,
        member(
            &ast,
            member(&ast, ident(&ast, "assetResponse"), "headers"),
            "get",
        ),
        vec![str_lit(&ast, "content-type")],
    );
    assets_stmts.push(const_decl(
        &ast,
        "contentType",
        Expression::new_logical_expression(
            SPAN,
            get_ct,
            LogicalOperator::Or,
            str_lit(&ast, ""),
            &ast,
        ),
    ));

    // if (contentType.includes("text/html")) { ... }
    let is_html_ct = call(
        &ast,
        member(&ast, ident(&ast, "contentType"), "includes"),
        vec![str_lit(&ast, "text/html")],
    );
    let mut html_stmts = ArenaVec::new_in(&ast);
    if include_wasm {
        html_stmts.push(make_env_wasm_check("env"));
    }

    let mut rewriter_opts_props = ArenaVec::new_in(&ast);
    rewriter_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "request", &ast),
        ident(&ast, "request"),
        false,
    ));
    rewriter_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "env", &ast),
        ident(&ast, "env"),
        false,
    ));
    rewriter_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "secret", &ast),
        member(&ast, ident(&ast, "env"), "LIT_ACTION_SECRET"),
        false,
    ));
    rewriter_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "buildId", &ast),
        ident(&ast, "buildId"),
        false,
    ));
    let obj_keys_manifest = call(
        &ast,
        member(&ast, ident(&ast, "Object"), "keys"),
        vec![ident(&ast, "tagManifest")],
    );
    rewriter_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "tagManifest", &ast),
        obj_keys_manifest,
        false,
    ));
    rewriter_opts_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "customElements", &ast),
        ident(&ast, "registry"),
        false,
    ));

    let call_rewriter = call(
        &ast,
        ident(&ast, "transformServerElementsWithHtmlRewriter"),
        vec![
            ident(&ast, "assetResponse"),
            Expression::new_object_expression(SPAN, rewriter_opts_props, &ast),
        ],
    );
    html_stmts.push(Statement::new_return_statement(
        SPAN,
        Some(call_rewriter),
        &ast,
    ));

    assets_stmts.push(Statement::new_if_statement(
        SPAN,
        is_html_ct,
        Statement::new_block_statement(SPAN, html_stmts, &ast),
        None,
        &ast,
    ));
    assets_stmts.push(Statement::new_return_statement(
        SPAN,
        Some(ident(&ast, "assetResponse")),
        &ast,
    ));

    fetch_stmts.push(Statement::new_if_statement(
        SPAN,
        has_assets,
        Statement::new_block_statement(SPAN, assets_stmts, &ast),
        None,
        &ast,
    ));

    // return new Response("Not Found", { status: 404 });
    let mut status_props = ArenaVec::new_in(&ast);
    status_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "status", &ast),
        Expression::new_numeric_literal(SPAN, 404.0, None, NumberBase::Decimal, &ast),
        false,
    ));
    let mut not_found_args = ArenaVec::new_in(&ast);
    not_found_args.push(Argument::from(str_lit(&ast, "Not Found")));
    not_found_args.push(Argument::from(Expression::new_object_expression(
        SPAN,
        status_props,
        &ast,
    )));
    fetch_stmts.push(Statement::new_return_statement(
        SPAN,
        Some(Expression::new_new_expression(
            SPAN,
            ident(&ast, "Response"),
            None,
            not_found_args,
            &ast,
        )),
        &ast,
    ));

    let fetch_fn = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        true,
        false,
        None,
        None,
        make_params(
            &ast,
            FormalParameterKind::FormalParameter,
            &["request", "env", "ctx"],
        ),
        None,
        Some(FunctionBody::boxed(
            SPAN,
            ArenaVec::new_in(&ast),
            fetch_stmts,
            &ast,
        )),
        &ast,
    );
    let mut default_props = ArenaVec::new_in(&ast);
    default_props.push(obj_prop(
        &ast,
        PropertyKey::new_static_identifier(SPAN, "fetch", &ast),
        Expression::FunctionExpression(fetch_fn),
        true,
    ));
    body.push(Statement::new_export_default_declaration(
        SPAN,
        ExportDefaultDeclarationKind::from(Expression::new_object_expression(
            SPAN,
            default_props,
            &ast,
        )),
        &ast,
    ));

    let program = Program::new(
        SPAN,
        SourceType::mjs(),
        "",
        ArenaVec::new_in(&ast),
        None,
        ArenaVec::new_in(&ast),
        body,
        &ast,
    );

    Codegen::new().build(&program).code
}
