use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, SPAN};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirtyMaskOptions {
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirtyMaskResult {
    pub code: String,
    pub map: Option<String>,
    pub components_count: u32,
    pub masked_parts_count: u32,
    pub properties_count: u32,
}

fn is_lit_html_tag(tag: &Expression) -> bool {
    match tag {
        Expression::Identifier(ident) => ident.name == "html" || ident.name == "svg",
        Expression::StaticMemberExpression(mem) => {
            mem.property.name == "html" || mem.property.name == "svg"
        }
        _ => false,
    }
}

fn is_reactive_decorator(expr: &Expression) -> bool {
    match expr {
        Expression::Identifier(ident) => ident.name == "property" || ident.name == "state",
        Expression::CallExpression(call) => match &call.callee {
            Expression::Identifier(ident) => ident.name == "property" || ident.name == "state",
            Expression::StaticMemberExpression(mem) => {
                mem.property.name == "property" || mem.property.name == "state"
            }
            _ => false,
        },
        Expression::StaticMemberExpression(mem) => {
            mem.property.name == "property" || mem.property.name == "state"
        }
        _ => false,
    }
}

fn get_root_this_prop(expr: &Expression) -> Option<String> {
    match expr {
        Expression::StaticMemberExpression(mem) => {
            if let Expression::ThisExpression(_) = &mem.object {
                Some(mem.property.name.to_string())
            } else {
                get_root_this_prop(&mem.object)
            }
        }
        Expression::ComputedMemberExpression(comp) => {
            if let Expression::ThisExpression(_) = &comp.object {
                None
            } else {
                get_root_this_prop(&comp.object)
            }
        }
        _ => None,
    }
}

fn analyze_expr_dependencies(
    expr: &Expression,
    reactive_props: &HashMap<String, usize>,
    accessed_bits: &mut u32,
    has_unknown: &mut bool,
) {
    if *has_unknown {
        return;
    }
    match expr {
        Expression::Identifier(ident) => {
            let name = ident.name.as_str();
            let is_safe_global = matches!(
                name,
                "undefined"
                    | "NaN"
                    | "Infinity"
                    | "null"
                    | "true"
                    | "false"
                    | "Math"
                    | "Number"
                    | "String"
                    | "Boolean"
                    | "Array"
                    | "Object"
                    | "JSON"
                    | "Date"
                    | "Intl"
                    | "RegExp"
            );
            if !is_safe_global {
                *has_unknown = true;
            }
        }
        Expression::ThisExpression(_) => {
            *has_unknown = true;
        }
        Expression::StaticMemberExpression(mem) => {
            if let Expression::ThisExpression(_) = &mem.object {
                let prop_name = mem.property.name.as_str();
                if let Some(&idx) = reactive_props.get(prop_name) {
                    if idx < 30 {
                        *accessed_bits |= 1 << idx;
                    } else {
                        *has_unknown = true;
                    }
                } else {
                    *has_unknown = true;
                }
            } else if let Some(prop_name) = get_root_this_prop(&mem.object) {
                if let Some(&idx) = reactive_props.get(prop_name.as_str()) {
                    if idx < 30 {
                        *accessed_bits |= 1 << idx;
                    } else {
                        *has_unknown = true;
                    }
                } else {
                    *has_unknown = true;
                }
            } else if let Expression::Identifier(ident) = &mem.object {
                let name = ident.name.as_str();
                if !matches!(name, "Math" | "Number" | "JSON" | "Intl") {
                    *has_unknown = true;
                }
            } else {
                *has_unknown = true;
            }
        }
        Expression::ComputedMemberExpression(comp) => {
            if let Some(prop_name) = get_root_this_prop(&comp.object) {
                if let Some(&idx) = reactive_props.get(prop_name.as_str()) {
                    if idx < 30 {
                        *accessed_bits |= 1 << idx;
                    } else {
                        *has_unknown = true;
                    }
                } else {
                    *has_unknown = true;
                }
            } else {
                *has_unknown = true;
            }
            analyze_expr_dependencies(&comp.expression, reactive_props, accessed_bits, has_unknown);
        }
        Expression::BinaryExpression(bin) => {
            analyze_expr_dependencies(&bin.left, reactive_props, accessed_bits, has_unknown);
            analyze_expr_dependencies(&bin.right, reactive_props, accessed_bits, has_unknown);
        }
        Expression::UnaryExpression(un) => {
            analyze_expr_dependencies(&un.argument, reactive_props, accessed_bits, has_unknown);
        }
        Expression::LogicalExpression(log) => {
            analyze_expr_dependencies(&log.left, reactive_props, accessed_bits, has_unknown);
            analyze_expr_dependencies(&log.right, reactive_props, accessed_bits, has_unknown);
        }
        Expression::ConditionalExpression(cond) => {
            analyze_expr_dependencies(&cond.test, reactive_props, accessed_bits, has_unknown);
            analyze_expr_dependencies(&cond.consequent, reactive_props, accessed_bits, has_unknown);
            analyze_expr_dependencies(&cond.alternate, reactive_props, accessed_bits, has_unknown);
        }
        Expression::ParenthesizedExpression(paren) => {
            analyze_expr_dependencies(
                &paren.expression,
                reactive_props,
                accessed_bits,
                has_unknown,
            );
        }
        Expression::TemplateLiteral(temp) => {
            for sub_expr in &temp.expressions {
                analyze_expr_dependencies(sub_expr, reactive_props, accessed_bits, has_unknown);
            }
        }
        Expression::ArrayExpression(arr) => {
            for elem in &arr.elements {
                if let Some(el_expr) = elem.as_expression() {
                    analyze_expr_dependencies(el_expr, reactive_props, accessed_bits, has_unknown);
                } else {
                    *has_unknown = true;
                }
            }
        }
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::RegExpLiteral(_) => {}
        _ => {
            *has_unknown = true;
        }
    }
}

fn compute_part_mask(expr: &Expression, reactive_props: &HashMap<String, usize>) -> i32 {
    let mut accessed_bits = 0u32;
    let mut has_unknown = false;
    analyze_expr_dependencies(expr, reactive_props, &mut accessed_bits, &mut has_unknown);
    if has_unknown || accessed_bits == 0 {
        -1
    } else {
        accessed_bits as i32
    }
}

fn collect_classes_mut<'a, 'b>(stmts: &'b mut [Statement<'a>], out: &mut Vec<&'b mut Class<'a>>) {
    for stmt in stmts {
        match stmt {
            Statement::ClassDeclaration(class) => {
                out.push(class);
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &mut export_decl.declaration {
                    out.push(class);
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &mut export_decl.declaration
                {
                    out.push(class);
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &mut var_decl.declarations {
                    if let Some(Expression::ClassExpression(class)) = &mut decl.init {
                        out.push(class);
                    }
                }
            }
            _ => {}
        }
    }
}

fn collect_reactive_properties(class: &Class) -> (HashMap<String, usize>, Vec<(String, usize)>) {
    let mut prop_indices: HashMap<String, usize> = HashMap::new();
    let mut sorted_props: Vec<(String, usize)> = Vec::new();

    let mut add_prop = |name: String| {
        if !prop_indices.contains_key(&name) {
            let idx = sorted_props.len();
            prop_indices.insert(name.clone(), idx);
            sorted_props.push((name, idx));
        }
    };

    for elem in &class.body.body {
        match elem {
            ClassElement::PropertyDefinition(prop_def) => {
                let is_static_properties = prop_def.r#static
                    && prop_def
                        .key
                        .static_name()
                        .map(|n| n == "properties")
                        .unwrap_or(false);

                if is_static_properties {
                    if let Some(Expression::ObjectExpression(obj)) = &prop_def.value {
                        for prop in &obj.properties {
                            if let ObjectPropertyKind::ObjectProperty(p) = prop {
                                if let Some(name) = p.key.static_name() {
                                    add_prop(name.to_string());
                                }
                            }
                        }
                    }
                } else {
                    let has_reactive_decorator = prop_def
                        .decorators
                        .iter()
                        .any(|d| is_reactive_decorator(&d.expression));

                    if has_reactive_decorator {
                        if let Some(name) = prop_def.key.static_name() {
                            add_prop(name.to_string());
                        }
                    }
                }
            }
            ClassElement::AccessorProperty(accessor_def) => {
                let has_reactive_decorator = accessor_def
                    .decorators
                    .iter()
                    .any(|d| is_reactive_decorator(&d.expression));

                if has_reactive_decorator {
                    if let Some(name) = accessor_def.key.static_name() {
                        add_prop(name.to_string());
                    }
                }
            }
            ClassElement::MethodDefinition(method_def) => {
                let is_static_get_properties = method_def.r#static
                    && method_def.kind == MethodDefinitionKind::Get
                    && method_def
                        .key
                        .static_name()
                        .map(|n| n == "properties")
                        .unwrap_or(false);

                if is_static_get_properties {
                    if let Some(body) = &method_def.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt {
                                if let Some(Expression::ObjectExpression(obj)) = &ret.argument {
                                    for prop in &obj.properties {
                                        if let ObjectPropertyKind::ObjectProperty(p) = prop {
                                            if let Some(name) = p.key.static_name() {
                                                add_prop(name.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    let has_reactive_decorator = method_def
                        .decorators
                        .iter()
                        .any(|d| is_reactive_decorator(&d.expression));

                    if has_reactive_decorator {
                        if let Some(name) = method_def.key.static_name() {
                            add_prop(name.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }

    (prop_indices, sorted_props)
}

fn mask_expressions_in_expr<'a>(
    expr: &mut Expression<'a>,
    reactive_props: &HashMap<String, usize>,
    allocator: &'a Allocator,
    masked_count: &mut u32,
) {
    match expr {
        Expression::TaggedTemplateExpression(tagged) => {
            if is_lit_html_tag(&tagged.tag) {
                for quasi_expr in &mut tagged.quasi.expressions {
                    if let Expression::ConditionalExpression(cond) = quasi_expr {
                        if let Expression::BinaryExpression(bin) = &cond.test {
                            if let Expression::StaticMemberExpression(mem) = &bin.left {
                                if mem.property.name == "__litDirtyMask" {
                                    continue;
                                }
                            }
                        }
                    }

                    let mask = compute_part_mask(quasi_expr, reactive_props);
                    let ast = AstBuilder::new(allocator);

                    let this_expr = Expression::new_this_expression(SPAN, &ast);
                    let member_prop = IdentifierName::new(SPAN, "__litDirtyMask", &ast);
                    let member = Expression::new_static_member_expression(
                        SPAN,
                        this_expr,
                        member_prop,
                        false,
                        &ast,
                    );
                    let mask_num = Expression::new_numeric_literal(
                        SPAN,
                        mask as f64,
                        None,
                        NumberBase::Decimal,
                        &ast,
                    );
                    let test = Expression::new_binary_expression(
                        SPAN,
                        member,
                        BinaryOperator::BitwiseAnd,
                        mask_num,
                        &ast,
                    );

                    let placeholder = Expression::new_identifier(SPAN, "noChange", &ast);
                    let original = std::mem::replace(quasi_expr, placeholder);
                    let conditional = Expression::new_conditional_expression(
                        SPAN,
                        test,
                        original,
                        Expression::new_identifier(SPAN, "noChange", &ast),
                        &ast,
                    );
                    *quasi_expr = conditional;
                    *masked_count += 1;
                }
            } else {
                for quasi_expr in &mut tagged.quasi.expressions {
                    mask_expressions_in_expr(quasi_expr, reactive_props, allocator, masked_count);
                }
            }
        }
        Expression::ParenthesizedExpression(paren) => {
            mask_expressions_in_expr(
                &mut paren.expression,
                reactive_props,
                allocator,
                masked_count,
            );
        }
        Expression::ConditionalExpression(cond) => {
            mask_expressions_in_expr(&mut cond.test, reactive_props, allocator, masked_count);
            mask_expressions_in_expr(
                &mut cond.consequent,
                reactive_props,
                allocator,
                masked_count,
            );
            mask_expressions_in_expr(&mut cond.alternate, reactive_props, allocator, masked_count);
        }
        _ => {}
    }
}

fn mask_expressions_in_stmt<'a>(
    stmt: &mut Statement<'a>,
    reactive_props: &HashMap<String, usize>,
    allocator: &'a Allocator,
    masked_count: &mut u32,
) {
    match stmt {
        Statement::ReturnStatement(ret) => {
            if let Some(ref mut arg) = ret.argument {
                mask_expressions_in_expr(arg, reactive_props, allocator, masked_count);
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            mask_expressions_in_expr(
                &mut expr_stmt.expression,
                reactive_props,
                allocator,
                masked_count,
            );
        }
        Statement::VariableDeclaration(var_decl) => {
            for decl in &mut var_decl.declarations {
                if let Some(ref mut init) = decl.init {
                    mask_expressions_in_expr(init, reactive_props, allocator, masked_count);
                }
            }
        }
        Statement::BlockStatement(block) => {
            for s in &mut block.body {
                mask_expressions_in_stmt(s, reactive_props, allocator, masked_count);
            }
        }
        Statement::IfStatement(if_stmt) => {
            mask_expressions_in_expr(&mut if_stmt.test, reactive_props, allocator, masked_count);
            mask_expressions_in_stmt(
                &mut if_stmt.consequent,
                reactive_props,
                allocator,
                masked_count,
            );
            if let Some(ref mut alt) = if_stmt.alternate {
                mask_expressions_in_stmt(alt, reactive_props, allocator, masked_count);
            }
        }
        _ => {}
    }
}

fn mask_expressions_in_body<'a>(
    body: &mut FunctionBody<'a>,
    reactive_props: &HashMap<String, usize>,
    allocator: &'a Allocator,
    masked_count: &mut u32,
) {
    for stmt in &mut body.statements {
        mask_expressions_in_stmt(stmt, reactive_props, allocator, masked_count);
    }
}

fn build_alias_statement<'a>(param: Option<&str>, ast: &AstBuilder<'a>) -> Option<Statement<'a>> {
    let param = param?;
    if param == "changedProperties" {
        return None;
    }
    let cp_binding = BindingPattern::new_binding_identifier(SPAN, "changedProperties", ast);
    let param_expr = if param.is_empty() {
        let args_ident = Expression::new_identifier(SPAN, "arguments", ast);
        let zero = Expression::new_numeric_literal(SPAN, 0.0, None, NumberBase::Decimal, ast);
        Expression::new_computed_member_expression(SPAN, args_ident, zero, false, ast)
    } else {
        Expression::new_identifier(SPAN, ast.allocator().alloc_str(param), ast)
    };
    let new_map = Expression::new_new_expression(
        SPAN,
        Expression::new_identifier(SPAN, "Map", ast),
        None,
        ArenaVec::new_in(ast),
        ast,
    );
    let logical_or =
        Expression::new_logical_expression(SPAN, param_expr, LogicalOperator::Or, new_map, ast);
    let declarator = VariableDeclarator::new(SPAN, cp_binding, None, Some(logical_or), false, ast);
    let mut decls = ArenaVec::new_in(ast);
    decls.push(declarator);
    Some(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        decls,
        false,
        ast,
    ))
}

fn build_mask_calc_statements<'a>(
    sorted_props: &[(String, usize)],
    ast: &AstBuilder<'a>,
) -> ArenaVec<'a, Statement<'a>> {
    let mut stmts = ArenaVec::new_in(ast);

    let mask_binding = BindingPattern::new_binding_identifier(SPAN, "mask", ast);
    let zero = Expression::new_numeric_literal(SPAN, 0.0, None, NumberBase::Decimal, ast);
    let declarator = VariableDeclarator::new(SPAN, mask_binding, None, Some(zero), false, ast);
    let mut decls = ArenaVec::new_in(ast);
    decls.push(declarator);
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Let,
        decls,
        false,
        ast,
    ));

    let mut if_stmts = ArenaVec::new_in(ast);
    for (prop_name, idx) in sorted_props {
        let bit = 1u32 << idx;

        let cp_ident = Expression::new_identifier(SPAN, "changedProperties", ast);
        let has_prop = IdentifierName::new(SPAN, "has", ast);
        let has_member =
            Expression::new_static_member_expression(SPAN, cp_ident, has_prop, false, ast);
        let mut has_args = ArenaVec::new_in(ast);
        has_args.push(Argument::from(Expression::new_string_literal(
            SPAN,
            ast.allocator().alloc_str(prop_name.as_str()),
            None,
            ast,
        )));
        let has_call =
            Expression::new_call_expression(SPAN, has_member, None, has_args, false, ast);

        let mask_target = AssignmentTarget::new_assignment_target_identifier(SPAN, "mask", ast);
        let bit_num =
            Expression::new_numeric_literal(SPAN, bit as f64, None, NumberBase::Decimal, ast);
        let assign = Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::BitwiseOR,
            mask_target,
            bit_num,
            ast,
        );
        let assign_stmt = Statement::new_expression_statement(SPAN, assign, ast);

        if_stmts.push(Statement::new_if_statement(
            SPAN,
            has_call,
            assign_stmt,
            None,
            ast,
        ));
    }

    let if_block = Statement::new_block_statement(SPAN, if_stmts, ast);

    let mask_target = AssignmentTarget::new_assignment_target_identifier(SPAN, "mask", ast);
    let neg_one = Expression::new_numeric_literal(SPAN, -1.0, None, NumberBase::Decimal, ast);
    let neg_one_assign = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        mask_target,
        neg_one,
        ast,
    );
    let neg_one_stmt = Statement::new_expression_statement(SPAN, neg_one_assign, ast);
    let mut else_stmts = ArenaVec::new_in(ast);
    else_stmts.push(neg_one_stmt);
    let else_block = Statement::new_block_statement(SPAN, else_stmts, ast);

    let this_expr = Expression::new_this_expression(SPAN, ast);
    let has_updated_prop = IdentifierName::new(SPAN, "hasUpdated", ast);
    let has_updated =
        Expression::new_static_member_expression(SPAN, this_expr, has_updated_prop, false, ast);
    stmts.push(Statement::new_if_statement(
        SPAN,
        has_updated,
        if_block,
        Some(else_block),
        ast,
    ));

    let this_expr2 = Expression::new_this_expression(SPAN, ast);
    let member_prop = IdentifierName::new(SPAN, "__litDirtyMask", ast);
    let target_member =
        AssignmentTarget::new_static_member_expression(SPAN, this_expr2, member_prop, false, ast);
    let assign_mask = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        target_member,
        Expression::new_identifier(SPAN, "mask", ast),
        ast,
    );
    stmts.push(Statement::new_expression_statement(SPAN, assign_mask, ast));

    stmts
}

fn build_super_update_statement<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    let super_expr = Expression::new_super(SPAN, ast);
    let update_prop = IdentifierName::new(SPAN, "update", ast);
    let super_member =
        Expression::new_static_member_expression(SPAN, super_expr, update_prop, false, ast);
    let mut args = ArenaVec::new_in(ast);
    args.push(Argument::from(Expression::new_identifier(
        SPAN,
        "changedProperties",
        ast,
    )));
    let super_call = Expression::new_call_expression(SPAN, super_member, None, args, false, ast);
    Statement::new_expression_statement(SPAN, super_call, ast)
}

fn build_update_method<'a>(
    sorted_props: &[(String, usize)],
    ast: &AstBuilder<'a>,
) -> ClassElement<'a> {
    let mut statements = build_mask_calc_statements(sorted_props, ast);
    statements.push(build_super_update_statement(ast));

    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), statements, ast);
    let param_pat = BindingPattern::new_binding_identifier(SPAN, "changedProperties", ast);
    let mut params_vec = ArenaVec::new_in(ast);
    params_vec.push(FormalParameter::new_plain(SPAN, param_pat, ast));
    let params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        params_vec,
        None,
        ast,
    );

    let func = Function::boxed(
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
        Some(body),
        ast,
    );

    let method_key = PropertyKey::new_static_identifier(SPAN, "update", ast);
    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        method_key,
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

