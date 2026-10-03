use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
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
    source: &str,
    reactive_props: &HashMap<String, usize>,
    allocator: &'a Allocator,
    source_type: SourceType,
    masked_count: &mut u32,
) {
    match expr {
        Expression::TaggedTemplateExpression(tagged) => {
            if is_lit_html_tag(&tagged.tag) {
                for quasi_expr in &mut tagged.quasi.expressions {
                    let start = quasi_expr.span().start as usize;
                    let end = quasi_expr.span().end as usize;
                    if start < end && end <= source.len() {
                        let expr_slice = &source[start..end];
                        if expr_slice.contains("__litDirtyMask") {
                            continue;
                        }
                        let mask = compute_part_mask(quasi_expr, reactive_props);
                        let repl = format!(
                            "(this.__litDirtyMask & {}) ? ({}) : noChange",
                            mask, expr_slice
                        );
                        let dummy_prog = format!("let __d = {};", repl);
                        let parsed_e =
                            Parser::new(allocator, allocator.alloc_str(&dummy_prog), source_type)
                                .parse();
                        if let Some(Statement::VariableDeclaration(mut var_decl)) =
                            parsed_e.program.body.into_iter().next()
                        {
                            if !var_decl.declarations.is_empty() {
                                if let Some(init) = var_decl.declarations.remove(0).init {
                                    *quasi_expr = init;
                                    *masked_count += 1;
                                }
                            }
                        }
                    }
                }
            } else {
                for quasi_expr in &mut tagged.quasi.expressions {
                    mask_expressions_in_expr(
                        quasi_expr,
                        source,
                        reactive_props,
                        allocator,
                        source_type,
                        masked_count,
                    );
                }
            }
        }
        Expression::ParenthesizedExpression(paren) => {
            mask_expressions_in_expr(
                &mut paren.expression,
                source,
                reactive_props,
                allocator,
                source_type,
                masked_count,
            );
        }
        Expression::ConditionalExpression(cond) => {
            mask_expressions_in_expr(
                &mut cond.test,
                source,
                reactive_props,
                allocator,
                source_type,
                masked_count,
            );
            mask_expressions_in_expr(
                &mut cond.consequent,
                source,
                reactive_props,
                allocator,
                source_type,
                masked_count,
            );
            mask_expressions_in_expr(
                &mut cond.alternate,
                source,
                reactive_props,
                allocator,
                source_type,
                masked_count,
            );
        }
        _ => {}
    }
}

