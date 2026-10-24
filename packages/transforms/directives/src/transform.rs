use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec, CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::VisitMut;
use oxc_ast_visit::walk_mut::walk_expression;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder, SymbolId};
use oxc_span::{SPAN, SourceType};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::ast_helpers::AstHelper;
use lit_analysis::symbol::{CanonicalDirective, CanonicalLitSymbol, SymbolProofContext};

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

use crate::prune::prune_and_update_imports;
use crate::utils::{camel_to_kebab, extract_arrow_expr};

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

    // Build semantic model for lexical scope and symbol resolution
    let semantic_ret = SemanticBuilder::new().build(&program);
    let scoping = semantic_ret.semantic.into_scoping();

    // Scan for Lit directive imports
    let symbol_ctx = SymbolProofContext::scan(&program, &scoping, source);

    let has_directives = symbol_ctx.lit_symbols.values().any(|sym| {
        matches!(
            sym,
            CanonicalLitSymbol::Directive(_) | CanonicalLitSymbol::DirectiveNamespace(_)
        )
    });

    if !has_directives {
        return DirectivesResult {
            code: source.to_string(),
            map: None,
            lowered_count: 0,
            directives_used: vec![],
        };
    }

    let ast = AstBuilder::new(&allocator);
    let mut lowerer = DirectiveLowerer::new(&ast, &symbol_ctx, &scoping);

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
    pub symbol_ctx: &'b SymbolProofContext<'b>,
    pub scoping: &'b Scoping,
    pub used_nothing: bool,
    pub lowered_count: u32,
    pub directives_used: HashSet<String>,
    pub lowered_symbol_refs: HashMap<SymbolId, usize>,
    pub lowered_namespace_refs: HashMap<SymbolId, usize>,
}

impl<'a, 'b> DirectiveLowerer<'a, 'b> {
    pub fn new(
        ast: &'b AstBuilder<'a>,
        symbol_ctx: &'b SymbolProofContext<'b>,
        scoping: &'b Scoping,
    ) -> Self {
        Self {
            ast,
            helper: AstHelper::new(ast),
            symbol_ctx,
            scoping,
            used_nothing: false,
            lowered_count: 0,
            directives_used: HashSet::new(),
            lowered_symbol_refs: HashMap::new(),
            lowered_namespace_refs: HashMap::new(),
        }
    }

