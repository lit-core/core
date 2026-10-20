use lit_analysis::symbol::{CanonicalLitSymbol, SymbolProofContext};
use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder, SymbolId};
use oxc_span::{SourceType, SPAN};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct TransformSsrOptions {
    pub filename: Option<String>,
    pub sourcemap: Option<bool>,
    pub ssr_mode: Option<bool>,
    pub islands: Option<bool>,
    pub islands_include: Option<Vec<String>>,
    pub islands_exclude: Option<Vec<String>>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransformSsrResult {
    pub code: String,
    pub map: Option<String>,
    pub modified: bool,
    pub discovered_tags: Vec<String>,
    pub syntax_error: Option<String>,
}

struct SsrAnalysis<'a> {
    symbol_ctx: SymbolProofContext<'a>,
    class_to_tag: HashMap<String, String>,
    discovered_tags: Vec<String>,
    custom_element_symbols: HashSet<SymbolId>,
}

fn get_class_id_symbol(class: &Class<'_>, scoping: &Scoping) -> Option<SymbolId> {
    class.id.as_ref().and_then(|id| {
        id.symbol_id
            .get()
            .or_else(|| scoping.get_binding(scoping.root_scope_id(), id.name.as_str().into()))
    })
}

fn resolve_super_symbol(expr: &Expression<'_>, scoping: &Scoping) -> Option<SymbolId> {
    match expr.without_parentheses() {
        Expression::Identifier(ident) => ident
            .reference_id
            .get()
            .and_then(|r| scoping.get_reference(r).symbol_id()),
        Expression::CallExpression(call) => call.arguments.iter().find_map(|arg| {
            arg.as_expression()
                .and_then(|e| resolve_super_symbol(e, scoping))
        }),
        _ => None,
    }
}

fn extends_unshadowed_html_element(expr: &Expression<'_>, ctx: &SymbolProofContext<'_>) -> bool {
    match expr.without_parentheses() {
        Expression::Identifier(id) => id.name == "HTMLElement" && ctx.is_unresolved_global(id),
        Expression::CallExpression(call) => call
            .arguments
            .iter()
            .filter_map(|arg| arg.as_expression())
            .any(|arg| extends_unshadowed_html_element(arg, ctx)),
        _ => false,
    }
}

