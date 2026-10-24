use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec, CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::Visit;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{SPAN, SourceType};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use lit_analysis::decorator::{DecoratorExtractor, LitDecoratorKind};
use lit_analysis::property::PropertyModelExtractor;
use lit_analysis::symbol::SymbolProofContext;
use oxc_semantic::SemanticBuilder;

use crate::parser::{PartDescriptor, compute_template_parts};

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct DomPathsOptions {
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
    pub normalize_whitespace: Option<bool>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DomPathsResult {
    pub code: String,
    pub map: Option<String>,
    pub components_count: u32,
    pub paths_count: u32,
    pub paths: Vec<Vec<Vec<u32>>>,
}

struct TemplateCollector<'s> {
    symbol_ctx: &'s SymbolProofContext<'s>,
    templates: Vec<(Vec<String>, bool)>, // (quasis, is_render)
    compiled_templates_count: usize,
    in_render: bool,
}

impl<'a, 's> Visit<'a> for TemplateCollector<'s> {
    fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
        let is_render = match &method.key {
            PropertyKey::StaticIdentifier(ident) => ident.name == "render",
            _ => false,
        };

        let prev_in_render = self.in_render;
        if is_render {
            self.in_render = true;
        }

        oxc_ast_visit::walk::walk_method_definition(self, method);
        self.in_render = prev_in_render;
    }

    fn visit_object_expression(&mut self, obj: &ObjectExpression<'a>) {
        let is_compiled_lit_template = obj.properties.iter().any(|prop| match prop {
            ObjectPropertyKind::ObjectProperty(p) => p.key.is_specific_static_name("_$litType$"),
            _ => false,
        });
        if is_compiled_lit_template {
            self.compiled_templates_count += 1;
        }
        oxc_ast_visit::walk::walk_object_expression(self, obj);
    }

    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if (self.symbol_ctx.is_lit_html_tag(&tagged.tag)
            || self.symbol_ctx.is_lit_svg_tag(&tagged.tag))
            && !tagged.quasi.expressions.is_empty()
        {
            let quasis = tagged
                .quasi
                .quasis
                .iter()
                .map(|q| q.value.raw.to_string())
                .collect();
            self.templates.push((quasis, self.in_render));
        }
        oxc_ast_visit::walk::walk_tagged_template_expression(self, tagged);
    }
}

struct ExprDepCollector<'s> {
    reactive_props: &'s HashSet<String>,
    deps: Vec<String>,
    valid: bool,
}

impl<'a, 's> Visit<'a> for ExprDepCollector<'s> {
    fn visit_tagged_template_expression(&mut self, _tagged: &TaggedTemplateExpression<'a>) {
        self.valid = false;
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(mem) = call.callee.without_parentheses()
            && matches!(
                mem.object.without_parentheses(),
                Expression::ThisExpression(_)
            )
        {
            self.valid = false;
            return;
        }
        oxc_ast_visit::walk::walk_call_expression(self, call);
    }

    fn visit_static_member_expression(&mut self, mem: &StaticMemberExpression<'a>) {
        if matches!(
            mem.object.without_parentheses(),
            Expression::ThisExpression(_)
        ) {
            let prop_name = mem.property.name.as_str();
            if !self.reactive_props.contains(prop_name) {
                self.valid = false;
                return;
            }
            if !self.deps.iter().any(|d| d == prop_name) {
                self.deps.push(prop_name.to_string());
            }
            return;
        }
        oxc_ast_visit::walk::walk_static_member_expression(self, mem);
    }

    fn visit_computed_member_expression(&mut self, mem: &ComputedMemberExpression<'a>) {
        if matches!(
            mem.object.without_parentheses(),
            Expression::ThisExpression(_)
        ) {
            self.valid = false;
            return;
        }
        oxc_ast_visit::walk::walk_computed_member_expression(self, mem);
    }
}

