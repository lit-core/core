use oxc_allocator::ArenaVec;
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

pub struct AstHelper<'a, 'b> {
    pub ast: &'b AstBuilder<'a>,
}

impl<'a, 'b> AstHelper<'a, 'b> {
    pub fn new(ast: &'b AstBuilder<'a>) -> Self {
        Self { ast }
    }

    pub fn ident_ref(&self, name: &'a str) -> Expression<'a> {
        Expression::new_identifier(SPAN, name, self.ast)
    }

    pub fn ident_name(&self, name: &'a str) -> IdentifierName<'a> {
        IdentifierName::new(SPAN, name, self.ast)
    }

    pub fn this_expr(&self) -> Expression<'a> {
        Expression::new_this_expression(SPAN, self.ast)
    }

    pub fn static_member(
        &self,
        object: Expression<'a>,
        property: &'a str,
        optional: bool,
    ) -> Expression<'a> {
        Expression::new_static_member_expression(
            SPAN,
            object,
            self.ident_name(property),
            optional,
            self.ast,
        )
    }

    pub fn computed_member(
        &self,
        object: Expression<'a>,
        property: Expression<'a>,
        optional: bool,
    ) -> Expression<'a> {
        Expression::new_computed_member_expression(SPAN, object, property, optional, self.ast)
    }

    pub fn call_expr(
        &self,
        callee: Expression<'a>,
        arguments: ArenaVec<'a, Argument<'a>>,
        optional: bool,
    ) -> Expression<'a> {
        Expression::new_call_expression(SPAN, callee, None, arguments, optional, self.ast)
    }

    pub fn string_lit(&self, val: &'a str) -> Expression<'a> {
        Expression::new_string_literal(SPAN, val, None, self.ast)
    }

    pub fn bool_lit(&self, val: bool) -> Expression<'a> {
        Expression::new_boolean_literal(SPAN, val, self.ast)
    }

    pub fn number_lit(&self, val: f64) -> Expression<'a> {
        Expression::new_numeric_literal(SPAN, val, None, NumberBase::Decimal, self.ast)
    }

    pub fn null_lit(&self) -> Expression<'a> {
        Expression::new_null_literal(SPAN, self.ast)
    }

    pub fn empty_array(&self) -> Expression<'a> {
        Expression::new_array_expression(SPAN, ArenaVec::new_in(self.ast), self.ast)
    }

    pub fn empty_object(&self) -> Expression<'a> {
        Expression::new_object_expression(SPAN, ArenaVec::new_in(self.ast), self.ast)
    }

    pub fn expr_stmt(&self, expr: Expression<'a>) -> Statement<'a> {
        Statement::new_expression_statement(SPAN, expr, self.ast)
    }

    pub fn this_prop_assign(&self, prop_name: &'a str, value: Expression<'a>) -> Statement<'a> {
        let target = AssignmentTarget::new_static_member_expression(
            SPAN,
            self.this_expr(),
            self.ident_name(prop_name),
            false,
            self.ast,
        );
        let assign = Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            target,
            value,
            self.ast,
        );
        self.expr_stmt(assign)
    }

    pub fn nullish_coalescing(
        &self,
        left: Expression<'a>,
        right: Expression<'a>,
    ) -> Expression<'a> {
        Expression::new_logical_expression(SPAN, left, LogicalOperator::Coalesce, right, self.ast)
    }

    /// Builds `const name = init;`
    pub fn const_declaration(&self, name: &'a str, init: Expression<'a>) -> Statement<'a> {
        let binding_ident = BindingPattern::new_binding_identifier(SPAN, name, self.ast);
        let mut decls = ArenaVec::new_in(self.ast);
        let decl = VariableDeclarator::new(SPAN, binding_ident, None, Some(init), false, self.ast);
        decls.push(decl);
        Statement::new_variable_declaration(
            SPAN,
            VariableDeclarationKind::Const,
            decls,
            false,
            self.ast,
        )
    }

    /// Builds `customElements.define("tag", Component);`
    pub fn define_custom_element(&self, tag: &'a str, comp_name: &'a str) -> Statement<'a> {
        let ce_ident = self.ident_ref("customElements");
        let define_member = self.static_member(ce_ident, "define", false);
        let mut args = ArenaVec::new_in(self.ast);
        args.push(Argument::from(self.string_lit(tag)));
        args.push(Argument::from(self.ident_ref(comp_name)));
        let call = self.call_expr(define_member, args, false);
        self.expr_stmt(call)
    }
}