pub fn transform_code(source: &str, options: DirtyMaskOptions) -> DirtyMaskResult {
    if !source.contains("html") && !source.contains("svg") {
        return DirtyMaskResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            masked_parts_count: 0,
            properties_count: 0,
        };
    }

    let allocator = Allocator::default();
    let filename = options.filename.as_deref().unwrap_or("file.ts");
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());

    let mut parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return DirtyMaskResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            masked_parts_count: 0,
            properties_count: 0,
        };
    }

    let mut external_props: HashMap<String, Vec<String>> = HashMap::new();
    for stmt in &parsed.program.body {
        if let Statement::ExpressionStatement(expr_stmt) = stmt {
            match &expr_stmt.expression {
                Expression::CallExpression(call) => {
                    if let Expression::StaticMemberExpression(mem) = &call.callee {
                        if mem.property.name == "createProperty" {
                            if let Expression::Identifier(obj_id) = &mem.object {
                                if let Some(first_arg) = call.arguments.first() {
                                    if let Some(Expression::StringLiteral(s)) =
                                        first_arg.as_expression()
                                    {
                                        external_props
                                            .entry(obj_id.name.as_str().to_string())
                                            .or_default()
                                            .push(s.value.as_str().to_string());
                                    }
                                }
                            }
                        }
                    }
                    let callee_name = match &call.callee {
                        Expression::Identifier(id) => Some(id.name.as_str()),
                        _ => None,
                    };
                    if (callee_name == Some("__decorate")
                        || callee_name == Some("__decorateClass")
                        || callee_name == Some("_ts_decorate"))
                        && call.arguments.len() >= 3
                    {
                        if let Some(Expression::StaticMemberExpression(mem)) =
                            call.arguments[1].as_expression()
                        {
                            if mem.property.name == "prototype" {
                                if let Expression::Identifier(id) = &mem.object {
                                    let class_name = id.name.as_str().to_string();
                                    let has_reactive = match call.arguments[0].as_expression() {
                                        Some(Expression::ArrayExpression(arr)) => {
                                            arr.elements.iter().any(|elem| {
                                                elem.as_expression()
                                                    .is_some_and(is_reactive_decorator)
                                            })
                                        }
                                        _ => false,
                                    };
                                    if has_reactive {
                                        if let Some(Expression::StringLiteral(s)) =
                                            call.arguments[2].as_expression()
                                        {
                                            external_props
                                                .entry(class_name)
                                                .or_default()
                                                .push(s.value.as_str().to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Expression::AssignmentExpression(assign) => {
                    if let Some(SimpleAssignmentTarget::StaticMemberExpression(mem)) =
                        assign.left.as_simple_assignment_target()
                    {
                        if mem.property.name == "properties" {
                            if let Expression::Identifier(obj_id) = &mem.object {
                                if let Expression::ObjectExpression(obj) = &assign.right {
                                    for prop in &obj.properties {
                                        if let ObjectPropertyKind::ObjectProperty(p) = prop {
                                            if let Some(name) = p.key.static_name() {
                                                external_props
                                                    .entry(obj_id.name.as_str().to_string())
                                                    .or_default()
                                                    .push(name.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let mut classes = Vec::new();
    collect_classes_mut(&mut parsed.program.body, &mut classes);

    if classes.is_empty() {
        return DirtyMaskResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            masked_parts_count: 0,
            properties_count: 0,
        };
    }

    let mut total_components_count: u32 = 0;
    let mut total_masked_parts_count: u32 = 0;
    let mut total_properties_count: u32 = 0;

    for class in classes {
        let (mut reactive_props, mut sorted_props) = collect_reactive_properties(class);
        if let Some(id) = &class.id {
            if let Some(extra) = external_props.get(id.name.as_str()) {
                for prop_name in extra {
                    if !reactive_props.contains_key(prop_name) {
                        let idx = sorted_props.len();
                        reactive_props.insert(prop_name.clone(), idx);
                        sorted_props.push((prop_name.clone(), idx));
                    }
                }
            }
        }
        if reactive_props.is_empty() {
            continue;
        }

        let mut class_masked_count = 0u32;
        let mut existing_update_idx = None;

        for (idx, elem) in class.body.body.iter_mut().enumerate() {
            if let ClassElement::MethodDefinition(method) = elem {
                let name = method.key.static_name();
                if !method.r#static {
                    if name.as_deref() == Some("render") {
                        if let Some(ref mut body) = method.value.body {
                            mask_expressions_in_body(
                                body,
                                &reactive_props,
                                &allocator,
                                &mut class_masked_count,
                            );
                        }
                    } else if name.as_deref() == Some("update") {
                        existing_update_idx = Some(idx);
                    }
                }
            }
        }

        if class_masked_count == 0 {
            continue;
        }

        total_components_count += 1;
        total_masked_parts_count += class_masked_count;
        total_properties_count += reactive_props.len() as u32;

        let ast = AstBuilder::new(&allocator);

        if let Some(idx) = existing_update_idx {
            if let ClassElement::MethodDefinition(ref mut method) = &mut class.body.body[idx] {
                let existing_param =
                    method
                        .value
                        .params
                        .items
                        .first()
                        .and_then(|p| match &p.pattern {
                            BindingPattern::BindingIdentifier(id) => {
                                Some(id.name.as_str().to_string())
                            }
                            _ => None,
                        });
                if let Some(ref mut body) = method.value.body {
                    let already_has = body.statements.iter().any(|s| {
                        let start = s.span().start as usize;
                        let end = s.span().end as usize;
                        if start < end && end <= source.len() {
                            source[start..end].contains("this.__litDirtyMask")
                        } else {
                            false
                        }
                    });
                    if !already_has {
                        let mut insert_stmts = Vec::new();
                        if let Some(alias_stmt) =
                            build_alias_statement(existing_param.as_deref().or(Some("")), &ast)
                        {
                            insert_stmts.push(alias_stmt);
                        }
                        for stmt in build_mask_calc_statements(&sorted_props, &ast) {
                            insert_stmts.push(stmt);
                        }
                        for (i, stmt) in insert_stmts.into_iter().enumerate() {
                            body.statements.insert(i, stmt);
                        }
                    }
                }
            }
        } else {
            let update_elem = build_update_method(&sorted_props, &ast);
            class.body.body.push(update_elem);
        }
    }

    if total_components_count == 0 || total_masked_parts_count == 0 {
        return DirtyMaskResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            masked_parts_count: 0,
            properties_count: 0,
        };
    }

    // Ensure import { noChange } from 'lit'; is imported
    let mut has_no_change = false;
    let mut lit_import_idx = None;

    for (idx, stmt) in parsed.program.body.iter().enumerate() {
        if let Statement::ImportDeclaration(import_decl) = stmt {
            let specifier = import_decl.source.value.as_str();
            if specifier == "lit" || specifier == "lit-html" {
                lit_import_idx = Some(idx);
                if let Some(specifiers) = &import_decl.specifiers {
                    for spec in specifiers {
                        if let ImportDeclarationSpecifier::ImportSpecifier(named) = spec {
                            if named.imported.name() == "noChange" {
                                has_no_change = true;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    if !has_no_change {
        let ast = AstBuilder::new(&allocator);
        let imported =
            ModuleExportName::IdentifierName(IdentifierName::new(SPAN, "noChange", &ast));
        let local = BindingIdentifier::new(SPAN, "noChange", &ast);
        let spec = ImportSpecifier::boxed(SPAN, imported, local, ImportOrExportKind::Value, &ast);

        if let Some(idx) = lit_import_idx {
            if let Statement::ImportDeclaration(ref mut import_decl) = &mut parsed.program.body[idx]
            {
                if let Some(ref mut current_specs) = import_decl.specifiers {
                    current_specs.push(ImportDeclarationSpecifier::ImportSpecifier(spec));
                } else {
                    let mut specs = ArenaVec::new_in(&ast);
                    specs.push(ImportDeclarationSpecifier::ImportSpecifier(spec));
                    import_decl.specifiers = Some(specs);
                }
            }
        } else {
            let mut specs = ArenaVec::new_in(&ast);
            specs.push(ImportDeclarationSpecifier::ImportSpecifier(spec));
            let source_lit = StringLiteral::new(SPAN, "lit", None, &ast);
            let import_decl = ImportDeclaration::boxed(
                SPAN,
                Some(specs),
                source_lit,
                None,
                None,
                ImportOrExportKind::Value,
                &ast,
            );
            parsed
                .program
                .body
                .insert(0, Statement::ImportDeclaration(import_decl));
        }
    }

    let mut codegen_options = CodegenOptions::default();
    if options.sourcemap.unwrap_or(false) {
        if let Some(ref filename) = options.filename {
            codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
        }
    }

    let codegen_result = Codegen::new()
        .with_options(codegen_options)
        .build(&parsed.program);
    let map_json = codegen_result.map.map(|m| m.to_json_string());

    DirtyMaskResult {
        code: codegen_result.code,
        map: map_json,
        components_count: total_components_count,
        masked_parts_count: total_masked_parts_count,
        properties_count: total_properties_count,
    }
}
