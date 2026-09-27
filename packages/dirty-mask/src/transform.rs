use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
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

struct TemplateExpressionCollector<'a> {
    source: &'a str,
    reactive_props: &'a HashMap<String, usize>,
    replacements: Vec<(usize, usize, String)>,
    masked_count: u32,
}

impl<'a> Visit<'a> for TemplateExpressionCollector<'a> {
    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if is_lit_html_tag(&tagged.tag) {
            for expr in &tagged.quasi.expressions {
                let start = expr.span().start as usize;
                let end = expr.span().end as usize;
                let expr_slice = &self.source[start..end];

                if expr_slice.starts_with("(this.__litDirtyMask &") {
                    continue;
                }

                let mask = compute_part_mask(expr, self.reactive_props);
                let repl = format!(
                    "(this.__litDirtyMask & {}) ? ({}) : noChange",
                    mask, expr_slice
                );
                self.replacements.push((start, end, repl));
                self.masked_count += 1;
            }
            return;
        }

        oxc_ast_visit::walk::walk_tagged_template_expression(self, tagged);
    }
}

fn collect_classes<'a>(stmts: &'a [Statement<'a>], out: &mut Vec<&'a Class<'a>>) {
    for stmt in stmts {
        match stmt {
            Statement::ClassDeclaration(class) => {
                out.push(class);
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &export_decl.declaration {
                    out.push(class);
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &export_decl.declaration
                {
                    out.push(class);
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &var_decl.declarations {
                    if let Some(Expression::ClassExpression(class)) = &decl.init {
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

    let parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return DirtyMaskResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            masked_parts_count: 0,
            properties_count: 0,
        };
    }

    let program = &parsed.program;
    let mut classes = Vec::new();
    collect_classes(&program.body, &mut classes);

    if classes.is_empty() {
        return DirtyMaskResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            masked_parts_count: 0,
            properties_count: 0,
        };
    }

    let mut replacements: Vec<(usize, usize, String)> = Vec::new();
    let mut total_components_count: u32 = 0;
    let mut total_masked_parts_count: u32 = 0;
    let mut total_properties_count: u32 = 0;

    for class in classes {
        let (reactive_props, sorted_props) = collect_reactive_properties(class);
        if reactive_props.is_empty() {
            continue;
        }

        let mut collector = TemplateExpressionCollector {
            source,
            reactive_props: &reactive_props,
            replacements: Vec::new(),
            masked_count: 0,
        };

        let mut existing_update: Option<(&MethodDefinition, usize, String)> = None;

        for elem in &class.body.body {
            if let ClassElement::MethodDefinition(method) = elem {
                let name = method.key.static_name();
                if !method.r#static {
                    if name.as_deref() == Some("render") {
                        collector.visit_method_definition(method);
                    } else if name.as_deref() == Some("update") {
                        if let Some(body) = &method.value.body {
                            let param_name = method
                                .value
                                .params
                                .items
                                .first()
                                .and_then(|p| match &p.pattern {
                                    BindingPattern::BindingIdentifier(id) => {
                                        Some(id.name.to_string())
                                    }
                                    _ => None,
                                })
                                .unwrap_or_else(|| "changedProperties".to_string());

                            existing_update = Some((method, body.span.start as usize, param_name));
                        }
                    }
                }
            }
        }

        if collector.masked_count == 0 {
            continue;
        }

        total_components_count += 1;
        total_masked_parts_count += collector.masked_count;
        total_properties_count += reactive_props.len() as u32;

        replacements.extend(collector.replacements);

        let mut mask_calcs = String::new();
        for (prop_name, idx) in &sorted_props {
            let bit = 1 << idx;
            mask_calcs.push_str(&format!(
                "      if (changedProperties.has('{}')) mask |= {};\n",
                prop_name, bit
            ));
        }

        if let Some((_method, body_start, _param_name)) = existing_update {
            let body_src = &source[body_start..];
            if !body_src.contains("this.__litDirtyMask") {
                let update_injection = format!(
                    "\n    let mask = 0;\n    if (this.hasUpdated) {{\n{}    }} else {{\n      mask = -1;\n    }}\n    this.__litDirtyMask = mask;\n",
                    mask_calcs
                );
                replacements.push((body_start + 1, body_start + 1, update_injection));
            }
        } else {
            let class_end = class.body.span.end as usize;
            let synthesized_update = format!(
                "\n  update(changedProperties) {{\n    let mask = 0;\n    if (this.hasUpdated) {{\n{}    }} else {{\n      mask = -1;\n    }}\n    this.__litDirtyMask = mask;\n    super.update(changedProperties);\n  }}\n",
                mask_calcs
            );
            replacements.push((class_end - 1, class_end - 1, synthesized_update));
        }
    }

    if total_components_count == 0 || replacements.is_empty() {
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
    let mut lit_named_import_insert_pos: Option<usize> = None;

    for stmt in &program.body {
        if let Statement::ImportDeclaration(import_decl) = stmt {
            let specifier = import_decl.source.value.as_str();
            if specifier == "lit" || specifier == "lit-html" {
                if let Some(specifiers) = &import_decl.specifiers {
                    for spec in specifiers {
                        if let ImportDeclarationSpecifier::ImportSpecifier(named) = spec {
                            if named.imported.name() == "noChange" {
                                has_no_change = true;
                                break;
                            }
                        }
                    }
                    if !has_no_change && lit_named_import_insert_pos.is_none() {
                        let decl_str =
                            &source[import_decl.span.start as usize..import_decl.span.end as usize];
                        if let Some(brace_idx) = decl_str.find('{') {
                            lit_named_import_insert_pos =
                                Some(import_decl.span.start as usize + brace_idx + 1);
                        }
                    }
                }
            }
        }
    }

    if !has_no_change {
        if let Some(pos) = lit_named_import_insert_pos {
            replacements.push((pos, pos, " noChange,".to_string()));
        } else {
            replacements.push((0, 0, "import { noChange } from 'lit';\n".to_string()));
        }
    }

    // Sort replacements descending by start position
    replacements.sort_by_key(|b| std::cmp::Reverse(b.0));

    let mut rewritten = source.to_string();
    for (start, end, repl) in replacements {
        if start <= end && end <= rewritten.len() {
            rewritten.replace_range(start..end, &repl);
        }
    }

    DirtyMaskResult {
        code: rewritten,
        map: None,
        components_count: total_components_count,
        masked_parts_count: total_masked_parts_count,
        properties_count: total_properties_count,
    }
}
