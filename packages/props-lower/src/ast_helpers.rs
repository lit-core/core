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

    /// Builds `this.prop = value;`
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

    /// Builds `left ?? right`
    pub fn nullish_coalescing(
        &self,
        left: Expression<'a>,
        right: Expression<'a>,
    ) -> Expression<'a> {
        Expression::new_logical_expression(SPAN, left, LogicalOperator::Coalesce, right, self.ast)
    }

    /// Builds `this.__prop ??= value`
    pub fn assign_nullish(
        &self,
        private_prop_name: &'a str,
        value: Expression<'a>,
    ) -> Expression<'a> {
        let target = AssignmentTarget::new_static_member_expression(
            SPAN,
            self.this_expr(),
            self.ident_name(private_prop_name),
            false,
            self.ast,
        );
        Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::LogicalNullish,
            target,
            value,
            self.ast,
        )
    }

    /// Builds `Class.createProperty("propName", options);`
    pub fn create_property_call(
        &self,
        class_expr: Expression<'a>,
        prop_name: &'a str,
        options: Option<Expression<'a>>,
    ) -> Statement<'a> {
        let callee = self.static_member(class_expr, "createProperty", false);
        let mut args = ArenaVec::new_in(self.ast);
        args.push(Argument::from(self.string_lit(prop_name)));
        if let Some(opt) = options {
            args.push(Argument::from(opt));
        }
        let call = self.call_expr(callee, args, false);
        self.expr_stmt(call)
    }

    /// Builds `customElements.define("tag-name", Class);`
    pub fn custom_elements_define(
        &self,
        tag_name: &'a str,
        class_expr: Expression<'a>,
    ) -> Statement<'a> {
        let custom_elements_ident = self.ident_ref("customElements");
        let callee = self.static_member(custom_elements_ident, "define", false);
        let mut args = ArenaVec::new_in(self.ast);
        args.push(Argument::from(self.string_lit(tag_name)));
        args.push(Argument::from(class_expr));
        let call = self.call_expr(callee, args, false);
        self.expr_stmt(call)
    }
}