fn get_tag_from_decorators(
    class: &Class<'_>,
    symbol_ctx: &SymbolProofContext<'_>,
) -> Option<String> {
    for dec in &class.decorators {
        if let Expression::CallExpression(call) = &dec.expression {
            if symbol_ctx.is_proven_decorator(&call.callee)
                == Some(CanonicalLitSymbol::CustomElementDecorator)
            {
                if let Some(first_arg) = call.arguments.first().and_then(|a| a.as_expression()) {
                    match first_arg.without_parentheses() {
                        Expression::StringLiteral(str_lit) => {
                            return Some(str_lit.value.as_str().to_string());
                        }
                        Expression::TemplateLiteral(tpl)
                            if tpl.expressions.is_empty() && !tpl.quasis.is_empty() =>
                        {
                            return Some(tpl.quasis[0].value.raw.to_string());
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    None
}

fn scan_statement_registrations<'a>(
    stmt: &'a Statement<'a>,
    symbol_ctx: &SymbolProofContext<'_>,
    class_to_tag: &mut HashMap<String, String>,
    discovered_tags: &mut Vec<String>,
) {
    match stmt {
        Statement::ExpressionStatement(expr_stmt) => {
            scan_expression_registrations(
                &expr_stmt.expression,
                symbol_ctx,
                class_to_tag,
                discovered_tags,
            );
        }
        Statement::BlockStatement(block) => {
            for s in &block.body {
                scan_statement_registrations(s, symbol_ctx, class_to_tag, discovered_tags);
            }
        }
        Statement::IfStatement(if_stmt) => {
            scan_statement_registrations(
                &if_stmt.consequent,
                symbol_ctx,
                class_to_tag,
                discovered_tags,
            );
            if let Some(ref alt) = if_stmt.alternate {
                scan_statement_registrations(alt, symbol_ctx, class_to_tag, discovered_tags);
            }
        }
        _ => {}
    }
}

fn scan_expression_registrations<'a>(
    expr: &'a Expression<'a>,
    symbol_ctx: &SymbolProofContext<'_>,
    class_to_tag: &mut HashMap<String, String>,
    discovered_tags: &mut Vec<String>,
) {
    if let Expression::CallExpression(call) = expr {
        if let Some(reg) = symbol_ctx.is_custom_elements_define(call) {
            if let Some(tag) = reg.tag {
                if !discovered_tags.contains(&tag) {
                    discovered_tags.push(tag.clone());
                }
                if let Expression::Identifier(class_id) = reg.class_expr.without_parentheses() {
                    class_to_tag.insert(class_id.name.as_str().to_string(), tag);
                }
            }
        }
    }
}

fn for_each_class_in_stmt<'a, F>(stmt: &'a Statement<'a>, mut callback: F)
where
    F: FnMut(&'a Class<'a>),
{
    match stmt {
        Statement::ClassDeclaration(c) => callback(c.as_ref()),
        Statement::ExportDeclaration(e) => {
            if let Declaration::ClassDeclaration(c) = &e.declaration {
                callback(c.as_ref());
            }
        }
        Statement::ExportDefaultDeclaration(e) => {
            if let ExportDefaultDeclarationKind::ClassDeclaration(c) = &e.declaration {
                callback(c.as_ref());
            }
        }
        Statement::VariableDeclaration(v) => {
            for decl in &v.declarations {
                if let Some(Expression::ClassExpression(c)) = &decl.init {
                    callback(c.as_ref());
                }
            }
        }
        _ => {}
    }
}

fn build_ssr_analysis<'a, 'p>(
    program: &'p Program<'p>,
    scoping: &'a Scoping,
    source: &'a str,
) -> SsrAnalysis<'a> {
    let (lit_symbols, helper_symbols, imported_classes, local_classes, has_lit_imports) = {
        let temp_ctx = SymbolProofContext::scan(program, scoping, source);
        (
            temp_ctx.lit_symbols,
            temp_ctx.helper_symbols,
            temp_ctx.imported_classes,
            temp_ctx.local_classes,
            temp_ctx.has_lit_imports,
        )
    };
    let symbol_ctx = SymbolProofContext {
        scoping,
        source_text: source,
        lit_symbols,
        helper_symbols,
        imported_classes,
        local_classes,
        has_lit_imports,
    };

    let mut class_to_tag = HashMap::new();
    let mut discovered_tags = Vec::new();
    let mut custom_element_symbols = HashSet::new();

    for stmt in &program.body {
        scan_statement_registrations(stmt, &symbol_ctx, &mut class_to_tag, &mut discovered_tags);
    }

    // Direct element discovery
    for stmt in &program.body {
        for_each_class_in_stmt(stmt, |class| {
            let tag = get_tag_from_decorators(class, &symbol_ctx).or_else(|| {
                class
                    .id
                    .as_ref()
                    .and_then(|id| class_to_tag.get(id.name.as_str()).cloned())
            });
            if let Some(t) = &tag {
                if !discovered_tags.contains(t) {
                    discovered_tags.push(t.clone());
                }
            }
            let is_ce = tag.is_some()
                || symbol_ctx.prove_heritage(class).is_reactive()
                || class
                    .heritage
                    .as_ref()
                    .is_some_and(|h| extends_unshadowed_html_element(&h.expression, &symbol_ctx));
            if is_ce {
                if let Some(sym) = get_class_id_symbol(class, scoping) {
                    custom_element_symbols.insert(sym);
                }
            }
        });
    }

    // Subclass propagation via SymbolId
    for _ in 0..2 {
        for stmt in &program.body {
            for_each_class_in_stmt(stmt, |class| {
                if let Some(heritage) = &class.heritage {
                    if let Some(super_sym) = resolve_super_symbol(&heritage.expression, scoping) {
                        if custom_element_symbols.contains(&super_sym) {
                            if let Some(sym) = get_class_id_symbol(class, scoping) {
                                custom_element_symbols.insert(sym);
                            }
                        }
                    }
                }
            });
        }
    }

    SsrAnalysis {
        symbol_ctx,
        class_to_tag,
        discovered_tags,
        custom_element_symbols,
    }
}

fn is_custom_element_class(
    class: &Class<'_>,
    symbol_ctx: &SymbolProofContext<'_>,
    custom_element_symbols: &HashSet<SymbolId>,
    tag: Option<&str>,
) -> bool {
    if tag.is_some() {
        return true;
    }
    if let Some(sym) = get_class_id_symbol(class, symbol_ctx.scoping) {
        if custom_element_symbols.contains(&sym) {
            return true;
        }
    }
    if symbol_ctx.prove_heritage(class).is_reactive() {
        return true;
    }
    if let Some(heritage) = &class.heritage {
        if extends_unshadowed_html_element(&heritage.expression, symbol_ctx) {
            return true;
        }
        if let Some(super_sym) = resolve_super_symbol(&heritage.expression, symbol_ctx.scoping) {
            if custom_element_symbols.contains(&super_sym) {
                return true;
            }
        }
    }
    false
}

fn matches_island_criteria(
    tag: Option<&str>,
    is_custom_element: bool,
    is_all_islands: bool,
    include_patterns: &Option<Vec<String>>,
    exclude_patterns: &Option<Vec<String>>,
) -> bool {
    if let (Some(excludes), Some(t)) = (exclude_patterns, tag) {
        if excludes.iter().any(|p| t == p || t.contains(p.as_str())) {
            return false;
        }
    }
    if is_all_islands {
        return is_custom_element;
    }
    if let (Some(includes), Some(t)) = (include_patterns, tag) {
        return includes.iter().any(|p| t == p || t.contains(p.as_str()));
    }
    false
}

fn has_existing_island_prop(class: &Class<'_>) -> bool {
    for member in &class.body.body {
        if let ClassElement::PropertyDefinition(prop) = member {
            if prop.r#static && prop.key.is_specific_static_name("__isIsland") {
                return true;
            }
        }
    }
    false
}

fn is_super_connected_callback_stmt(stmt: &Statement<'_>) -> bool {
    if let Statement::ExpressionStatement(expr_stmt) = stmt {
        if let Expression::CallExpression(call) = &expr_stmt.expression {
            if let Expression::StaticMemberExpression(mem) = &call.callee {
                if matches!(mem.object, Expression::Super(_))
                    && mem.property.name == "connectedCallback"
                {
                    return true;
                }
            }
        }
    }
    false
}

fn transform_class<'a>(
    class: &mut Class<'a>,
    analysis: &mut SsrAnalysis<'_>,
    options: &TransformSsrOptions,
    ast: &AstBuilder<'a>,
) -> bool {
    let mut modified = false;
    let mut tag = get_tag_from_decorators(class, &analysis.symbol_ctx);
    if tag.is_none() {
        if let Some(ref id) = class.id {
            tag = analysis.class_to_tag.get(id.name.as_str()).cloned();
        }
    }

    if let Some(ref t) = tag {
        if !analysis.discovered_tags.contains(t) {
            analysis.discovered_tags.push(t.clone());
        }
    }

    let is_custom_element = is_custom_element_class(
        class,
        &analysis.symbol_ctx,
        &analysis.custom_element_symbols,
        tag.as_deref(),
    );

    // 1. In SSR mode, strip browser-only firstUpdated and non-super connectedCallback bodies
    if options.ssr_mode.unwrap_or(false) && is_custom_element {
        for element in &mut class.body.body {
            if let ClassElement::MethodDefinition(method_def) = element {
                if !method_def.r#static && method_def.kind == MethodDefinitionKind::Method {
                    if method_def.key.is_specific_static_name("firstUpdated") {
                        if let Some(ref mut body) = method_def.value.body {
                            if !body.statements.is_empty() {
                                body.statements.clear();
                                modified = true;
                            }
                        }
                    } else if method_def.key.is_specific_static_name("connectedCallback") {
                        if let Some(ref mut body) = method_def.value.body {
                            let orig_len = body.statements.len();
                            body.statements.retain(is_super_connected_callback_stmt);
                            if body.statements.len() != orig_len {
                                modified = true;
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Tag island classes when islands option is active
    if options.islands.unwrap_or(false) {
        let is_all_islands = options.islands_include.is_none() && options.islands_exclude.is_none();
        let should_tag = matches_island_criteria(
            tag.as_deref(),
            is_custom_element,
            is_all_islands,
            &options.islands_include,
            &options.islands_exclude,
        );

        if should_tag && !has_existing_island_prop(class) {
            let prop_key = PropertyKey::new_static_identifier(SPAN, "__isIsland", ast);
            let true_expr = Expression::new_boolean_literal(SPAN, true, ast);
            let island_prop = ClassElement::new_property_definition(
                SPAN,
                PropertyDefinitionType::PropertyDefinition,
                ArenaVec::new_in(ast),
                prop_key,
                None,
                Some(true_expr),
                false,
                true,
                false,
                false,
                false,
                false,
                false,
                None,
                ast,
            );
            class.body.body.insert(0, island_prop);
            modified = true;
        }
    }

    modified
}

#[napi]
pub fn transform_ssr_component(
    source: String,
    options: Option<TransformSsrOptions>,
) -> TransformSsrResult {
    let opts = options.unwrap_or_default();
    let filename = opts.filename.as_deref().unwrap_or("component.ts");
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &source, source_type).parse();

    if !parsed.diagnostics.is_empty() {
        let first_msg = parsed.diagnostics[0].message.to_string();
        return TransformSsrResult {
            code: source,
            map: None,
            modified: false,
            discovered_tags: Vec::new(),
            syntax_error: Some(first_msg),
        };
    }

    let scoping = SemanticBuilder::new()
        .build(&parsed.program)
        .semantic
        .into_scoping();
    let mut analysis = build_ssr_analysis(&parsed.program, &scoping, &source);
    let mut program = parsed.program;
    let ast = AstBuilder::new(&allocator);
    let mut modified = false;

    for stmt in &mut program.body {
        match stmt {
            Statement::ClassDeclaration(class) => {
                if transform_class(class, &mut analysis, &opts, &ast) {
                    modified = true;
                }
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &mut export_decl.declaration {
                    if transform_class(class, &mut analysis, &opts, &ast) {
                        modified = true;
                    }
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &mut export_decl.declaration
                {
                    if transform_class(class, &mut analysis, &opts, &ast) {
                        modified = true;
                    }
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &mut var_decl.declarations {
                    if let Some(Expression::ClassExpression(class)) = &mut decl.init {
                        if transform_class(class, &mut analysis, &opts, &ast) {
                            modified = true;
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let discovered_tags = analysis.discovered_tags;
    drop(analysis.symbol_ctx);

    if !modified {
        return TransformSsrResult {
            code: source,
            map: None,
            modified: false,
            discovered_tags,
            syntax_error: None,
        };
    }

    let mut codegen_options = CodegenOptions::default();
    if opts.sourcemap.unwrap_or(false) {
        codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
    }

    let codegen_result = Codegen::new().with_options(codegen_options).build(&program);

    let map = codegen_result.map.map(|m| m.to_json_string());
    let code = codegen_result.code.replace(
        "{\n\tstatic __isIsland = true;",
        "{\n  static __isIsland = true;",
    );

    TransformSsrResult {
        code,
        map,
        modified: true,
        discovered_tags,
        syntax_error: None,
    }
}
