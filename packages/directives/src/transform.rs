use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec, Box as ArenaBox, CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::walk_mut::walk_expression;
use oxc_ast_visit::VisitMut;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{SourceType, SPAN};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::ast_helpers::AstHelper;
use crate::import_scanner::{extract_directive_slug, DirectiveKind, ImportContext};

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectivesOptions {
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectivesResult {
    pub code: String,
    pub map: Option<String>,
    pub lowered_count: u32,
    pub directives_used: Vec<String>,
}

fn camel_to_kebab(s: &str) -> String {
    if s.starts_with("--") {
        return s.to_string();
    }
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_uppercase() {
            out.push('-');
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

fn extract_arrow_expr<'a>(arrow: &'a ArrowFunctionExpression<'a>) -> Option<&'a Expression<'a>> {
    if !arrow.params.items.is_empty() {
        return None;
    }
    if let Some(expr) = arrow.body.as_expression() {
        return Some(expr);
    }
    if let ArrowFunctionBody::FunctionBody(b) = &arrow.body {
        if let Some(first_stmt) = b.statements.first() {
            match first_stmt {
                Statement::ExpressionStatement(e) => return Some(&e.expression),
                Statement::ReturnStatement(r) => return r.argument.as_ref(),
                _ => {}
            }
        }
    }
    None
}

pub fn transform_code(source: &str, options: DirectivesOptions) -> DirectivesResult {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(options.filename.as_deref().unwrap_or("file.ts"))
        .unwrap_or_else(|_| SourceType::ts());

    let parsed = Parser::new(&allocator, source, source_type).parse();

    if !parsed.diagnostics.is_empty() {
        return DirectivesResult {
            code: source.to_string(),
            map: None,
            lowered_count: 0,
            directives_used: vec![],
        };
    }

    let mut program = parsed.program;

    // Scan for Lit directive imports
    let import_ctx = ImportContext::scan(&program);
    if !import_ctx.has_directives() {
        return DirectivesResult {
            code: source.to_string(),
            map: None,
            lowered_count: 0,
            directives_used: vec![],
        };
    }

    let ast = AstBuilder::new(&allocator);
    let mut lowerer = DirectiveLowerer::new(&ast, &import_ctx);

    // Transform full AST program via VisitMut
    lowerer.visit_program(&mut program);

    if lowerer.lowered_count == 0 {
        return DirectivesResult {
            code: source.to_string(),
            map: None,
            lowered_count: 0,
            directives_used: vec![],
        };
    }

    // Clean up transformed directive imports and inject `nothing` if needed
    prune_and_update_imports(&mut program, &lowerer, &ast);

    let codegen_options = CodegenOptions {
        source_map_path: if options.sourcemap.unwrap_or(false) {
            options.filename.map(std::path::PathBuf::from)
        } else {
            None
        },
        ..CodegenOptions::default()
    };

    let result = Codegen::new().with_options(codegen_options).build(&program);

    let directives_list: Vec<String> = lowerer.directives_used.into_iter().collect();

    DirectivesResult {
        code: result.code,
        map: result.map.map(|sm| sm.to_json_string()),
        lowered_count: lowerer.lowered_count,
        directives_used: directives_list,
    }
}

pub struct DirectiveLowerer<'a, 'b> {
    pub ast: &'b AstBuilder<'a>,
    pub helper: AstHelper<'a, 'b>,
    pub import_ctx: &'b ImportContext,
    pub used_nothing: bool,
    pub lowered_count: u32,
    pub directives_used: HashSet<String>,
}

impl<'a, 'b> DirectiveLowerer<'a, 'b> {
    pub fn new(ast: &'b AstBuilder<'a>, import_ctx: &'b ImportContext) -> Self {
        Self {
            ast,
            helper: AstHelper::new(ast),
            import_ctx,
            used_nothing: false,
            lowered_count: 0,
            directives_used: HashSet::new(),
        }
    }

    fn lower_call(
        &mut self,
        kind: DirectiveKind,
        call: &CallExpression<'a>,
    ) -> Option<Expression<'a>> {
        match kind {
            DirectiveKind::ClassMap => self.lower_class_map(call),
            DirectiveKind::StyleMap => self.lower_style_map(call),
            DirectiveKind::IfDefined => self.lower_if_defined(call),
            DirectiveKind::When => self.lower_when(call),
            DirectiveKind::Choose => self.lower_choose(call),
            DirectiveKind::Map => self.lower_map(call),
            DirectiveKind::Join => self.lower_join(call),
            DirectiveKind::Range => self.lower_range(call),
            DirectiveKind::Guard => self.lower_guard(call),
            DirectiveKind::Live => self.lower_live(call),
            DirectiveKind::Keyed => self.lower_keyed(call),
            DirectiveKind::Cache => self.lower_cache(call),
            DirectiveKind::Repeat => self.lower_repeat(call),
            DirectiveKind::TemplateContent => self.lower_template_content(call),
            DirectiveKind::UnsafeHTML => self.lower_unsafe_html(call),
            DirectiveKind::UnsafeSVG => self.lower_unsafe_svg(call),
            DirectiveKind::UnsafeMathML => self.lower_unsafe_mathml(call),
            DirectiveKind::Until => self.lower_until(call),
            DirectiveKind::AsyncAppend => self.lower_async_append(call),
            DirectiveKind::AsyncReplace => self.lower_async_replace(call),
            DirectiveKind::Ref => self.lower_ref(call),
        }
    }

    fn lower_class_map(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;

        if let Expression::ObjectExpression(obj) = first_arg {
            let mut unconditional_classes = Vec::new();
            let mut conditional_classes = Vec::new();

            for p in &obj.properties {
                if let ObjectPropertyKind::ObjectProperty(prop) = p {
                    let key_str = match &prop.key {
                        PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
                        PropertyKey::StringLiteral(s) => Some(s.value.as_str()),
                        PropertyKey::TemplateLiteral(t) => {
                            if t.is_no_substitution_template() {
                                t.quasis.first().map(|q| q.value.raw.as_str())
                            } else {
                                None
                            }
                        }
                        _ => None,
                    };

                    match &prop.value {
                        Expression::BooleanLiteral(b) if b.value => {
                            if let Some(k) = key_str {
                                unconditional_classes.push(k);
                            } else if let Some(key_expr) = prop.key.as_expression() {
                                let key_cloned = key_expr.clone_in(self.ast.allocator());
                                conditional_classes.push((self.helper.bool_lit(true), key_cloned));
                            }
                        }
                        Expression::BooleanLiteral(b) if !b.value => {
                            // Ignored (always false)
                        }
                        _ => {
                            let cond_cloned = prop.value.clone_in(self.ast.allocator());
                            if let Some(k) = key_str {
                                let name_lit =
                                    self.helper.string_lit(self.ast.allocator().alloc_str(k));
                                conditional_classes.push((cond_cloned, name_lit));
                            } else if let Some(key_expr) = prop.key.as_expression() {
                                let key_cloned = key_expr.clone_in(self.ast.allocator());
                                conditional_classes.push((cond_cloned, key_cloned));
                            }
                        }
                    }
                }
            }

            if unconditional_classes.is_empty() && conditional_classes.is_empty() {
                return Some(self.helper.string_lit(""));
            }

            let mut acc: Option<Expression<'a>> = None;

            if !unconditional_classes.is_empty() {
                let joined = unconditional_classes.join(" ");
                let base_lit = self.ast.allocator().alloc_str(&joined);
                acc = Some(self.helper.string_lit(base_lit));
            }

            for (cond, key_expr) in conditional_classes {
                if let Expression::BooleanLiteral(b) = &cond {
                    if b.value {
                        if let Some(cur_acc) = acc {
                            let spaced_key = if let Expression::StringLiteral(s) = &key_expr {
                                let space_str = format!(" {}", s.value);
                                let space_lit = self.ast.allocator().alloc_str(&space_str);
                                self.helper.string_lit(space_lit)
                            } else {
                                let space_lit = self.helper.string_lit(" ");
                                self.helper.binary_plus(space_lit, key_expr)
                            };
                            acc = Some(self.helper.binary_plus(cur_acc, spaced_key));
                        } else {
                            acc = Some(key_expr);
                        }
                        continue;
                    }
                }

                if let Some(cur_acc) = acc {
                    let spaced_key = if let Expression::StringLiteral(s) = &key_expr {
                        let space_str = format!(" {}", s.value);
                        let space_lit = self.ast.allocator().alloc_str(&space_str);
                        self.helper.string_lit(space_lit)
                    } else {
                        let space_lit = self.helper.string_lit(" ");
                        self.helper.binary_plus(space_lit, key_expr)
                    };
                    let empty_lit = self.helper.string_lit("");
                    let cond_expr = self.helper.conditional_expr(cond, spaced_key, empty_lit);
                    acc = Some(self.helper.binary_plus(cur_acc, cond_expr));
                } else {
                    let empty_lit = self.helper.string_lit("");
                    acc = Some(self.helper.conditional_expr(cond, key_expr, empty_lit));
                }
            }

            return acc.or_else(|| Some(self.helper.string_lit("")));
        }

        // Dynamic fallback: Object.entries(arg).filter(Boolean).map(String).join(' ')
        let obj_ident = self.helper.ident_ref("Object");
        let entries_member = self.helper.static_member(obj_ident, "entries", false);
        let mut entries_args = ArenaVec::new_in(self.ast);
        entries_args.push(Argument::from(first_arg.clone_in(self.ast.allocator())));
        let entries_call = self.helper.call_expr(entries_member, entries_args, false);

        let filter_member = self.helper.static_member(entries_call, "filter", false);
        let mut filter_args = ArenaVec::new_in(self.ast);
        filter_args.push(Argument::from(self.helper.ident_ref("Boolean")));
        let filtered = self.helper.call_expr(filter_member, filter_args, false);

        let map_member = self.helper.static_member(filtered, "map", false);
        let mut map_args = ArenaVec::new_in(self.ast);
        map_args.push(Argument::from(self.helper.ident_ref("String")));
        let mapped = self.helper.call_expr(map_member, map_args, false);

        let join_member = self.helper.static_member(mapped, "join", false);
        let mut join_args = ArenaVec::new_in(self.ast);
        join_args.push(Argument::from(self.helper.string_lit(" ")));
        Some(self.helper.call_expr(join_member, join_args, false))
    }

    fn lower_style_map(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;

        if let Expression::ObjectExpression(obj) = first_arg {
            let mut parts = Vec::new();

            for p in &obj.properties {
                if let ObjectPropertyKind::ObjectProperty(prop) = p {
                    let prop_name = match &prop.key {
                        PropertyKey::StaticIdentifier(id) => camel_to_kebab(id.name.as_str()),
                        PropertyKey::StringLiteral(s) => s.value.as_str().to_string(),
                        PropertyKey::TemplateLiteral(t) => {
                            if t.is_no_substitution_template() {
                                if let Some(q) = t.quasis.first() {
                                    q.value.raw.as_str().to_string()
                                } else {
                                    continue;
                                }
                            } else {
                                continue;
                            }
                        }
                        _ => continue,
                    };

                    match &prop.value {
                        Expression::StringLiteral(s) => {
                            let style_str = format!("{}: {};", prop_name, s.value);
                            let style_lit = self.ast.allocator().alloc_str(&style_str);
                            parts.push(self.helper.string_lit(style_lit));
                        }
                        Expression::NumericLiteral(num) => {
                            let style_str = format!("{}: {};", prop_name, num.value);
                            let style_lit = self.ast.allocator().alloc_str(&style_str);
                            parts.push(self.helper.string_lit(style_lit));
                        }
                        _ => {
                            let val_cloned = prop.value.clone_in(self.ast.allocator());
                            let val_for_plus = prop.value.clone_in(self.ast.allocator());

                            let null_check = Expression::new_binary_expression(
                                SPAN,
                                val_cloned,
                                BinaryOperator::Inequality,
                                self.helper.null_lit(),
                                self.ast,
                            );

                            let prefix = format!("{}: ", prop_name);
                            let prefix_lit = self.ast.allocator().alloc_str(&prefix);
                            let prefix_expr = self.helper.string_lit(prefix_lit);
                            let with_val = self.helper.binary_plus(prefix_expr, val_for_plus);
                            let consequent = self
                                .helper
                                .binary_plus(with_val, self.helper.string_lit(";"));
                            let alternate = self.helper.string_lit("");

                            let cond = self
                                .helper
                                .conditional_expr(null_check, consequent, alternate);
                            parts.push(cond);
                        }
                    }
                }
            }

            if parts.is_empty() {
                return Some(self.helper.string_lit(""));
            }

            let mut acc = parts.remove(0);
            for p in parts {
                acc = self.helper.binary_plus(acc, p);
            }
            return Some(acc);
        }

        None
    }

    fn lower_if_defined(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;
        self.used_nothing = true;
        let cloned_arg = first_arg.clone_in(self.ast.allocator());
        let nothing_ref = self.helper.ident_ref("nothing");
        Some(self.helper.coalesce_expr(cloned_arg, nothing_ref))
    }

    fn lower_when(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let cond_arg = call.arguments.first()?.as_expression()?;
        let true_arg = call.arguments.get(1)?.as_expression()?;
        let false_arg = call.arguments.get(2).and_then(|a| a.as_expression());

        let cond = cond_arg.clone_in(self.ast.allocator());

        let true_expr = if let Expression::ArrowFunctionExpression(arrow) = true_arg {
            if let Some(concise) = extract_arrow_expr(arrow) {
                concise.clone_in(self.ast.allocator())
            } else {
                let mut args = ArenaVec::new_in(self.ast);
                args.push(Argument::from(cond_arg.clone_in(self.ast.allocator())));
                self.helper
                    .call_expr(true_arg.clone_in(self.ast.allocator()), args, false)
            }
        } else {
            let mut args = ArenaVec::new_in(self.ast);
            args.push(Argument::from(cond_arg.clone_in(self.ast.allocator())));
            self.helper
                .call_expr(true_arg.clone_in(self.ast.allocator()), args, false)
        };

        let false_expr = if let Some(f_arg) = false_arg {
            if let Expression::ArrowFunctionExpression(arrow) = f_arg {
                if let Some(concise) = extract_arrow_expr(arrow) {
                    concise.clone_in(self.ast.allocator())
                } else {
                    let mut args = ArenaVec::new_in(self.ast);
                    args.push(Argument::from(cond_arg.clone_in(self.ast.allocator())));
                    self.helper
                        .call_expr(f_arg.clone_in(self.ast.allocator()), args, false)
                }
            } else {
                let mut args = ArenaVec::new_in(self.ast);
                args.push(Argument::from(cond_arg.clone_in(self.ast.allocator())));
                self.helper
                    .call_expr(f_arg.clone_in(self.ast.allocator()), args, false)
            }
        } else {
            self.helper.ident_ref("undefined")
        };

        Some(self.helper.conditional_expr(cond, true_expr, false_expr))
    }

    fn lower_choose(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let val_arg = call.arguments.first()?.as_expression()?;
        let cases_arg = call.arguments.get(1)?.as_expression()?;
        let def_arg = call.arguments.get(2).and_then(|a| a.as_expression());

        if let Expression::ArrayExpression(arr) = cases_arg {
            let mut default_expr = if let Some(def) = def_arg {
                if let Expression::ArrowFunctionExpression(arrow) = def {
                    if let Some(concise) = extract_arrow_expr(arrow) {
                        concise.clone_in(self.ast.allocator())
                    } else {
                        self.helper.call_expr(
                            def.clone_in(self.ast.allocator()),
                            ArenaVec::new_in(self.ast),
                            false,
                        )
                    }
                } else {
                    self.helper.call_expr(
                        def.clone_in(self.ast.allocator()),
                        ArenaVec::new_in(self.ast),
                        false,
                    )
                }
            } else {
                self.helper.ident_ref("undefined")
            };

            // Build chained ternaries from right to left
            for el in arr.elements.iter().rev() {
                if let Some(Expression::ArrayExpression(case_pair)) = el.as_expression() {
                    let case_val = case_pair.elements.first()?.as_expression()?;
                    let case_fn = case_pair.elements.get(1)?.as_expression()?;

                    let case_result = if let Expression::ArrowFunctionExpression(arrow) = case_fn {
                        if let Some(concise) = extract_arrow_expr(arrow) {
                            concise.clone_in(self.ast.allocator())
                        } else {
                            self.helper.call_expr(
                                case_fn.clone_in(self.ast.allocator()),
                                ArenaVec::new_in(self.ast),
                                false,
                            )
                        }
                    } else {
                        self.helper.call_expr(
                            case_fn.clone_in(self.ast.allocator()),
                            ArenaVec::new_in(self.ast),
                            false,
                        )
                    };

                    let test = self.helper.binary_eq(
                        val_arg.clone_in(self.ast.allocator()),
                        case_val.clone_in(self.ast.allocator()),
                    );

                    default_expr = self
                        .helper
                        .conditional_expr(test, case_result, default_expr);
                }
            }

            return Some(default_expr);
        }

        None
    }

    fn lower_map(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let items_arg = call.arguments.first()?.as_expression()?;
        let fn_arg = call.arguments.get(1)?.as_expression()?;

        let items_test = items_arg.clone_in(self.ast.allocator());
        let items_for_from = items_arg.clone_in(self.ast.allocator());
        let fn_cloned = fn_arg.clone_in(self.ast.allocator());

        let array_ident = self.helper.ident_ref("Array");
        let from_member = self.helper.static_member(array_ident, "from", false);
        let mut from_args = ArenaVec::new_in(self.ast);
        from_args.push(Argument::from(items_for_from));
        from_args.push(Argument::from(fn_cloned));
        let from_call = self.helper.call_expr(from_member, from_args, false);

        let alt = self.helper.ident_ref("undefined");
        Some(self.helper.conditional_expr(items_test, from_call, alt))
    }

    fn lower_join(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let items_arg = call.arguments.first()?.as_expression()?;
        let joiner_arg = call.arguments.get(1)?.as_expression()?;

        let items_test = items_arg.clone_in(self.ast.allocator());
        let items_for_from = items_arg.clone_in(self.ast.allocator());
        let joiner_cloned = joiner_arg.clone_in(self.ast.allocator());

        let array_ident = self.helper.ident_ref("Array");
        let from_member = self.helper.static_member(array_ident, "from", false);
        let mut from_args = ArenaVec::new_in(self.ast);
        from_args.push(Argument::from(items_for_from));
        let from_call = self.helper.call_expr(from_member, from_args, false);

        let join_member = self.helper.static_member(from_call, "join", false);
        let mut join_args = ArenaVec::new_in(self.ast);
        join_args.push(Argument::from(joiner_cloned));
        let join_call = self.helper.call_expr(join_member, join_args, false);

        let alt = self.helper.ident_ref("undefined");
        Some(self.helper.conditional_expr(items_test, join_call, alt))
    }

    fn lower_range(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;

        if call.arguments.len() == 1 {
            if let Expression::NumericLiteral(num) = first_arg {
                let n = num.value as i64;
                if (0..=30).contains(&n) {
                    let mut elements = ArenaVec::new_in(self.ast);
                    for i in 0..n {
                        elements.push(ArrayExpressionElement::from(
                            self.helper.number_lit(i as f64),
                        ));
                    }
                    return Some(Expression::new_array_expression(SPAN, elements, self.ast));
                }
            }
        }

        None
    }

    fn lower_guard(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        if call.arguments.len() >= 2 {
            let fn_arg = call.arguments.get(1)?.as_expression()?;
            if let Expression::ArrowFunctionExpression(arrow) = fn_arg {
                if let Some(concise) = extract_arrow_expr(arrow) {
                    return Some(concise.clone_in(self.ast.allocator()));
                }
            }
            let call_args = ArenaVec::new_in(self.ast);
            return Some(self.helper.call_expr(
                fn_arg.clone_in(self.ast.allocator()),
                call_args,
                false,
            ));
        }
        None
    }

    fn lower_live(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;
        let mut props = ArenaVec::new_in(self.ast);

        let key1 = PropertyKey::new_static_identifier(SPAN, "_$litLive$", self.ast);
        let val1 = self.helper.bool_lit(true);
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key1,
            val1,
            false,
            false,
            false,
            self.ast,
        ));

        let key2 = PropertyKey::new_static_identifier(SPAN, "value", self.ast);
        let val2 = first_arg.clone_in(self.ast.allocator());
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key2,
            val2,
            false,
            false,
            false,
            self.ast,
        ));

        Some(Expression::new_object_expression(SPAN, props, self.ast))
    }

    fn lower_keyed(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let key_arg = call.arguments.first()?.as_expression()?;
        let val_arg = call.arguments.get(1)?.as_expression()?;

        let mut props = ArenaVec::new_in(self.ast);

        let key1 = PropertyKey::new_static_identifier(SPAN, "_$litKey$", self.ast);
        let val1 = key_arg.clone_in(self.ast.allocator());
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key1,
            val1,
            false,
            false,
            false,
            self.ast,
        ));

        let key2 = PropertyKey::new_static_identifier(SPAN, "value", self.ast);
        let val2 = val_arg.clone_in(self.ast.allocator());
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key2,
            val2,
            false,
            false,
            false,
            self.ast,
        ));

        Some(Expression::new_object_expression(SPAN, props, self.ast))
    }

    fn lower_cache(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;

        let mut props = ArenaVec::new_in(self.ast);

        let key1 = PropertyKey::new_static_identifier(SPAN, "_$litCache$", self.ast);
        let val1 = self.helper.bool_lit(true);
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key1,
            val1,
            false,
            false,
            false,
            self.ast,
        ));

        let key2 = PropertyKey::new_static_identifier(SPAN, "value", self.ast);
        let val2 = first_arg.clone_in(self.ast.allocator());
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key2,
            val2,
            false,
            false,
            false,
            self.ast,
        ));

        Some(Expression::new_object_expression(SPAN, props, self.ast))
    }

    fn lower_repeat(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let items_arg = call.arguments.first()?.as_expression()?;
        let template_arg = if call.arguments.len() == 2 {
            call.arguments.get(1)?.as_expression()?
        } else if call.arguments.len() >= 3 {
            call.arguments.get(2)?.as_expression()?
        } else {
            return None;
        };

        let items_test = items_arg.clone_in(self.ast.allocator());
        let items_for_from = items_arg.clone_in(self.ast.allocator());
        let tpl_cloned = template_arg.clone_in(self.ast.allocator());

        let array_ident = self.helper.ident_ref("Array");
        let from_member = self.helper.static_member(array_ident, "from", false);
        let mut from_args = ArenaVec::new_in(self.ast);
        from_args.push(Argument::from(items_for_from));
        from_args.push(Argument::from(tpl_cloned));
        let from_call = self.helper.call_expr(from_member, from_args, false);

        let alt = self.helper.ident_ref("undefined");
        Some(self.helper.conditional_expr(items_test, from_call, alt))
    }

    fn lower_template_content(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;
        let tpl = first_arg.clone_in(self.ast.allocator());
        let content = self.helper.static_member(tpl, "content", true);
        let clone_member = self.helper.static_member(content, "cloneNode", true);
        let mut clone_args = ArenaVec::new_in(self.ast);
        clone_args.push(Argument::from(self.helper.bool_lit(true)));
        Some(self.helper.call_expr(clone_member, clone_args, true))
    }

    fn lower_unsafe_html(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;
        let mut props = ArenaVec::new_in(self.ast);

        let key1 = PropertyKey::new_static_identifier(SPAN, "_$litType$", self.ast);
        let val1 = self.helper.number_lit(1.0);
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key1,
            val1,
            false,
            false,
            false,
            self.ast,
        ));

        let key2 = PropertyKey::new_static_identifier(SPAN, "_$litStrings$", self.ast);
        let mut str_elements = ArenaVec::new_in(self.ast);
        str_elements.push(ArrayExpressionElement::from(
            first_arg.clone_in(self.ast.allocator()),
        ));
        let val2 = Expression::new_array_expression(SPAN, str_elements, self.ast);
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key2,
            val2,
            false,
            false,
            false,
            self.ast,
        ));

        let key3 = PropertyKey::new_static_identifier(SPAN, "values", self.ast);
        let val3 = self.helper.empty_array();
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key3,
            val3,
            false,
            false,
            false,
            self.ast,
        ));

        Some(Expression::new_object_expression(SPAN, props, self.ast))
    }

    fn lower_unsafe_svg(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;
        let mut props = ArenaVec::new_in(self.ast);

        let key1 = PropertyKey::new_static_identifier(SPAN, "_$litType$", self.ast);
        let val1 = self.helper.number_lit(2.0);
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key1,
            val1,
            false,
            false,
            false,
            self.ast,
        ));

        let key2 = PropertyKey::new_static_identifier(SPAN, "_$litStrings$", self.ast);
        let mut str_elements = ArenaVec::new_in(self.ast);
        str_elements.push(ArrayExpressionElement::from(
            first_arg.clone_in(self.ast.allocator()),
        ));
        let val2 = Expression::new_array_expression(SPAN, str_elements, self.ast);
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key2,
            val2,
            false,
            false,
            false,
            self.ast,
        ));

        let key3 = PropertyKey::new_static_identifier(SPAN, "values", self.ast);
        let val3 = self.helper.empty_array();
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key3,
            val3,
            false,
            false,
            false,
            self.ast,
        ));

        Some(Expression::new_object_expression(SPAN, props, self.ast))
    }

    fn lower_unsafe_mathml(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;
        let mut props = ArenaVec::new_in(self.ast);

        let key1 = PropertyKey::new_static_identifier(SPAN, "_$litType$", self.ast);
        let val1 = self.helper.number_lit(3.0);
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key1,
            val1,
            false,
            false,
            false,
            self.ast,
        ));

        let key2 = PropertyKey::new_static_identifier(SPAN, "_$litStrings$", self.ast);
        let mut str_elements = ArenaVec::new_in(self.ast);
        str_elements.push(ArrayExpressionElement::from(
            first_arg.clone_in(self.ast.allocator()),
        ));
        let val2 = Expression::new_array_expression(SPAN, str_elements, self.ast);
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key2,
            val2,
            false,
            false,
            false,
            self.ast,
        ));

        let key3 = PropertyKey::new_static_identifier(SPAN, "values", self.ast);
        let val3 = self.helper.empty_array();
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key3,
            val3,
            false,
            false,
            false,
            self.ast,
        ));

        Some(Expression::new_object_expression(SPAN, props, self.ast))
    }

    fn lower_until(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;
        Some(first_arg.clone_in(self.ast.allocator()))
    }

    fn lower_async_append(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;
        let mut props = ArenaVec::new_in(self.ast);

        let key1 = PropertyKey::new_static_identifier(SPAN, "_$litAsyncAppend$", self.ast);
        let val1 = self.helper.bool_lit(true);
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key1,
            val1,
            false,
            false,
            false,
            self.ast,
        ));

        let key2 = PropertyKey::new_static_identifier(SPAN, "value", self.ast);
        let val2 = first_arg.clone_in(self.ast.allocator());
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key2,
            val2,
            false,
            false,
            false,
            self.ast,
        ));

        Some(Expression::new_object_expression(SPAN, props, self.ast))
    }

    fn lower_async_replace(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;
        let mut props = ArenaVec::new_in(self.ast);

        let key1 = PropertyKey::new_static_identifier(SPAN, "_$litAsyncReplace$", self.ast);
        let val1 = self.helper.bool_lit(true);
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key1,
            val1,
            false,
            false,
            false,
            self.ast,
        ));

        let key2 = PropertyKey::new_static_identifier(SPAN, "value", self.ast);
        let val2 = first_arg.clone_in(self.ast.allocator());
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key2,
            val2,
            false,
            false,
            false,
            self.ast,
        ));

        Some(Expression::new_object_expression(SPAN, props, self.ast))
    }

    fn lower_ref(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;
        let mut props = ArenaVec::new_in(self.ast);

        let key1 = PropertyKey::new_static_identifier(SPAN, "_$litRef$", self.ast);
        let val1 = self.helper.bool_lit(true);
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key1,
            val1,
            false,
            false,
            false,
            self.ast,
        ));

        let key2 = PropertyKey::new_static_identifier(SPAN, "callback", self.ast);
        let val2 = first_arg.clone_in(self.ast.allocator());
        props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key2,
            val2,
            false,
            false,
            false,
            self.ast,
        ));

        Some(Expression::new_object_expression(SPAN, props, self.ast))
    }
}

