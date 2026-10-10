use napi_derive::napi;
use oxc_allocator::{Allocator, Vec as ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span, SPAN};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::parser::{parse_lit_template, PartKind, PreparedTemplate};

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct HtmlAotOptions {
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HtmlAotResult {
    pub code: String,
    pub map: Option<String>,
    pub templates_count: u32,
}

#[derive(Clone, Debug)]
struct CompiledTemplateData {
    var_name: String,
    prepared: PreparedTemplate,
}

fn contains_octal_escape(quasis: &[TemplateElement]) -> bool {
    for q in quasis {
        let s = &q.value.raw;
        let bytes = s.as_bytes();
        let len = bytes.len();
        let mut i = 0;
        while i < len {
            if bytes[i] == b'\\' {
                i += 1;
                while i < len && bytes[i] == b'0' {
                    i += 1;
                }
                if i < len && bytes[i] >= b'1' && bytes[i] <= b'9' {
                    return true;
                }
            } else {
                i += 1;
            }
        }
    }
    false
}

fn is_known_lit_module(specifier: &str) -> bool {
    specifier == "lit"
        || specifier == "lit-html"
        || specifier.starts_with("lit/")
        || specifier.starts_with("lit-html/")
}

pub fn transform_code(source: &str, options: HtmlAotOptions) -> HtmlAotResult {
    if !source.contains("html") || !source.contains('`') {
        return HtmlAotResult {
            code: source.to_string(),
            map: None,
            templates_count: 0,
        };
    }

    let allocator = Allocator::default();
    let filename = options.filename.as_deref().unwrap_or("source.ts");
    let is_ts = filename.ends_with(".ts") || filename.ends_with(".tsx");
    let source_type = SourceType::from_path(filename)
        .unwrap_or_default()
        .with_typescript(is_ts);

    let mut parsed = Parser::new(&allocator, source, source_type).parse();
    if parsed.program.body.is_empty() {
        return HtmlAotResult {
            code: source.to_string(),
            map: None,
            templates_count: 0,
        };
    }

    // 1. Scan import declarations to find local names for 'html'
    let mut html_idents = HashSet::new();
    html_idents.insert("html".to_string());

    for stmt in &parsed.program.body {
        if let Statement::ImportDeclaration(import_decl) = stmt {
            if is_known_lit_module(&import_decl.source.value) {
                if let Some(specifiers) = &import_decl.specifiers {
                    for spec in specifiers {
                        if let ImportDeclarationSpecifier::ImportSpecifier(named) = spec {
                            if named.imported.name() == "html" {
                                html_idents.insert(named.local.name.as_str().to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Walk AST to find lit template expressions
    let mut template_matches: Vec<(Span, CompiledTemplateData)> = Vec::new();
    let mut template_counter = 0;

    walk_and_collect_templates(
        &parsed.program.body,
        &html_idents,
        &mut template_matches,
        &mut template_counter,
    );

    if template_matches.is_empty() {
        return HtmlAotResult {
            code: source.to_string(),
            map: None,
            templates_count: 0,
        };
    }

    // 3. Track needed attribute constructors
    let mut need_attr_part = false;
    let mut need_prop_part = false;
    let mut need_bool_part = false;
    let mut need_event_part = false;

    for (_, tmpl) in &template_matches {
        for part in &tmpl.prepared.parts {
            if let PartKind::Attribute { ctor_type, .. } = part.kind {
                match ctor_type {
                    1 => need_attr_part = true,
                    3 => need_prop_part = true,
                    4 => need_bool_part = true,
                    5 => need_event_part = true,
                    _ => {}
                }
            }
        }
    }

    let need_ssr_import = need_attr_part || need_prop_part || need_bool_part || need_event_part;

    // 4. Construct top-level statements to insert after imports
    let mut header_stmts = Vec::new();

    if need_ssr_import {
        let mut bindings = Vec::new();
        if need_attr_part {
            bindings.push("AttributePart: A_1");
        }
        if need_prop_part {
            bindings.push("PropertyPart: P_1");
        }
        if need_bool_part {
            bindings.push("BooleanAttributePart: B_1");
        }
        if need_event_part {
            bindings.push("EventPart: E_1");
        }

        let import_snippet = format!(
            "import * as litHtmlPrivate_1 from 'lit-html/private-ssr-support.js';\nconst {{ {} }} = litHtmlPrivate_1._$LH;\n",
            bindings.join(", ")
        );
        let parsed_import = Parser::new(
            &allocator,
            allocator.alloc_str(&import_snippet),
            source_type,
        )
        .parse();
        for stmt in parsed_import.program.body {
            header_stmts.push(stmt);
        }
    }

    // Security brand: const b_1 = (i) => i;
    let brand_snippet = "const b_1 = (i) => i;\n";
    let parsed_brand =
        Parser::new(&allocator, allocator.alloc_str(brand_snippet), source_type).parse();
    for stmt in parsed_brand.program.body {
        header_stmts.push(stmt);
    }

    // Top-level template definitions associated with their source span
    let mut tmpl_stmts: Vec<(Span, Vec<Statement<'_>>)> = Vec::new();
    for (tmpl_span, tmpl) in &template_matches {
        let mut parts_items = Vec::new();
        for p in &tmpl.prepared.parts {
            match &p.kind {
                PartKind::Child => {
                    parts_items.push(format!("{{ type: 2, index: {} }}", p.index));
                }
                PartKind::Element => {
                    parts_items.push(format!("{{ type: 6, index: {} }}", p.index));
                }
                PartKind::Comment => {
                    parts_items.push(format!("{{ type: 7, index: {} }}", p.index));
                }
                PartKind::Attribute {
                    name,
                    strings,
                    ctor_type,
                } => {
                    let ctor_alias = match ctor_type {
                        3 => "P_1",
                        4 => "B_1",
                        5 => "E_1",
                        _ => "A_1",
                    };
                    let str_literals: Vec<String> = strings
                        .iter()
                        .map(|s| format!("'{}'", s.replace('\'', "\\'")))
                        .collect();
                    parts_items.push(format!(
                        "{{ type: 1, index: {}, name: '{}', strings: [{}], ctor: {} }}",
                        p.index,
                        name,
                        str_literals.join(", "),
                        ctor_alias
                    ));
                }
            }
        }

        let parts_json = format!("[{}]", parts_items.join(", "));
        let template_snippet = format!(
            "const {} = {{ h: b_1`{}`, parts: {} }};\n",
            tmpl.var_name,
            tmpl.prepared
                .prepared_html
                .replace('`', "\\`")
                .replace('$', "\\$"),
            parts_json
        );

        let parsed_tmpl = Parser::new(
            &allocator,
            allocator.alloc_str(&template_snippet),
            source_type,
        )
        .parse();
        tmpl_stmts.push((*tmpl_span, parsed_tmpl.program.body.into_iter().collect()));
    }

    // 5. Replace tagged template expressions with CompiledTemplateResult descriptors
    replace_templates_in_program(
        &mut parsed.program.body,
        &template_matches,
        source,
        &allocator,
        source_type,
    );

    // 6. Strip TypeScript types if transpiling TS
    if is_ts {
        strip_ts_in_stmts(&mut parsed.program.body);
    }

    // 7. Insert synthesized statements
    let last_import_idx = parsed
        .program
        .body
        .iter()
        .rposition(|s| matches!(s, Statement::ImportDeclaration(_)))
        .map(|idx| idx + 1)
        .unwrap_or(0);

    let mut new_body = ArenaVec::new_in(&&allocator);
    for (i, s) in parsed.program.body.into_iter().enumerate() {
        if i == last_import_idx {
            for p in header_stmts.drain(..) {
                new_body.push(p);
            }
        }
        let stmt_span = s.span();
        let mut idx = 0;
        while idx < tmpl_stmts.len() {
            if tmpl_stmts[idx].0.start >= stmt_span.start && tmpl_stmts[idx].0.end <= stmt_span.end
            {
                let (_, stmts) = tmpl_stmts.remove(idx);
                for ts in stmts {
                    new_body.push(ts);
                }
            } else {
                idx += 1;
            }
        }
        new_body.push(s);
    }
    if !header_stmts.is_empty() {
        for p in header_stmts {
            new_body.push(p);
        }
    }
    for (_, stmts) in tmpl_stmts {
        for ts in stmts {
            new_body.push(ts);
        }
    }
    parsed.program.body = new_body;

    let mut codegen_options = CodegenOptions::default();
    if options.sourcemap.unwrap_or(false) {
        if let Some(ref fname) = options.filename {
            codegen_options.source_map_path = Some(std::path::PathBuf::from(fname));
        }
    }

    let codegen_result = Codegen::new()
        .with_options(codegen_options)
        .build(&parsed.program);
    let map_json = codegen_result.map.map(|m| m.to_json_string());
    let compacted_code = compact_parts_in_code(&codegen_result.code);

    HtmlAotResult {
        code: compacted_code,
        map: map_json,
        templates_count: template_matches.len() as u32,
    }
}

#[allow(clippy::while_let_on_iterator)]
fn compact_parts_in_code(code: &str) -> String {
    let mut res = String::with_capacity(code.len());
    let mut chars = code.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == 'p' && chars.clone().take(7).collect::<String>() == "arts: [" {
            res.push_str("parts: [");
            for _ in 0..7 {
                chars.next();
            }

            let mut bracket_depth = 1;
            while let Some(c) = chars.next() {
                if c == '[' {
                    bracket_depth += 1;
                    res.push(c);
                } else if c == ']' {
                    bracket_depth -= 1;
                    res.push(c);
                    if bracket_depth == 0 {
                        break;
                    }
                } else if c == '{' {
                    let mut obj_depth = 1;
                    let mut obj_str = String::from("{");
                    while let Some(oc) = chars.next() {
                        obj_str.push(oc);
                        if oc == '{' {
                            obj_depth += 1;
                        } else if oc == '}' {
                            obj_depth -= 1;
                            if obj_depth == 0 {
                                break;
                            }
                        }
                    }
                    if obj_str.contains("//") {
                        res.push_str(&obj_str);
                        continue;
                    }
                    let mut compacted = String::new();
                    let mut prev_is_space = false;
                    for sc in obj_str.chars() {
                        if sc.is_whitespace() {
                            if !prev_is_space {
                                compacted.push(' ');
                                prev_is_space = true;
                            }
                        } else {
                            if (sc == ':' || sc == ',') && prev_is_space {
                                compacted.pop();
                            }
                            compacted.push(sc);
                            if sc == ':' || sc == ',' {
                                compacted.push(' ');
                                prev_is_space = true;
                            } else {
                                prev_is_space = false;
                            }
                        }
                    }
                    res.push_str(compacted.trim());
                } else {
                    res.push(c);
                }
            }
        } else {
            res.push(ch);
        }
    }
    res
}

fn strip_ts_in_stmts<'a>(stmts: &mut [Statement<'a>]) {
    for s in stmts {
        strip_ts_in_stmt(s);
    }
}

fn strip_ts_in_stmt<'a>(stmt: &mut Statement<'a>) {
    match stmt {
        Statement::VariableDeclaration(decl) => {
            for d in &mut decl.declarations {
                d.type_annotation = None;
                if let Some(init) = &mut d.init {
                    strip_ts_in_expr(init);
                }
            }
        }
        Statement::ExpressionStatement(s) => {
            strip_ts_in_expr(&mut s.expression);
        }
        Statement::ReturnStatement(s) => {
            if let Some(arg) = &mut s.argument {
                strip_ts_in_expr(arg);
            }
        }
        Statement::ExportDeclaration(export_decl) => match &mut export_decl.declaration {
            Declaration::VariableDeclaration(v) => {
                for d in &mut v.declarations {
                    d.type_annotation = None;
                    if let Some(init) = &mut d.init {
                        strip_ts_in_expr(init);
                    }
                }
            }
            Declaration::FunctionDeclaration(f) => {
                f.return_type = None;
                for p in &mut f.params.items {
                    p.type_annotation = None;
                }
                if let Some(b) = &mut f.body {
                    strip_ts_in_stmts(&mut b.statements);
                }
            }
            Declaration::ClassDeclaration(c) => {
                for elem in &mut c.body.body {
                    match elem {
                        ClassElement::PropertyDefinition(p) => {
                            p.type_annotation = None;
                            if let Some(init) = &mut p.value {
                                strip_ts_in_expr(init);
                            }
                        }
                        ClassElement::MethodDefinition(m) => {
                            m.value.return_type = None;
                            for p in &mut m.value.params.items {
                                p.type_annotation = None;
                            }
                            if let Some(b) = &mut m.value.body {
                                strip_ts_in_stmts(&mut b.statements);
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        },
        Statement::ExportDefaultDeclaration(export_decl) => {
            if let Some(expr) = export_decl.declaration.as_expression_mut() {
                strip_ts_in_expr(expr);
            } else if let ExportDefaultDeclarationKind::ClassDeclaration(c) =
                &mut export_decl.declaration
            {
                for elem in &mut c.body.body {
                    match elem {
                        ClassElement::PropertyDefinition(p) => {
                            p.type_annotation = None;
                            if let Some(init) = &mut p.value {
                                strip_ts_in_expr(init);
                            }
                        }
                        ClassElement::MethodDefinition(m) => {
                            m.value.return_type = None;
                            for p in &mut m.value.params.items {
                                p.type_annotation = None;
                            }
                            if let Some(b) = &mut m.value.body {
                                strip_ts_in_stmts(&mut b.statements);
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        Statement::FunctionDeclaration(f) => {
            f.return_type = None;
            for p in &mut f.params.items {
                p.type_annotation = None;
            }
            if let Some(b) = &mut f.body {
                strip_ts_in_stmts(&mut b.statements);
            }
        }
        Statement::ClassDeclaration(c) => {
            for elem in &mut c.body.body {
                match elem {
                    ClassElement::PropertyDefinition(p) => {
                        p.type_annotation = None;
                        if let Some(init) = &mut p.value {
                            strip_ts_in_expr(init);
                        }
                    }
                    ClassElement::MethodDefinition(m) => {
                        m.value.return_type = None;
                        for p in &mut m.value.params.items {
                            p.type_annotation = None;
                        }
                        if let Some(b) = &mut m.value.body {
                            strip_ts_in_stmts(&mut b.statements);
                        }
                    }
                    _ => {}
                }
            }
        }
        Statement::BlockStatement(b) => {
            strip_ts_in_stmts(&mut b.body);
        }
        Statement::IfStatement(s) => {
            strip_ts_in_expr(&mut s.test);
            strip_ts_in_stmt(&mut s.consequent);
            if let Some(alt) = &mut s.alternate {
                strip_ts_in_stmt(alt);
            }
        }
        _ => {}
    }
}

fn strip_ts_in_expr<'a>(expr: &mut Expression<'a>) {
    match expr {
        Expression::ArrowFunctionExpression(arrow) => {
            arrow.return_type = None;
            for p in &mut arrow.params.items {
                p.type_annotation = None;
            }
            match &mut arrow.body {
                ArrowFunctionBody::FunctionBody(b) => {
                    strip_ts_in_stmts(&mut b.statements);
                }
                _ => {
                    if let Some(e) = arrow.body.as_expression_mut() {
                        strip_ts_in_expr(e);
                    }
                }
            }
        }
        Expression::FunctionExpression(func) => {
            func.return_type = None;
            for p in &mut func.params.items {
                p.type_annotation = None;
            }
            if let Some(b) = &mut func.body {
                strip_ts_in_stmts(&mut b.statements);
            }
        }
        Expression::CallExpression(c) => {
            strip_ts_in_expr(&mut c.callee);
            for arg in &mut c.arguments {
                if let Some(e) = arg.as_expression_mut() {
                    strip_ts_in_expr(e);
                }
            }
        }
        Expression::ArrayExpression(a) => {
            for elem in &mut a.elements {
                if let Some(e) = elem.as_expression_mut() {
                    strip_ts_in_expr(e);
                }
            }
        }
        Expression::ObjectExpression(o) => {
            for prop in &mut o.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                    strip_ts_in_expr(&mut p.value);
                }
            }
        }
        Expression::ParenthesizedExpression(p) => {
            strip_ts_in_expr(&mut p.expression);
        }
        _ => {}
    }
}

fn walk_and_collect_templates<'a>(
    stmts: &[Statement<'a>],
    html_idents: &HashSet<String>,
    out: &mut Vec<(Span, CompiledTemplateData)>,
    counter: &mut usize,
) {
    for stmt in stmts {
        walk_stmt_for_templates(stmt, html_idents, out, counter);
    }
}

fn walk_stmt_for_templates<'a>(
    stmt: &Statement<'a>,
    html_idents: &HashSet<String>,
    out: &mut Vec<(Span, CompiledTemplateData)>,
    counter: &mut usize,
) {
    match stmt {
        Statement::ExpressionStatement(s) => {
            walk_expr_for_templates(&s.expression, html_idents, out, counter);
        }
        Statement::ReturnStatement(s) => {
            if let Some(arg) = &s.argument {
                walk_expr_for_templates(arg, html_idents, out, counter);
            }
        }
        Statement::VariableDeclaration(s) => {
            for decl in &s.declarations {
                if let Some(init) = &decl.init {
                    walk_expr_for_templates(init, html_idents, out, counter);
                }
            }
        }
        Statement::ClassDeclaration(class) => {
            for elem in &class.body.body {
                match elem {
                    ClassElement::MethodDefinition(m) => {
                        if let Some(body) = &m.value.body {
                            for s in &body.statements {
                                walk_stmt_for_templates(s, html_idents, out, counter);
                            }
                        }
                    }
                    ClassElement::PropertyDefinition(p) => {
                        if let Some(init) = &p.value {
                            walk_expr_for_templates(init, html_idents, out, counter);
                        }
                    }
                    _ => {}
                }
            }
        }
        Statement::ExportDeclaration(export_decl) => match &export_decl.declaration {
            Declaration::VariableDeclaration(v) => {
                for decl in &v.declarations {
                    if let Some(init) = &decl.init {
                        walk_expr_for_templates(init, html_idents, out, counter);
                    }
                }
            }
            Declaration::FunctionDeclaration(f) => {
                if let Some(body) = &f.body {
                    for s in &body.statements {
                        walk_stmt_for_templates(s, html_idents, out, counter);
                    }
                }
            }
            Declaration::ClassDeclaration(class) => {
                for elem in &class.body.body {
                    if let ClassElement::MethodDefinition(m) = elem {
                        if let Some(body) = &m.value.body {
                            for s in &body.statements {
                                walk_stmt_for_templates(s, html_idents, out, counter);
                            }
                        }
                    }
                }
            }
            _ => {}
        },
        Statement::ExportDefaultDeclaration(export_decl) => {
            if let Some(expr) = export_decl.declaration.as_expression() {
                walk_expr_for_templates(expr, html_idents, out, counter);
            } else if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                &export_decl.declaration
            {
                for elem in &class.body.body {
                    if let ClassElement::MethodDefinition(m) = elem {
                        if let Some(body) = &m.value.body {
                            for s in &body.statements {
                                walk_stmt_for_templates(s, html_idents, out, counter);
                            }
                        }
                    }
                }
            }
        }
        Statement::BlockStatement(b) => {
            for s in &b.body {
                walk_stmt_for_templates(s, html_idents, out, counter);
            }
        }
        Statement::IfStatement(if_stmt) => {
            walk_expr_for_templates(&if_stmt.test, html_idents, out, counter);
            walk_stmt_for_templates(&if_stmt.consequent, html_idents, out, counter);
            if let Some(alt) = &if_stmt.alternate {
                walk_stmt_for_templates(alt, html_idents, out, counter);
            }
        }
        _ => {}
    }
}

fn walk_expr_for_templates<'a>(
    expr: &Expression<'a>,
    html_idents: &HashSet<String>,
    out: &mut Vec<(Span, CompiledTemplateData)>,
    counter: &mut usize,
) {
    match expr {
        Expression::TaggedTemplateExpression(tagged) => {
            let is_html_tag = match &tagged.tag {
                Expression::Identifier(id) => html_idents.contains(id.name.as_str()),
                Expression::StaticMemberExpression(mem) => {
                    html_idents.contains(mem.property.name.as_str())
                }
                _ => false,
            };

            if is_html_tag && !contains_octal_escape(&tagged.quasi.quasis) {
                let quasis: Vec<String> = tagged
                    .quasi
                    .quasis
                    .iter()
                    .map(|q| q.value.raw.to_string())
                    .collect();

                if let Some(prepared) = parse_lit_template(&quasis) {
                    *counter += 1;
                    let var_name = format!("lit_template_{}", counter);

                    out.push((tagged.span, CompiledTemplateData { var_name, prepared }));
                }
            }

            for quasi_expr in &tagged.quasi.expressions {
                walk_expr_for_templates(quasi_expr, html_idents, out, counter);
            }
        }
        Expression::ArrowFunctionExpression(arrow) => match &arrow.body {
            ArrowFunctionBody::FunctionBody(body) => {
                for s in &body.statements {
                    walk_stmt_for_templates(s, html_idents, out, counter);
                }
            }
            _ => {
                if let Some(e) = arrow.body.as_expression() {
                    walk_expr_for_templates(e, html_idents, out, counter);
                }
            }
        },
        Expression::FunctionExpression(func) => {
            if let Some(body) = &func.body {
                for s in &body.statements {
                    walk_stmt_for_templates(s, html_idents, out, counter);
                }
            }
        }
        Expression::CallExpression(call) => {
            walk_expr_for_templates(&call.callee, html_idents, out, counter);
            for arg in &call.arguments {
                if let Some(e) = arg.as_expression() {
                    walk_expr_for_templates(e, html_idents, out, counter);
                }
            }
        }
        Expression::ArrayExpression(arr) => {
            for elem in &arr.elements {
                if let Some(e) = elem.as_expression() {
                    walk_expr_for_templates(e, html_idents, out, counter);
                }
            }
        }
        Expression::ObjectExpression(obj) => {
            for prop in &obj.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                    walk_expr_for_templates(&p.value, html_idents, out, counter);
                }
            }
        }
        Expression::ParenthesizedExpression(p) => {
            walk_expr_for_templates(&p.expression, html_idents, out, counter);
        }
        _ => {}
    }
}

fn replace_templates_in_program<'a>(
    stmts: &mut [Statement<'a>],
    template_matches: &[(Span, CompiledTemplateData)],
    source: &str,
    allocator: &'a Allocator,
    source_type: SourceType,
) {
    for stmt in stmts.iter_mut() {
        replace_in_stmt(stmt, template_matches, source, allocator, source_type);
    }
}

fn replace_in_stmt<'a>(
    stmt: &mut Statement<'a>,
    template_matches: &[(Span, CompiledTemplateData)],
    source: &str,
    allocator: &'a Allocator,
    source_type: SourceType,
) {
    match stmt {
        Statement::ExpressionStatement(s) => {
            replace_in_expr(
                &mut s.expression,
                template_matches,
                source,
                allocator,
                source_type,
            );
        }
        Statement::ReturnStatement(s) => {
            if let Some(arg) = &mut s.argument {
                replace_in_expr(arg, template_matches, source, allocator, source_type);
            }
        }
        Statement::VariableDeclaration(s) => {
            for decl in &mut s.declarations {
                if let Some(init) = &mut decl.init {
                    replace_in_expr(init, template_matches, source, allocator, source_type);
                }
            }
        }
        Statement::ClassDeclaration(class) => {
            for elem in &mut class.body.body {
                match elem {
                    ClassElement::MethodDefinition(m) => {
                        if let Some(body) = &mut m.value.body {
                            for s in &mut body.statements {
                                replace_in_stmt(
                                    s,
                                    template_matches,
                                    source,
                                    allocator,
                                    source_type,
                                );
                            }
                        }
                    }
                    ClassElement::PropertyDefinition(p) => {
                        if let Some(init) = &mut p.value {
                            replace_in_expr(init, template_matches, source, allocator, source_type);
                        }
                    }
                    _ => {}
                }
            }
        }
        Statement::ExportDeclaration(export_decl) => match &mut export_decl.declaration {
            Declaration::VariableDeclaration(v) => {
                for decl in &mut v.declarations {
                    if let Some(init) = &mut decl.init {
                        replace_in_expr(init, template_matches, source, allocator, source_type);
                    }
                }
            }
            Declaration::FunctionDeclaration(f) => {
                if let Some(body) = &mut f.body {
                    for s in &mut body.statements {
                        replace_in_stmt(s, template_matches, source, allocator, source_type);
                    }
                }
            }
            Declaration::ClassDeclaration(class) => {
                for elem in &mut class.body.body {
                    if let ClassElement::MethodDefinition(m) = elem {
                        if let Some(body) = &mut m.value.body {
                            for s in &mut body.statements {
                                replace_in_stmt(
                                    s,
                                    template_matches,
                                    source,
                                    allocator,
                                    source_type,
                                );
                            }
                        }
                    }
                }
            }
            _ => {}
        },
        Statement::ExportDefaultDeclaration(export_decl) => {
            if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                &mut export_decl.declaration
            {
                for elem in &mut class.body.body {
                    if let ClassElement::MethodDefinition(m) = elem {
                        if let Some(body) = &mut m.value.body {
                            for s in &mut body.statements {
                                replace_in_stmt(
                                    s,
                                    template_matches,
                                    source,
                                    allocator,
                                    source_type,
                                );
                            }
                        }
                    }
                }
            } else if let Some(expr) = export_decl.declaration.as_expression_mut() {
                replace_in_expr(expr, template_matches, source, allocator, source_type);
            }
        }
        Statement::BlockStatement(b) => {
            for s in &mut b.body {
                replace_in_stmt(s, template_matches, source, allocator, source_type);
            }
        }
        Statement::IfStatement(if_stmt) => {
            replace_in_expr(
                &mut if_stmt.test,
                template_matches,
                source,
                allocator,
                source_type,
            );
            replace_in_stmt(
                &mut if_stmt.consequent,
                template_matches,
                source,
                allocator,
                source_type,
            );
            if let Some(alt) = &mut if_stmt.alternate {
                replace_in_stmt(alt, template_matches, source, allocator, source_type);
            }
        }
        _ => {}
    }
}

fn replace_in_expr<'a>(
    expr: &mut Expression<'a>,
    template_matches: &[(Span, CompiledTemplateData)],
    source: &str,
    allocator: &'a Allocator,
    source_type: SourceType,
) {
    let span = expr.span();
    for (tmpl_span, tmpl_data) in template_matches {
        if span.start == tmpl_span.start && span.end == tmpl_span.end {
            // Found target tagged template! Construct replacement using AstBuilder
            let ast = AstBuilder::new(allocator);
            let mut properties = ArenaVec::new_in(&ast);

            let key1 = PropertyKey::new_string_literal(SPAN, "_$litType$", None, &ast);
            let val1 =
                Expression::new_identifier(SPAN, allocator.alloc_str(&tmpl_data.var_name), &ast);
            properties.push(ObjectPropertyKind::new_object_property(
                SPAN,
                PropertyKind::Init,
                key1,
                val1,
                false,
                false,
                true,
                &ast,
            ));

            let mut elements = ArenaVec::new_in(&ast);
            if let Expression::TaggedTemplateExpression(ref mut tagged) = expr {
                for e in tagged.quasi.expressions.drain(..) {
                    elements.push(ArrayExpressionElement::from(e));
                }
            }
            let key2 = PropertyKey::new_static_identifier(SPAN, "values", &ast);
            let val2 = Expression::new_array_expression(SPAN, elements, &ast);
            properties.push(ObjectPropertyKind::new_object_property(
                SPAN,
                PropertyKind::Init,
                key2,
                val2,
                false,
                false,
                false,
                &ast,
            ));

            *expr = Expression::new_object_expression(SPAN, properties, &ast);
            return;
        }
    }

    match expr {
        Expression::TaggedTemplateExpression(tagged) => {
            for quasi_expr in &mut tagged.quasi.expressions {
                replace_in_expr(quasi_expr, template_matches, source, allocator, source_type);
            }
        }
        Expression::ArrowFunctionExpression(arrow) => match &mut arrow.body {
            ArrowFunctionBody::FunctionBody(body) => {
                for s in &mut body.statements {
                    replace_in_stmt(s, template_matches, source, allocator, source_type);
                }
            }
            _ => {
                if let Some(e) = arrow.body.as_expression_mut() {
                    replace_in_expr(e, template_matches, source, allocator, source_type);
                }
            }
        },
        Expression::FunctionExpression(func) => {
            if let Some(body) = &mut func.body {
                for s in &mut body.statements {
                    replace_in_stmt(s, template_matches, source, allocator, source_type);
                }
            }
        }
        Expression::CallExpression(call) => {
            replace_in_expr(
                &mut call.callee,
                template_matches,
                source,
                allocator,
                source_type,
            );
            for arg in &mut call.arguments {
                if let Some(e) = arg.as_expression_mut() {
                    replace_in_expr(e, template_matches, source, allocator, source_type);
                }
            }
        }
        Expression::ArrayExpression(arr) => {
            for elem in &mut arr.elements {
                if let Some(e) = elem.as_expression_mut() {
                    replace_in_expr(e, template_matches, source, allocator, source_type);
                }
            }
        }
        Expression::ObjectExpression(obj) => {
            for prop in &mut obj.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                    replace_in_expr(
                        &mut p.value,
                        template_matches,
                        source,
                        allocator,
                        source_type,
                    );
                }
            }
        }
        Expression::ParenthesizedExpression(p) => {
            replace_in_expr(
                &mut p.expression,
                template_matches,
                source,
                allocator,
                source_type,
            );
        }
        _ => {}
    }
}
