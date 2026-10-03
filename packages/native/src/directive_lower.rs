use crate::ast_helpers::AstHelper;
use crate::import_scanner::{DirectiveKind, ImportContext};
use oxc_allocator::{ArenaVec, CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

pub struct DirectiveLowerer<'a, 'b> {
    pub ast: &'b AstBuilder<'a>,
    pub helper: AstHelper<'a, 'b>,
    pub import_ctx: &'b ImportContext,
    pub used_nothing: bool,
    pub lowered_count: u32,
}

impl<'a, 'b> DirectiveLowerer<'a, 'b> {
    pub fn new(ast: &'b AstBuilder<'a>, import_ctx: &'b ImportContext) -> Self {
        Self {
            ast,
            helper: AstHelper::new(ast),
            import_ctx,
            used_nothing: false,
            lowered_count: 0,
        }
    }

    pub fn transform_class(&mut self, class: &mut Class<'a>) {
        for elem in &mut class.body.body {
            match elem {
                ClassElement::MethodDefinition(m) => {
                    if let Some(body) = &mut m.value.body {
                        for stmt in &mut body.statements {
                            self.transform_statement(stmt);
                        }
                    }
                }
                ClassElement::PropertyDefinition(prop) => {
                    if let Some(val) = &mut prop.value {
                        self.transform_expression(val);
                    }
                }
                _ => {}
            }
        }
    }

    pub fn transform_statement(&mut self, stmt: &mut Statement<'a>) {
        match stmt {
            Statement::ExpressionStatement(expr_stmt) => {
                self.transform_expression(&mut expr_stmt.expression);
            }
            Statement::ReturnStatement(ret) => {
                if let Some(arg) = &mut ret.argument {
                    self.transform_expression(arg);
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &mut var_decl.declarations {
                    if let Some(init) = &mut decl.init {
                        self.transform_expression(init);
                    }
                }
            }
            Statement::BlockStatement(block) => {
                for s in &mut block.body {
                    self.transform_statement(s);
                }
            }
            Statement::IfStatement(if_stmt) => {
                self.transform_expression(&mut if_stmt.test);
                self.transform_statement(&mut if_stmt.consequent);
                if let Some(alt) = &mut if_stmt.alternate {
                    self.transform_statement(alt);
                }
            }
            _ => {}
        }
    }

    pub fn transform_expression(&mut self, expr: &mut Expression<'a>) {
        // First recurse into children
        match expr {
            Expression::TaggedTemplateExpression(tag) => {
                for expr_in_template in &mut tag.quasi.expressions {
                    self.transform_expression(expr_in_template);
                }
            }
            Expression::CallExpression(call) => {
                for arg in &mut call.arguments {
                    if let Some(e) = arg.as_expression_mut() {
                        self.transform_expression(e);
                    }
                }
            }
            Expression::ArrayExpression(arr) => {
                for el in &mut arr.elements {
                    if let Some(e) = el.as_expression_mut() {
                        self.transform_expression(e);
                    }
                }
            }
            Expression::ObjectExpression(obj) => {
                for prop in &mut obj.properties {
                    if let ObjectPropertyKind::ObjectProperty(p) = prop {
                        self.transform_expression(&mut p.value);
                    }
                }
            }
            Expression::ConditionalExpression(cond) => {
                self.transform_expression(&mut cond.test);
                self.transform_expression(&mut cond.consequent);
                self.transform_expression(&mut cond.alternate);
            }
            Expression::LogicalExpression(logical) => {
                self.transform_expression(&mut logical.left);
                self.transform_expression(&mut logical.right);
            }
            Expression::BinaryExpression(binary) => {
                self.transform_expression(&mut binary.left);
                self.transform_expression(&mut binary.right);
            }
            Expression::UnaryExpression(unary) => {
                self.transform_expression(&mut unary.argument);
            }
            Expression::ParenthesizedExpression(paren) => {
                self.transform_expression(&mut paren.expression);
            }
            _ => {}
        }

        // Now check if this expression itself is a CallExpression targeting a directive
        if let Expression::CallExpression(call) = expr {
            if let Expression::Identifier(ident) = &call.callee {
                if let Some(directive) = self.import_ctx.get_directive_kind(&ident.name) {
                    if let Some(lowered) = self.lower_call(directive, call) {
                        *expr = lowered;
                        self.lowered_count += 1;
                    }
                }
            }
        }
    }

    fn lower_call(
        &mut self,
        kind: DirectiveKind,
        call: &CallExpression<'a>,
    ) -> Option<Expression<'a>> {
        match kind {
            DirectiveKind::IfDefined => {
                // ifDefined(val) -> (val ?? nothing)
                if let Some(first_arg) = call.arguments.first() {
                    if let Some(arg_expr) = first_arg.as_expression() {
                        self.used_nothing = true;
                        let cloned_arg = arg_expr.clone_in(self.ast.allocator());
                        let nothing_ref = self.helper.ident_ref("nothing");
                        let coalesced = self.helper.nullish_coalescing(cloned_arg, nothing_ref);
                        return Some(coalesced);
                    }
                }
            }
            DirectiveKind::ClassMap => {
                // classMap(obj)
                // If obj is an ObjectExpression { k1: v1, k2: v2 }, lower to:
                // [v1 && 'k1', v2 && 'k2'].filter(Boolean).join(' ')
                // Otherwise:
                // Object.keys(obj).filter((k) => obj[k]).join(' ')
                if let Some(first_arg) = call.arguments.first() {
                    if let Some(arg_expr) = first_arg.as_expression() {
                        if let Expression::ObjectExpression(obj) = arg_expr {
                            let mut elements = ArenaVec::new_in(self.ast);
                            for p in &obj.properties {
                                if let ObjectPropertyKind::ObjectProperty(prop) = p {
                                    let key_str = match &prop.key {
                                        PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
                                        PropertyKey::StringLiteral(s) => Some(s.value.as_str()),
                                        _ => None,
                                    };
                                    if let Some(k) = key_str {
                                        let val_cloned = prop.value.clone_in(self.ast.allocator());
                                        let key_lit = self.helper.string_lit(k);
                                        let logical_and = Expression::new_logical_expression(
                                            SPAN,
                                            val_cloned,
                                            LogicalOperator::And,
                                            key_lit,
                                            self.ast,
                                        );
                                        elements.push(ArrayExpressionElement::from(logical_and));
                                    }
                                }
                            }

                            if !elements.is_empty() {
                                // [elements].filter(Boolean).join(' ')
                                let arr =
                                    Expression::new_array_expression(SPAN, elements, self.ast);
                                let filter_member = self.helper.static_member(arr, "filter", false);
                                let mut filter_args = ArenaVec::new_in(self.ast);
                                filter_args.push(Argument::from(self.helper.ident_ref("Boolean")));
                                let filtered =
                                    self.helper.call_expr(filter_member, filter_args, false);

                                let join_member =
                                    self.helper.static_member(filtered, "join", false);
                                let mut join_args = ArenaVec::new_in(self.ast);
                                join_args.push(Argument::from(self.helper.string_lit(" ")));
                                let joined = self.helper.call_expr(join_member, join_args, false);
                                return Some(joined);
                            }
                        }

                        // Fallback: Object.entries(obj).filter(e => e[1]).map(e => e[0]).join(' ')
                        let obj_ident = self.helper.ident_ref("Object");
                        let entries_member = self.helper.static_member(obj_ident, "entries", false);
                        let mut entries_args = ArenaVec::new_in(self.ast);
                        entries_args.push(Argument::from(arg_expr.clone_in(self.ast.allocator())));
                        let entries_call =
                            self.helper.call_expr(entries_member, entries_args, false);

                        // .filter(e => e[1])
                        let filter_member =
                            self.helper.static_member(entries_call, "filter", false);
                        let e_ident = self.helper.ident_ref("e");
                        let num_1 = Expression::new_numeric_literal(
                            SPAN,
                            1.0,
                            None,
                            NumberBase::Decimal,
                            self.ast,
                        );
                        let e_1 = Expression::new_computed_member_expression(
                            SPAN, e_ident, num_1, false, self.ast,
                        );
                        let mut filter_params = ArenaVec::new_in(self.ast);
                        let filter_param_pat =
                            BindingPattern::new_binding_identifier(SPAN, "e", self.ast);
                        filter_params.push(FormalParameter::new_plain(
                            SPAN,
                            filter_param_pat,
                            self.ast,
                        ));
                        let filter_params_box = FormalParameters::boxed(
                            SPAN,
                            FormalParameterKind::FormalParameter,
                            filter_params,
                            None,
                            self.ast,
                        );
                        let filter_arrow = Expression::new_arrow_function_expression(
                            SPAN,
                            false,
                            None,
                            filter_params_box,
                            None,
                            ArrowFunctionBody::from(e_1),
                            self.ast,
                        );
                        let mut filter_args = ArenaVec::new_in(self.ast);
                        filter_args.push(Argument::from(filter_arrow));
                        let filtered = self.helper.call_expr(filter_member, filter_args, false);

                        // .map(e => e[0])
                        let map_member = self.helper.static_member(filtered, "map", false);
                        let e_ident2 = self.helper.ident_ref("e");
                        let num_0 = Expression::new_numeric_literal(
                            SPAN,
                            0.0,
                            None,
                            NumberBase::Decimal,
                            self.ast,
                        );
                        let e_0 = Expression::new_computed_member_expression(
                            SPAN, e_ident2, num_0, false, self.ast,
                        );
                        let mut map_params = ArenaVec::new_in(self.ast);
                        let map_param_pat =
                            BindingPattern::new_binding_identifier(SPAN, "e", self.ast);
                        map_params.push(FormalParameter::new_plain(SPAN, map_param_pat, self.ast));
                        let map_params_box = FormalParameters::boxed(
                            SPAN,
                            FormalParameterKind::FormalParameter,
                            map_params,
                            None,
                            self.ast,
                        );
                        let map_arrow = Expression::new_arrow_function_expression(
                            SPAN,
                            false,
                            None,
                            map_params_box,
                            None,
                            ArrowFunctionBody::from(e_0),
                            self.ast,
                        );
                        let mut map_args = ArenaVec::new_in(self.ast);
                        map_args.push(Argument::from(map_arrow));
                        let mapped = self.helper.call_expr(map_member, map_args, false);

                        // .join(' ')
                        let join_member = self.helper.static_member(mapped, "join", false);
                        let mut join_args = ArenaVec::new_in(self.ast);
                        join_args.push(Argument::from(self.helper.string_lit(" ")));
                        return Some(self.helper.call_expr(join_member, join_args, false));
                    }
                }
            }
            DirectiveKind::Guard if call.arguments.len() >= 2 => {
                // guard(deps, fn) -> fn()
                if let Some(fn_arg) = call.arguments.get(1).and_then(|a| a.as_expression()) {
                    let call_args = ArenaVec::new_in(self.ast);
                    return Some(self.helper.call_expr(
                        fn_arg.clone_in(self.ast.allocator()),
                        call_args,
                        false,
                    ));
                }
            }
            _ => {}
        }

        None
    }
}