    fn lower_call(
        &mut self,
        kind: CanonicalDirective,
        call: &CallExpression<'a>,
    ) -> Option<Expression<'a>> {
        match kind {
            CanonicalDirective::ClassMap => self.lower_class_map(call),
            CanonicalDirective::StyleMap => self.lower_style_map(call),
            CanonicalDirective::IfDefined => self.lower_if_defined(call),
            CanonicalDirective::When => self.lower_when(call),
            CanonicalDirective::Choose => self.lower_choose(call),
            CanonicalDirective::Map => self.lower_map(call),
            CanonicalDirective::Join => self.lower_join(call),
            CanonicalDirective::Range => self.lower_range(call),
            CanonicalDirective::Guard => self.lower_guard(call),
            CanonicalDirective::Live => self.lower_live(call),
            CanonicalDirective::Keyed => self.lower_keyed(call),
            CanonicalDirective::Cache => self.lower_cache(call),
            CanonicalDirective::Repeat => self.lower_repeat(call),
            CanonicalDirective::TemplateContent => self.lower_template_content(call),
            CanonicalDirective::UnsafeHTML => self.lower_unsafe_html(call),
            CanonicalDirective::UnsafeSVG => self.lower_unsafe_svg(call),
            CanonicalDirective::UnsafeMathML => self.lower_unsafe_mathml(call),
            CanonicalDirective::Until => self.lower_until(call),
            CanonicalDirective::AsyncAppend => self.lower_async_append(call),
            CanonicalDirective::AsyncReplace => self.lower_async_replace(call),
            CanonicalDirective::Ref => self.lower_ref(call),
            CanonicalDirective::Slice => None,
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
                if let Expression::BooleanLiteral(b) = &cond
                    && b.value
                {
                    if let Some(cur_acc) = acc {
                        let spaced_key = if let Expression::StringLiteral(s) = &key_expr {
                            let mut space_str = String::with_capacity(1 + s.value.len());
                            space_str.push(' ');
                            space_str.push_str(s.value.as_str());
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

                if let Some(cur_acc) = acc {
                    let spaced_key = if let Expression::StringLiteral(s) = &key_expr {
                        let mut space_str = String::with_capacity(1 + s.value.len());
                        space_str.push(' ');
                        space_str.push_str(s.value.as_str());
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

        // Non-literal dynamic objects cannot be lowered safely at compile time without
        // generating bloated runtime wrappers; bail out cleanly leaving directive call intact.
        None
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
                            let mut style_str =
                                String::with_capacity(prop_name.len() + 3 + s.value.len());
                            style_str.push_str(&prop_name);
                            style_str.push_str(": ");
                            style_str.push_str(s.value.as_str());
                            style_str.push(';');
                            let style_lit = self.ast.allocator().alloc_str(&style_str);
                            parts.push(self.helper.string_lit(style_lit));
                        }
                        Expression::NumericLiteral(num) => {
                            let num_val = num.value.to_string();
                            let mut style_str =
                                String::with_capacity(prop_name.len() + 3 + num_val.len());
                            style_str.push_str(&prop_name);
                            style_str.push_str(": ");
                            style_str.push_str(&num_val);
                            style_str.push(';');
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

                            let mut prefix = String::with_capacity(prop_name.len() + 2);
                            prefix.push_str(&prop_name);
                            prefix.push_str(": ");
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
                if n >= 0 {
                    let mut elements = ArenaVec::new_in(self.ast);
                    for i in 0..n {
                        elements.push(ArrayExpressionElement::from(
                            self.helper.number_lit(i as f64),
                        ));
                    }
                    return Some(Expression::new_array_expression(SPAN, elements, self.ast));
                }
            }
        } else if call.arguments.len() == 2 {
            let second_arg = call.arguments.get(1)?.as_expression()?;
            if let (Expression::NumericLiteral(start_num), Expression::NumericLiteral(end_num)) =
                (first_arg, second_arg)
            {
                let start = start_num.value as i64;
                let end = end_num.value as i64;
                if start <= end {
                    let mut elements = ArenaVec::new_in(self.ast);
                    for i in start..end {
                        elements.push(ArrayExpressionElement::from(
                            self.helper.number_lit(i as f64),
                        ));
                    }
                    return Some(Expression::new_array_expression(SPAN, elements, self.ast));
                }
            }
        } else if call.arguments.len() == 3 {
            let second_arg = call.arguments.get(1)?.as_expression()?;
            let third_arg = call.arguments.get(2)?.as_expression()?;
            if let (
                Expression::NumericLiteral(start_num),
                Expression::NumericLiteral(end_num),
                Expression::NumericLiteral(step_num),
            ) = (first_arg, second_arg, third_arg)
            {
                let start = start_num.value as i64;
                let end = end_num.value as i64;
                let step = step_num.value as i64;
                if step > 0 && start <= end {
                    let mut elements = ArenaVec::new_in(self.ast);
                    let mut i = start;
                    while i < end {
                        elements.push(ArrayExpressionElement::from(
                            self.helper.number_lit(i as f64),
                        ));
                        i += step;
                    }
                    return Some(Expression::new_array_expression(SPAN, elements, self.ast));
                }
            }
        }

        None
    }

    fn lower_guard(&mut self, _call: &CallExpression<'a>) -> Option<Expression<'a>> {
        // Dependency memoization requires runtime cache state; stripping dependencies
        // causes unconditional re-evaluation on every render and destroys memoization semantics.
        // Bail out cleanly to preserve the author directive and runtime dependency tracking.
        None
    }

    fn lower_live(&mut self, _call: &CallExpression<'a>) -> Option<Expression<'a>> {
        None
    }

    fn lower_keyed(&mut self, _call: &CallExpression<'a>) -> Option<Expression<'a>> {
        None
    }

    fn lower_cache(&mut self, _call: &CallExpression<'a>) -> Option<Expression<'a>> {
        None
    }

    fn lower_repeat(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        // When a key function is provided (repeat(items, keyFn, templateFn)),
        // lowering to Array.from would discard the key function and destroy Lit's keyed DOM reconciliation.
        // Bail out cleanly unless only 2 arguments (items, templateFn) are present without keys.
        if call.arguments.len() != 2 {
            return None;
        }

        let items_arg = call.arguments.first()?.as_expression()?;
        let template_arg = call.arguments.get(1)?.as_expression()?;

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

    fn lower_unsafe_template(
        &mut self,
        call: &CallExpression<'a>,
        type_num: f64,
    ) -> Option<Expression<'a>> {
        let first_arg = call.arguments.first()?.as_expression()?;
        let mut props = ArenaVec::new_in(self.ast);

        let key1 = PropertyKey::new_static_identifier(SPAN, "_$litType$", self.ast);
        let val1 = self.helper.number_lit(type_num);
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

        let key2 = PropertyKey::new_static_identifier(SPAN, "strings", self.ast);
        let mut str_elements = ArenaVec::new_in(self.ast);
        str_elements.push(ArrayExpressionElement::from(
            first_arg.clone_in(self.ast.allocator()),
        ));
        let arr_expr = Expression::new_array_expression(SPAN, str_elements, self.ast);

        let mut raw_str_elements = ArenaVec::new_in(self.ast);
        raw_str_elements.push(ArrayExpressionElement::from(
            first_arg.clone_in(self.ast.allocator()),
        ));
        let raw_arr_expr = Expression::new_array_expression(SPAN, raw_str_elements, self.ast);

        let mut raw_props = ArenaVec::new_in(self.ast);
        let raw_key = PropertyKey::new_static_identifier(SPAN, "raw", self.ast);
        raw_props.push(ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            raw_key,
            raw_arr_expr,
            false,
            false,
            false,
            self.ast,
        ));
        let raw_obj = Expression::new_object_expression(SPAN, raw_props, self.ast);

        let obj_ident = self.helper.ident_ref("Object");
        let assign_member = self.helper.static_member(obj_ident, "assign", false);
        let mut assign_args = ArenaVec::new_in(self.ast);
        assign_args.push(Argument::from(arr_expr));
        assign_args.push(Argument::from(raw_obj));
        let val2 = self.helper.call_expr(assign_member, assign_args, false);
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

    fn lower_unsafe_html(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        self.lower_unsafe_template(call, 1.0)
    }

    fn lower_unsafe_svg(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        self.lower_unsafe_template(call, 2.0)
    }

    fn lower_unsafe_mathml(&mut self, call: &CallExpression<'a>) -> Option<Expression<'a>> {
        self.lower_unsafe_template(call, 3.0)
    }

    fn lower_until(&mut self, _call: &CallExpression<'a>) -> Option<Expression<'a>> {
        None
    }

    fn lower_async_append(&mut self, _call: &CallExpression<'a>) -> Option<Expression<'a>> {
        None
    }

    fn lower_async_replace(&mut self, _call: &CallExpression<'a>) -> Option<Expression<'a>> {
        None
    }

    fn lower_ref(&mut self, _call: &CallExpression<'a>) -> Option<Expression<'a>> {
        None
    }
}

impl<'a, 'b> VisitMut<'a> for DirectiveLowerer<'a, 'b> {
    fn visit_expression(&mut self, expr: &mut Expression<'a>) {
        walk_expression(self, expr);

        if let Expression::CallExpression(call) = expr {
            let matched_directive = match &call.callee {
                Expression::Identifier(ident) => {
                    let sym_id = if let Some(ref_id) = ident.reference_id.get() {
                        self.scoping.get_reference(ref_id).symbol_id()
                    } else {
                        let root = self.scoping.root_scope_id();
                        self.scoping.get_binding(root, ident.name.as_str().into())
                    };

                    sym_id.and_then(|sym| match self.symbol_ctx.lit_symbols.get(&sym) {
                        Some(CanonicalLitSymbol::Directive(d)) => Some((*d, Some(sym), None)),
                        _ => None,
                    })
                }
                Expression::StaticMemberExpression(mem) => {
                    if let Expression::Identifier(ns) = &mem.object {
                        let ns_sym = if let Some(ref_id) = ns.reference_id.get() {
                            self.scoping.get_reference(ref_id).symbol_id()
                        } else {
                            let root = self.scoping.root_scope_id();
                            self.scoping.get_binding(root, ns.name.as_str().into())
                        };

                        ns_sym.and_then(|sym| match self.symbol_ctx.lit_symbols.get(&sym) {
                            Some(CanonicalLitSymbol::DirectiveNamespace(d)) => {
                                if mem.property.name == d.name()
                                    || CanonicalDirective::from_canonical_name(&mem.property.name)
                                        == Some(*d)
                                {
                                    Some((*d, None, Some(sym)))
                                } else {
                                    None
                                }
                            }
                            Some(CanonicalLitSymbol::LitNamespace) => {
                                CanonicalDirective::from_canonical_name(&mem.property.name)
                                    .map(|d| (d, None, Some(sym)))
                            }
                            _ => None,
                        })
                    } else {
                        None
                    }
                }
                _ => None,
            };

            if let Some((directive, sym_id_opt, ns_sym_id_opt)) = matched_directive
                && let Some(lowered) = self.lower_call(directive, call)
            {
                *expr = lowered;
                self.lowered_count += 1;
                self.directives_used.insert(directive.name().to_string());
                if let Some(sym) = sym_id_opt {
                    *self.lowered_symbol_refs.entry(sym).or_default() += 1;
                }
                if let Some(ns_sym) = ns_sym_id_opt {
                    *self.lowered_namespace_refs.entry(ns_sym).or_default() += 1;
                }
            }
        }
    }
}
