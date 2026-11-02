use lit_analysis::parts::PartDescriptor;
use oxc_allocator::{ArenaVec, Box as ArenaBox, CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::client_builder::ClientBuilder;
use crate::options::{ActionMetadata, LoaderMetadata};
use crate::symbol::ServerSymbolContext;

pub struct WorkerBuilder<'a> {
    pub ast: &'a AstBuilder<'a>,
    pub server_ctx: &'a ServerSymbolContext<'a>,
}

impl<'a> WorkerBuilder<'a> {
    pub fn new(ast: &'a AstBuilder<'a>, server_ctx: &'a ServerSymbolContext<'a>) -> Self {
        Self { ast, server_ctx }
    }

    /// Transforms a class definition for the Worker artifact by stripping server decorators
    /// while retaining all method bodies, and attaching static part metadata.
    pub fn transform_class_for_worker(
        &self,
        class: &Class<'a>,
        parts: &[PartDescriptor],
        part_deps: &[Vec<String>],
        template_id: &str,
        build_id: &str,
    ) -> ArenaBox<'a, Class<'a>> {
        let mut new_elements = ArenaVec::new_in(self.ast);

        for element in &class.body.body {
            match element {
                ClassElement::MethodDefinition(method) => {
                    let mut new_decorators = ArenaVec::new_in(self.ast);
                    for dec in &method.decorators {
                        if self
                            .server_ctx
                            .resolve_server_decorator(&dec.expression)
                            .is_none()
                        {
                            new_decorators.push(dec.clone_in(self.ast.allocator()));
                        }
                    }

                    let mut new_method = method.clone_in(self.ast.allocator());
                    new_method.decorators = new_decorators;
                    new_elements.push(ClassElement::MethodDefinition(new_method));
                }
                other => {
                    new_elements.push(other.clone_in(self.ast.allocator()));
                }
            }
        }

        let client_builder = ClientBuilder::new(self.ast, self.server_ctx);
        new_elements.push(client_builder.build_lit_parts_property(parts));
        new_elements.push(client_builder.build_lit_part_deps_property(part_deps));
        new_elements.push(client_builder.build_lit_template_id_property(template_id));
        new_elements.push(client_builder.build_lit_build_id_property(build_id));

        let mut new_class = class.clone_in(self.ast.allocator());
        new_class.body.body = new_elements;
        ArenaBox::new_in(new_class, self.ast)
    }

    /// Builds: `ClassName.__litBuildId = "<buildId>";`
    pub fn build_build_id_statement(&self, class_name: &'a str, build_id: &str) -> Statement<'a> {
        let target = AssignmentTarget::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, class_name, self.ast),
            IdentifierName::new(SPAN, "__litBuildId", self.ast),
            false,
            self.ast,
        );