fn is_property_reflecting(p: &ObjectProperty) -> bool {
    if let Expression::ObjectExpression(opts) = &p.value {
        for opt in &opts.properties {
            if let ObjectPropertyKind::ObjectProperty(opt_prop) = opt
                && opt_prop.key.is_specific_static_name("reflect")
                && PropertyModelExtractor::is_truthy(&opt_prop.value) != Some(false)
            {
                return true;
            }
        }
    }
    false
}

fn try_build_dom_path_update_method<'a>(
    class: &Class<'a>,
    part_descriptors: &[PartDescriptor],
    symbol_ctx: &SymbolProofContext<'a>,
    ast: &AstBuilder<'a>,
) -> Option<ClassElement<'a>> {
    // Bail if all parts are not sole child expressions of distinct parent elements
    let mut parent_paths = HashSet::new();
    for part in part_descriptors {
        if part.is_attribute || part.path.len() < 2 || part.path.last() != Some(&0) {
            return None;
        }
        let parent_slice = &part.path[..part.path.len() - 1];
        if !parent_paths.insert(parent_slice.to_vec()) {
            return None;
        }
    }

    // Collect reactive properties from `static properties`, `static get properties()`, and decorators
    let mut reactive_props = HashSet::new();
    let mut render_method: Option<&MethodDefinition<'a>> = None;

    for elem in &class.body.body {
        match elem {
            ClassElement::MethodDefinition(method) => {
                if let PropertyKey::StaticIdentifier(ident) = &method.key {
                    match ident.name.as_str() {
                        "update" => return None,
                        "render" => render_method = Some(method),
                        _ => {}
                    }
                }
                // static get properties() { return { ... }; }
                if method.r#static
                    && method.kind == MethodDefinitionKind::Get
                    && method.key.is_specific_static_name("properties")
                    && let Some(body) = &method.value.body
                {
                    for stmt in &body.statements {
                        if let Statement::ReturnStatement(ret) = stmt
                            && let Some(Expression::ObjectExpression(obj)) = &ret.argument
                        {
                            for prop_kind in &obj.properties {
                                if let ObjectPropertyKind::ObjectProperty(p) = prop_kind
                                    && let Some(name) = p.key.static_name()
                                {
                                    if is_property_reflecting(p) {
                                        return None;
                                    }
                                    reactive_props.insert(name.into_owned());
                                }
                            }
                        }
                    }
                }
            }
            ClassElement::PropertyDefinition(prop)
                if prop.r#static && prop.key.is_specific_static_name("properties") =>
            {
                if let Some(Expression::ObjectExpression(obj)) = &prop.value {
                    for prop_kind in &obj.properties {
                        if let ObjectPropertyKind::ObjectProperty(p) = prop_kind
                            && let Some(name) = p.key.static_name()
                        {
                            if is_property_reflecting(p) {
                                return None;
                            }
                            reactive_props.insert(name.into_owned());
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // Check decorators on class members for @property({ reflect: true })
    let member_decorators = DecoratorExtractor::extract_member_decorators(class, symbol_ctx);
    for dec in &member_decorators {
        if let LitDecoratorKind::Property { reflect: true, .. } = dec.kind {
            return None;
        }
        if let Some(target) = &dec.target_member {
            match dec.kind {
                LitDecoratorKind::Property { .. } | LitDecoratorKind::State { .. } => {
                    reactive_props.insert(target.clone());
                }
                _ => {}
            }
        }
    }

    if reactive_props.is_empty() {
        return None;
    }

    let render = render_method?;
    let body = render.value.body.as_ref()?;
    if body.statements.len() != 1 {
        return None;
    }

    let Statement::ReturnStatement(ret) = &body.statements[0] else {
        return None;
    };
    let Some(Expression::TaggedTemplateExpression(tagged)) =
        ret.argument.as_ref().map(|e| e.without_parentheses())
    else {
        return None;
    };

    if !symbol_ctx.is_lit_html_tag(&tagged.tag)
        || tagged.quasi.expressions.len() != part_descriptors.len()
    {
        return None;
    }

    let mut expr_deps: Vec<(Expression<'a>, Vec<String>)> =
        Vec::with_capacity(part_descriptors.len());
    for expr in &tagged.quasi.expressions {
        let mut collector = ExprDepCollector {
            reactive_props: &reactive_props,
            deps: Vec::new(),
            valid: true,
        };
        collector.visit_expression(expr);
        if !collector.valid || collector.deps.is_empty() {
            return None;
        }
        expr_deps.push((expr.clone_in(ast.allocator()), collector.deps));
    }

    // Build `update(changedProperties)` method body
    let mut stmts = ArenaVec::new_in(ast);

    // 1. `if (!this.hasUpdated) { super.update(changedProperties); return; }`
    let this_has_updated = Expression::new_static_member_expression(
        SPAN,
        Expression::new_this_expression(SPAN, ast),
        IdentifierName::new(SPAN, "hasUpdated", ast),
        false,
        ast,
    );
    let not_has_updated =
        Expression::new_unary_expression(SPAN, UnaryOperator::LogicalNot, this_has_updated, ast);
    let mut first_update_stmts = ArenaVec::new_in(ast);
    let mut super_args = ArenaVec::new_in(ast);
    super_args.push(Argument::from(Expression::new_identifier(
        SPAN,
        "changedProperties",
        ast,
    )));
    let super_update_call = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_super(SPAN, ast),
            IdentifierName::new(SPAN, "update", ast),
            false,
            ast,
        ),
        None,
        super_args,
        false,
        ast,
    );
    first_update_stmts.push(Statement::new_expression_statement(
        SPAN,
        super_update_call,
        ast,
    ));
    first_update_stmts.push(Statement::new_return_statement(SPAN, None, ast));
    stmts.push(Statement::new_if_statement(
        SPAN,
        not_has_updated,
        Statement::new_block_statement(SPAN, first_update_stmts, ast),
        None,
        ast,
    ));

    // 2. Ephemeral node traversal: resolve paths on stack without caching on `this`
    let mut paths_decls = ArenaVec::new_in(ast);
    paths_decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "__paths", ast),
        None,
        Some(Expression::new_static_member_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_this_expression(SPAN, ast),
                IdentifierName::new(SPAN, "constructor", ast),
                false,
                ast,
            ),
            IdentifierName::new(SPAN, "__litPartPaths", ast),
            false,
            ast,
        )),
        false,
        ast,
    ));
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        paths_decls,
        false,
        ast,
    ));

    let mut root_decls = ArenaVec::new_in(ast);
    root_decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "__root", ast),
        None,
        Some(Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "renderRoot", ast),
            false,
            ast,
        )),
        false,
        ast,
    ));
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        root_decls,
        false,
        ast,
    ));

    // `const __off = __root.firstChild && __root.firstChild.nodeType === 8 ? 1 : 0;`
    let root_first_child = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "__root", ast),
        IdentifierName::new(SPAN, "firstChild", ast),
        false,
        ast,
    );
    let root_fc_type = Expression::new_static_member_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "__root", ast),
            IdentifierName::new(SPAN, "firstChild", ast),
            false,
            ast,
        ),
        IdentifierName::new(SPAN, "nodeType", ast),
        false,
        ast,
    );
    let is_comment = Expression::new_binary_expression(
        SPAN,
        root_fc_type,
        BinaryOperator::StrictEquality,
        Expression::new_numeric_literal(SPAN, 8.0, None, NumberBase::Decimal, ast),
        ast,
    );
    let off_cond = Expression::new_logical_expression(
        SPAN,
        root_first_child,
        LogicalOperator::And,
        is_comment,
        ast,
    );
    let off_init = Expression::new_conditional_expression(
        SPAN,
        off_cond,
        Expression::new_numeric_literal(SPAN, 1.0, None, NumberBase::Decimal, ast),
        Expression::new_numeric_literal(SPAN, 0.0, None, NumberBase::Decimal, ast),
        ast,
    );
    let mut off_decls = ArenaVec::new_in(ast);
    off_decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "__off", ast),
        None,
        Some(off_init),
        false,
        ast,
    ));
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        off_decls,
        false,
        ast,
    ));

    // `const __nodes = [];` (ephemeral local array)
    let mut nodes_decls = ArenaVec::new_in(ast);
    nodes_decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "__nodes", ast),
        None,
        Some(Expression::new_array_expression(
            SPAN,
            ArenaVec::new_in(ast),
            ast,
        )),
        false,
        ast,
    ));
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        nodes_decls,
        false,
        ast,
    ));

    // `for (let __i = 0; __i < __paths.length; __i++) { const __p = __paths[__i]; ... __nodes.push(__tn); }`
    let mut outer_loop_stmts = ArenaVec::new_in(ast);
    let mut p_decls = ArenaVec::new_in(ast);
    p_decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "__p", ast),
        None,
        Some(Expression::new_computed_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "__paths", ast),
            Expression::new_identifier(SPAN, "__i", ast),
            false,
            ast,
        )),
        false,
        ast,
    ));
    outer_loop_stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        p_decls,
        false,
        ast,
    ));

    let mut cur_decls = ArenaVec::new_in(ast);
    cur_decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "__cur", ast),
        None,
        Some(Expression::new_identifier(SPAN, "__root", ast)),
        false,
        ast,
    ));
    outer_loop_stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Let,
        cur_decls,
        false,
        ast,
    ));

    // `for (let __j = 0; __j < __p.length - 1; __j++) { __cur = __cur.childNodes[__j === 0 ? __p[0] + __off : __p[__j]]; }`
    let mut j_decls = ArenaVec::new_in(ast);
    j_decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "__j", ast),
        None,
        Some(Expression::new_numeric_literal(
            SPAN,
            0.0,
            None,
            NumberBase::Decimal,
            ast,
        )),
        false,
        ast,
    ));
    let for_init = ForStatementInit::VariableDeclaration(VariableDeclaration::boxed(
        SPAN,
        VariableDeclarationKind::Let,
        j_decls,
        false,
        ast,
    ));
    let p_len_minus_1 = Expression::new_binary_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "__p", ast),
            IdentifierName::new(SPAN, "length", ast),
            false,
            ast,
        ),
        BinaryOperator::Subtraction,
        Expression::new_numeric_literal(SPAN, 1.0, None, NumberBase::Decimal, ast),
        ast,
    );
    let for_test = Expression::new_binary_expression(
        SPAN,
        Expression::new_identifier(SPAN, "__j", ast),
        BinaryOperator::LessThan,
        p_len_minus_1,
        ast,
    );
    let for_update = Expression::new_update_expression(
        SPAN,
        UpdateOperator::Increment,
        false,
        SimpleAssignmentTarget::new_assignment_target_identifier(SPAN, "__j", ast),
        ast,
    );
    let j_is_zero = Expression::new_binary_expression(
        SPAN,
        Expression::new_identifier(SPAN, "__j", ast),
        BinaryOperator::StrictEquality,
        Expression::new_numeric_literal(SPAN, 0.0, None, NumberBase::Decimal, ast),
        ast,
    );
    let p0_plus_off = Expression::new_binary_expression(
        SPAN,
        Expression::new_computed_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "__p", ast),
            Expression::new_numeric_literal(SPAN, 0.0, None, NumberBase::Decimal, ast),
            false,
            ast,
        ),
        BinaryOperator::Addition,
        Expression::new_identifier(SPAN, "__off", ast),
        ast,
    );
    let pj_expr = Expression::new_computed_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "__p", ast),
        Expression::new_identifier(SPAN, "__j", ast),
        false,
        ast,
    );
    let step_idx =
        Expression::new_conditional_expression(SPAN, j_is_zero, p0_plus_off, pj_expr, ast);
    let child_step = Expression::new_computed_member_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "__cur", ast),
            IdentifierName::new(SPAN, "childNodes", ast),
            false,
            ast,
        ),
        step_idx,
        false,
        ast,
    );
    let step_assign = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        AssignmentTarget::new_assignment_target_identifier(SPAN, "__cur", ast),
        child_step,
        ast,
    );
    outer_loop_stmts.push(Statement::new_for_statement(
        SPAN,
        Some(for_init),
        Some(for_test),
        Some(for_update),
        Statement::new_expression_statement(SPAN, step_assign, ast),
        ast,
    ));

    // `let __tn = __cur.firstChild; while (__tn && __tn.nodeType !== 3) { __tn = __tn.nextSibling; } __nodes.push(__tn);`
    let mut tn_decls = ArenaVec::new_in(ast);
    tn_decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "__tn", ast),
        None,
        Some(Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "__cur", ast),
            IdentifierName::new(SPAN, "firstChild", ast),
            false,
            ast,
        )),
        false,
        ast,
    ));
    outer_loop_stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Let,
        tn_decls,
        false,
        ast,
    ));

    let while_cond = Expression::new_logical_expression(
        SPAN,
        Expression::new_identifier(SPAN, "__tn", ast),
        LogicalOperator::And,
        Expression::new_binary_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "__tn", ast),
                IdentifierName::new(SPAN, "nodeType", ast),
                false,
                ast,
            ),
            BinaryOperator::StrictInequality,
            Expression::new_numeric_literal(SPAN, 3.0, None, NumberBase::Decimal, ast),
            ast,
        ),
        ast,
    );
    let next_sib_assign = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        AssignmentTarget::new_assignment_target_identifier(SPAN, "__tn", ast),
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "__tn", ast),
            IdentifierName::new(SPAN, "nextSibling", ast),
            false,
            ast,
        ),
        ast,
    );
    outer_loop_stmts.push(Statement::new_while_statement(
        SPAN,
        while_cond,
        Statement::new_expression_statement(SPAN, next_sib_assign, ast),
        ast,
    ));

    let mut push_args = ArenaVec::new_in(ast);
    push_args.push(Argument::from(Expression::new_identifier(
        SPAN, "__tn", ast,
    )));
    let push_call = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "__nodes", ast),
            IdentifierName::new(SPAN, "push", ast),
            false,
            ast,
        ),
        None,
        push_args,
        false,
        ast,
    );
    outer_loop_stmts.push(Statement::new_expression_statement(SPAN, push_call, ast));

    let mut i_decls = ArenaVec::new_in(ast);
    i_decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "__i", ast),
        None,
        Some(Expression::new_numeric_literal(
            SPAN,
            0.0,
            None,
            NumberBase::Decimal,
            ast,
        )),
        false,
        ast,
    ));
    let outer_for_init = ForStatementInit::VariableDeclaration(VariableDeclaration::boxed(
        SPAN,
        VariableDeclarationKind::Let,
        i_decls,
        false,
        ast,
    ));
    let outer_for_test = Expression::new_binary_expression(
        SPAN,
        Expression::new_identifier(SPAN, "__i", ast),
        BinaryOperator::LessThan,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "__paths", ast),
            IdentifierName::new(SPAN, "length", ast),
            false,
            ast,
        ),
        ast,
    );
    let outer_for_update = Expression::new_update_expression(
        SPAN,
        UpdateOperator::Increment,
        false,
        SimpleAssignmentTarget::new_assignment_target_identifier(SPAN, "__i", ast),
        ast,
    );
    stmts.push(Statement::new_for_statement(
        SPAN,
        Some(outer_for_init),
        Some(outer_for_test),
        Some(outer_for_update),
        Statement::new_block_statement(SPAN, outer_loop_stmts, ast),
        ast,
    ));

    // 4. Per-part direct DOM text node update guarded by `changedProperties.has(...)`
    for (idx, (expr, deps)) in expr_deps.into_iter().enumerate() {
        let mut cond_opt: Option<Expression<'a>> = None;
        for dep in deps {
            let mut has_args = ArenaVec::new_in(ast);
            has_args.push(Argument::from(Expression::new_string_literal(
                SPAN,
                ast.allocator().alloc_str(&dep),
                None,
                ast,
            )));
            let has_call = Expression::new_call_expression(
                SPAN,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, "changedProperties", ast),
                    IdentifierName::new(SPAN, "has", ast),
                    false,
                    ast,
                ),
                None,
                has_args,
                false,
                ast,
            );
            cond_opt = Some(match cond_opt {
                None => has_call,
                Some(prev) => Expression::new_logical_expression(
                    SPAN,
                    prev,
                    LogicalOperator::Or,
                    has_call,
                    ast,
                ),
            });
        }
        let cond = cond_opt?;

        let mut str_args = ArenaVec::new_in(ast);
        str_args.push(Argument::from(expr));
        let str_call = Expression::new_call_expression(
            SPAN,
            Expression::new_identifier(SPAN, "String", ast),
            None,
            str_args,
            false,
            ast,
        );
        let node_elem = Expression::new_computed_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "__nodes", ast),
            Expression::new_numeric_literal(SPAN, idx as f64, None, NumberBase::Decimal, ast),
            false,
            ast,
        );
        let assign_data = Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::new_static_member_expression(
                SPAN,
                node_elem,
                IdentifierName::new(SPAN, "data", ast),
                false,
                ast,
            ),
            str_call,
            ast,
        );
        stmts.push(Statement::new_if_statement(
            SPAN,
            cond,
            Statement::new_expression_statement(SPAN, assign_data, ast),
            None,
            ast,
        ));
    }

    // Note: this.updated(changedProperties) is invoked by Lit's performUpdate()
    // inside _$AE(changedProperties) after update() returns. It must not be called
    // inside update() to avoid duplicate lifecycle callbacks.

    let mut params_vec = ArenaVec::new_in(ast);
    params_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "changedProperties", ast),
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
            params_vec,
            None,
            ast,
        ),
        None,
        Some(FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast)),
        ast,
    );

    Some(ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        PropertyKey::new_static_identifier(SPAN, "update", ast),
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

fn collect_classes_mut<'a, 'b>(stmts: &'b mut [Statement<'a>], out: &mut Vec<&'b mut Class<'a>>) {
    for stmt in stmts {
        match stmt {
            Statement::ClassDeclaration(class) => {
                out.push(class);
            }
            Statement::ExportDeclaration(export_decl) => match &mut export_decl.declaration {
                Declaration::ClassDeclaration(class) => {
                    out.push(class);
                }
                Declaration::VariableDeclaration(var_decl) => {
                    for decl in &mut var_decl.declarations {
                        if let Some(Expression::ClassExpression(class)) = &mut decl.init {
                            out.push(class);
                        }
                    }
                }
                _ => {}
            },
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

pub fn transform_code(source: &str, options: DomPathsOptions) -> DomPathsResult {
    let allocator = Allocator::default();
    let filename = options.filename.as_deref().unwrap_or("source.ts");
    let source_type = SourceType::from_path(filename).unwrap_or_default();
    let mut parsed = Parser::new(&allocator, source, source_type).parse();

    if parsed.program.body.is_empty() {
        return DomPathsResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            paths_count: 0,
            paths: Vec::new(),
        };
    }

    let scoping = SemanticBuilder::new()
        .build(&parsed.program)
        .semantic
        .into_scoping();
    let symbol_ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    let ast = AstBuilder::new(&allocator);
    let normalize_whitespace = options.normalize_whitespace.unwrap_or(true);
    let mut all_component_paths = Vec::new();
    let mut total_paths_count = 0;
    let mut transformed_components = 0;

    let mut classes = Vec::new();
    collect_classes_mut(&mut parsed.program.body, &mut classes);

    if classes.is_empty() {
        return DomPathsResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            paths_count: 0,
            paths: Vec::new(),
        };
    }

    for class in classes {
        // Skip if class does not extend LitElement / ReactiveElement
        if !symbol_ctx.prove_heritage(class).is_reactive() {
            continue;
        }

        // Skip if already has __litPartPaths
        let has_part_paths = class.body.body.iter().any(|elem| match elem {
            ClassElement::PropertyDefinition(prop) => {
                prop.r#static && prop.key.is_specific_static_name("__litPartPaths")
            }
            _ => false,
        });

        if has_part_paths {
            continue;
        }

        let mut collector = TemplateCollector {
            symbol_ctx: &symbol_ctx,
            templates: Vec::new(),
            compiled_templates_count: 0,
            in_render: false,
        };

        for elem in &class.body.body {
            match elem {
                ClassElement::MethodDefinition(method) => {
                    collector.visit_method_definition(method);
                }
                ClassElement::PropertyDefinition(prop) => {
                    collector.visit_property_definition(prop);
                }
                ClassElement::AccessorProperty(acc) => {
                    collector.visit_accessor_property(acc);
                }
                _ => {}
            }
        }

        // Multi-template safety: exactly 1 template with expressions is supported for class-level part paths.
        // If there are multiple templates with expressions (or templates already lowered by html-aot), bail out cleanly.
        if collector.compiled_templates_count > 0 || collector.templates.len() != 1 {
            continue;
        }

        let (quasis, _) = &collector.templates[0];
        let part_descriptors: Vec<PartDescriptor> =
            compute_template_parts(quasis, normalize_whitespace);

        if part_descriptors.is_empty() {
            continue;
        }

        let numeric_paths: Vec<Vec<u32>> =
            part_descriptors.iter().map(|p| p.path.clone()).collect();

        // If the fast update method cannot be built (e.g. unsupported parts, custom update),
        // bail out cleanly without injecting static __litPartPaths dead code.
        let Some(update_method) =
            try_build_dom_path_update_method(class, &part_descriptors, &symbol_ctx, &ast)
        else {
            continue;
        };

        total_paths_count += numeric_paths.len() as u32;
        transformed_components += 1;
        all_component_paths.push(numeric_paths);

        // Construct AST node for `static __litPartPaths = [ ... ];`
        let mut elements = ArenaVec::new_in(&ast);
        for part in &part_descriptors {
            let mut path_elements = ArenaVec::new_in(&ast);
            for idx in &part.path {
                path_elements.push(ArrayExpressionElement::from(
                    Expression::new_numeric_literal(
                        SPAN,
                        *idx as f64,
                        None,
                        NumberBase::Decimal,
                        &ast,
                    ),
                ));
            }
            elements.push(ArrayExpressionElement::from(
                Expression::new_array_expression(SPAN, path_elements, &ast),
            ));
        }

        let array_expr = Expression::new_array_expression(SPAN, elements, &ast);
        let key = PropertyKey::new_static_identifier(SPAN, "__litPartPaths", &ast);
        let prop_def = ClassElement::new_property_definition(
            SPAN,
            PropertyDefinitionType::PropertyDefinition,
            ArenaVec::new_in(&ast),
            key,
            None,
            Some(array_expr),
            false,
            true, // static = true
            false,
            false,
            false,
            false,
            false,
            None,
            &ast,
        );

        class.body.body.insert(0, prop_def);
        class.body.body.push(update_method);
    }

    if transformed_components == 0 {
        return DomPathsResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            paths_count: 0,
            paths: Vec::new(),
        };
    }

    let mut codegen_options = CodegenOptions::default();
    if options.sourcemap.unwrap_or(false)
        && let Some(ref filename) = options.filename
    {
        codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
    }

    let codegen_result = Codegen::new()
        .with_options(codegen_options)
        .build(&parsed.program);
    let map_json = codegen_result.map.map(|m| m.to_json_string());

    DomPathsResult {
        code: codegen_result.code,
        map: map_json,
        components_count: transformed_components,
        paths_count: total_paths_count,
        paths: all_component_paths,
    }
}