impl<'a, 'b> VisitMut<'a> for DirectiveLowerer<'a, 'b> {
    fn visit_expression(&mut self, expr: &mut Expression<'a>) {
        walk_expression(self, expr);

        if let Expression::CallExpression(call) = expr {
            let matched_directive = match &call.callee {
                Expression::Identifier(ident) => self.import_ctx.get_directive_kind(&ident.name),
                Expression::StaticMemberExpression(mem) => {
                    if let Expression::Identifier(ns) = &mem.object {
                        self.import_ctx
                            .namespace_bindings
                            .get(ns.name.as_str())
                            .copied()
                    } else {
                        None
                    }
                }
                _ => None,
            };

            if let Some(directive) = matched_directive {
                if let Some(lowered) = self.lower_call(directive, call) {
                    *expr = lowered;
                    self.lowered_count += 1;
                    self.directives_used.insert(directive.name().to_string());
                }
            }
        }
    }
}

fn prune_and_update_imports<'a>(
    program: &mut Program<'a>,
    lowerer: &DirectiveLowerer<'a, '_>,
    ast: &AstBuilder<'a>,
) {
    let mut new_body = ArenaVec::new_in(ast);
    let mut injected_nothing = false;

    for mut stmt in std::mem::replace(&mut program.body, ArenaVec::new_in(ast)) {
        if let Statement::ImportDeclaration(import_decl) = &mut stmt {
            let specifier = import_decl.source.value.as_str();

            // If it's a directive module: lit/directives/* or lit-html/directives/*
            if extract_directive_slug(specifier).is_some() {
                if let Some(specifiers) = &mut import_decl.specifiers {
                    // Filter out lowered specifiers
                    specifiers.retain(|spec| match spec {
                        ImportDeclarationSpecifier::ImportSpecifier(named) => {
                            let local = named.local.name.as_str();
                            !lowerer.import_ctx.directive_bindings.contains_key(local)
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                            let local = ns.local.name.as_str();
                            !lowerer.import_ctx.namespace_bindings.contains_key(local)
                        }
                        _ => true,
                    });

                    if specifiers.is_empty() {
                        // Entire import declaration is now empty, prune it!
                        continue;
                    }
                }
            } else if lowerer.used_nothing
                && !lowerer.import_ctx.has_nothing_imported
                && !injected_nothing
                && (specifier == "lit" || specifier == "lit-html")
            {
                // Inject `nothing` into existing lit import
                if let Some(specifiers) = &mut import_decl.specifiers {
                    let imported = ModuleExportName::new_identifier_name(SPAN, "nothing", ast);
                    let local = BindingIdentifier::new(SPAN, "nothing", ast);
                    let new_spec = ImportDeclarationSpecifier::ImportSpecifier(ArenaBox::new_in(
                        ImportSpecifier::new(SPAN, imported, local, ImportOrExportKind::Value, ast),
                        ast,
                    ));
                    specifiers.push(new_spec);
                    injected_nothing = true;
                }
            }
        }
        new_body.push(stmt);
    }

    // If `nothing` was used, not originally imported, and no existing `lit` import was found,
    // prepend `import { nothing } from 'lit';`
    if lowerer.used_nothing && !lowerer.import_ctx.has_nothing_imported && !injected_nothing {
        let imported = ModuleExportName::new_identifier_name(SPAN, "nothing", ast);
        let local = BindingIdentifier::new(SPAN, "nothing", ast);
        let specifier = ImportDeclarationSpecifier::ImportSpecifier(ArenaBox::new_in(
            ImportSpecifier::new(SPAN, imported, local, ImportOrExportKind::Value, ast),
            ast,
        ));
        let mut specifiers = ArenaVec::new_in(ast);
        specifiers.push(specifier);
        let source_lit = StringLiteral::new(SPAN, "lit", None, ast);
        let import_decl = Statement::new_import_declaration(
            SPAN,
            Some(specifiers),
            source_lit,
            None,
            None,
            ImportOrExportKind::Value,
            ast,
        );
        new_body.insert(0, import_decl);
    }

    program.body = new_body;
}