        let assign_expr = Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            target,
            Expression::new_string_literal(
                SPAN,
                self.ast.allocator().alloc_str(build_id),
                None,
                self.ast,
            ),
            self.ast,
        );

        Statement::new_expression_statement(SPAN, assign_expr, self.ast)
    }

    /// Builds:
    /// ```js
    /// ClassName.__lit_actions = {
    ///   "<hash>": {
    ///     name: "<action_name>",
    ///     validate: __lit_validate_<action_name>,
    ///     writes: ["stock"]
    ///   }
    /// };
    /// ```
    pub fn build_actions_descriptor(
        &self,
        class_name: &'a str,
        actions: &[ActionMetadata],
    ) -> Statement<'a> {
        let mut action_entries = ArenaVec::new_in(self.ast);

        for act in actions {
            let hash_key = PropertyKey::StringLiteral(StringLiteral::boxed(
                SPAN,
                self.ast.allocator().alloc_str(&act.hash),
                None,
                self.ast,
            ));

            let mut act_props = ArenaVec::new_in(self.ast);

            // name: "<action_name>"
            let name_key =
                PropertyKey::StaticIdentifier(IdentifierName::boxed(SPAN, "name", self.ast));
            let name_val = Expression::new_string_literal(
                SPAN,
                self.ast.allocator().alloc_str(&act.name),
                None,
                self.ast,
            );
            act_props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                SPAN,
                PropertyKind::Init,
                name_key,
                name_val,
                false,
                false,
                false,
                self.ast,
            )));

            // validate: __lit_validate_<action_name>
            let val_key =
                PropertyKey::StaticIdentifier(IdentifierName::boxed(SPAN, "validate", self.ast));
            let val_fn_name = self
                .ast
                .allocator()
                .alloc_str(&format!("__lit_validate_{}", act.name));
            let val_fn_expr = Expression::new_identifier(SPAN, val_fn_name, self.ast);
            act_props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                SPAN,
                PropertyKind::Init,
                val_key,
                val_fn_expr,
                false,
                false,
                false,
                self.ast,
            )));

            // writes: ["prop1", ...]
            let writes_key =
                PropertyKey::StaticIdentifier(IdentifierName::boxed(SPAN, "writes", self.ast));
            let mut writes_arr = ArenaVec::new_in(self.ast);
            for w in &act.written_properties {
                writes_arr.push(ArrayExpressionElement::from(
                    Expression::new_string_literal(
                        SPAN,
                        self.ast.allocator().alloc_str(w),
                        None,
                        self.ast,
                    ),
                ));
            }
            let writes_val = Expression::new_array_expression(SPAN, writes_arr, self.ast);
            act_props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                SPAN,
                PropertyKind::Init,
                writes_key,
                writes_val,
                false,
                false,
                false,
                self.ast,
            )));

            let act_obj = Expression::new_object_expression(SPAN, act_props, self.ast);
            action_entries.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                SPAN,
                PropertyKind::Init,
                hash_key,
                act_obj,
                false,
                false,
                false,
                self.ast,
            )));
        }

        let actions_obj = Expression::new_object_expression(SPAN, action_entries, self.ast);

        let target = AssignmentTarget::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, class_name, self.ast),
            IdentifierName::new(SPAN, "__lit_actions", self.ast),
            false,
            self.ast,
        );

        let assign_expr = Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            target,
            actions_obj,
            self.ast,
        );

        Statement::new_expression_statement(SPAN, assign_expr, self.ast)
    }

    /// Builds:
    /// ```js
    /// ClassName.__lit_loaders = {
    ///   "load": {
    ///     writes: ["stock"]
    ///   }
    /// };
    /// ```
    pub fn build_loaders_descriptor(
        &self,
        class_name: &'a str,
        loaders: &[LoaderMetadata],
    ) -> Statement<'a> {
        let mut loader_entries = ArenaVec::new_in(self.ast);

        for ldr in loaders {
            let key = PropertyKey::StringLiteral(StringLiteral::boxed(
                SPAN,
                self.ast.allocator().alloc_str(&ldr.name),
                None,
                self.ast,
            ));

            let mut ldr_props = ArenaVec::new_in(self.ast);

            let writes_key =
                PropertyKey::StaticIdentifier(IdentifierName::boxed(SPAN, "writes", self.ast));
            let mut writes_arr = ArenaVec::new_in(self.ast);
            for w in &ldr.written_properties {
                writes_arr.push(ArrayExpressionElement::from(
                    Expression::new_string_literal(
                        SPAN,
                        self.ast.allocator().alloc_str(w),
                        None,
                        self.ast,
                    ),
                ));
            }
            let writes_val = Expression::new_array_expression(SPAN, writes_arr, self.ast);
            ldr_props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                SPAN,
                PropertyKind::Init,
                writes_key,
                writes_val,
                false,
                false,
                false,
                self.ast,
            )));

            let ldr_obj = Expression::new_object_expression(SPAN, ldr_props, self.ast);
            loader_entries.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                SPAN,
                PropertyKind::Init,
                key,
                ldr_obj,
                false,
                false,
                false,
                self.ast,
            )));
        }

        let loaders_obj = Expression::new_object_expression(SPAN, loader_entries, self.ast);

        let target = AssignmentTarget::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, class_name, self.ast),
            IdentifierName::new(SPAN, "__lit_loaders", self.ast),
            false,
            self.ast,
        );

        let assign_expr = Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            target,
            loaders_obj,
            self.ast,
        );

        Statement::new_expression_statement(SPAN, assign_expr, self.ast)
    }
}
