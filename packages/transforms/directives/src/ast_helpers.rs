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

    pub fn number_lit(&self, val: f64) -> Expression<'a> {
        Expression::new_numeric_literal(SPAN, val, None, NumberBase::Decimal, self.ast)
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

    pub fn binary_plus(&self, left: Expression<'a>, right: Expression<'a>) -> Expression<'a> {
        Expression::new_binary_expression(SPAN, left, BinaryOperator::Addition, right, self.ast)
    }

    pub fn conditional_expr(
        &self,
        test: Expression<'a>,
        consequent: Expression<'a>,
        alternate: Expression<'a>,
    ) -> Expression<'a> {
        Expression::new_conditional_expression(SPAN, test, consequent, alternate, self.ast)
    }

    pub fn coalesce_expr(&self, left: Expression<'a>, right: Expression<'a>) -> Expression<'a> {
        Expression::new_logical_expression(SPAN, left, LogicalOperator::Coalesce, right, self.ast)
    }

    pub fn logical_and(&self, left: Expression<'a>, right: Expression<'a>) -> Expression<'a> {
        Expression::new_logical_expression(SPAN, left, LogicalOperator::And, right, self.ast)
    }

    pub fn binary_eq(&self, left: Expression<'a>, right: Expression<'a>) -> Expression<'a> {
        Expression::new_binary_expression(
            SPAN,
            left,
            BinaryOperator::StrictEquality,
            right,
            self.ast,
        )
    }
}