fn mask_expressions_in_stmt<'a>(
    stmt: &mut Statement<'a>,
    source: &str,
    reactive_props: &HashMap<String, usize>,
    allocator: &'a Allocator,
    source_type: SourceType,
    masked_count: &mut u32,
) {
    match stmt {
        Statement::ReturnStatement(ret) => {
            if let Some(ref mut arg) = ret.argument {
                mask_expressions_in_expr(
                    arg,
                    source,
                    reactive_props,
                    allocator,
                    source_type,
                    masked_count,
                );
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            mask_expressions_in_expr(
                &mut expr_stmt.expression,
                source,
                reactive_props,
                allocator,
                source_type,
                masked_count,
            );
        }
        Statement::VariableDeclaration(var_decl) => {
            for decl in &mut var_decl.declarations {
                if let Some(ref mut init) = decl.init {
                    mask_expressions_in_expr(
                        init,
                        source,
                        reactive_props,
                        allocator,
                        source_type,
                        masked_count,
                    );
                }
            }
        }
        Statement::BlockStatement(block) => {
            for s in &mut block.body {
                mask_expressions_in_stmt(
                    s,
                    source,
                    reactive_props,
                    allocator,
                    source_type,
                    masked_count,
                );
            }
        }
        Statement::IfStatement(if_stmt) => {
            mask_expressions_in_expr(
                &mut if_stmt.test,
                source,
                reactive_props,
                allocator,
                source_type,
                masked_count,
            );
            mask_expressions_in_stmt(
                &mut if_stmt.consequent,
                source,
                reactive_props,
                allocator,
                source_type,
                masked_count,
            );
            if let Some(ref mut alt) = if_stmt.alternate {
                mask_expressions_in_stmt(
                    alt,
                    source,
                    reactive_props,
                    allocator,
                    source_type,
                    masked_count,
                );
            }
        }
        _ => {}
    }
}

fn mask_expressions_in_body<'a>(
    body: &mut FunctionBody<'a>,
    source: &str,
    reactive_props: &HashMap<String, usize>,
    allocator: &'a Allocator,
    source_type: SourceType,
    masked_count: &mut u32,
) {
    for stmt in &mut body.statements {
        mask_expressions_in_stmt(
            stmt,
            source,
            reactive_props,
            allocator,
            source_type,
            masked_count,
        );
    }
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
                                                    .map_or(false, is_reactive_decorator)
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
                                source,
                                &reactive_props,
                                &allocator,
                                source_type,
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

        let mut mask_calcs = String::new();
        for (prop_name, idx) in &sorted_props {
            let bit = 1 << idx;
            mask_calcs.push_str(&format!(
                "      if (changedProperties.has('{}')) mask |= {};\n",
                prop_name, bit
            ));
        }

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
                let alias_line = match existing_param.as_deref() {
                    Some("changedProperties") => String::new(),
                    Some(other) => {
                        format!("    const changedProperties = {} || new Map();\n", other)
                    }
                    None => {
                        "    const changedProperties = arguments[0] || new Map();\n".to_string()
                    }
                };
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
                        let block_code = format!(
                            "function __d() {{\n{}    let mask = 0;\n    if (this.hasUpdated) {{\n{}    }} else {{\n      mask = -1;\n    }}\n    this.__litDirtyMask = mask;\n}}",
                            alias_line,
                            mask_calcs
                        );
                        let parsed_b =
                            Parser::new(&allocator, allocator.alloc_str(&block_code), source_type)
                                .parse();
                        if let Some(Statement::FunctionDeclaration(mut fn_decl)) =
                            parsed_b.program.body.into_iter().next()
                        {
                            if let Some(ref mut fn_body) = fn_decl.body {
                                let stmts = std::mem::replace(
                                    &mut fn_body.statements,
                                    oxc_allocator::ArenaVec::new_in(&&allocator),
                                );
                                for (i, stmt) in stmts.into_iter().enumerate() {
                                    body.statements.insert(i, stmt);
                                }
                            }
                        }
                    }
                }
            }
        } else {
            let method_code = format!(
                "class __D {{\n  update(changedProperties) {{\n    let mask = 0;\n    if (this.hasUpdated) {{\n{}    }} else {{\n      mask = -1;\n    }}\n    this.__litDirtyMask = mask;\n    super.update(changedProperties);\n  }}\n}}",
                mask_calcs
            );
            let parsed_m =
                Parser::new(&allocator, allocator.alloc_str(&method_code), source_type).parse();
            if let Some(Statement::ClassDeclaration(mut d_class)) =
                parsed_m.program.body.into_iter().next()
            {
                if !d_class.body.body.is_empty() {
                    let method = d_class.body.body.remove(0);
                    class.body.body.push(method);
                }
            }
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
        if let Some(idx) = lit_import_idx {
            if let Statement::ImportDeclaration(ref mut import_decl) = &mut parsed.program.body[idx]
            {
                let dummy_imp = "import { noChange } from 'lit';";
                let p_imp = Parser::new(&allocator, dummy_imp, source_type).parse();
                if let Some(Statement::ImportDeclaration(mut d)) =
                    p_imp.program.body.into_iter().next()
                {
                    if let Some(mut specs) = d.specifiers.take() {
                        if let Some(spec) = specs.pop() {
                            if let Some(ref mut current_specs) = import_decl.specifiers {
                                current_specs.push(spec);
                            }
                        }
                    }
                }
            }
        } else {
            let dummy_imp = "import { noChange } from 'lit';\n";
            let p_imp = Parser::new(&allocator, dummy_imp, source_type).parse();
            if let Some(import_stmt) = p_imp.program.body.into_iter().next() {
                parsed.program.body.insert(0, import_stmt);
            }
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
