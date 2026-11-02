use std::collections::{HashMap, HashSet};

use lit_analysis::parts::{PartAddressing, PartDescriptor};
use oxc_allocator::{ArenaVec, Box as ArenaBox, CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_semantic::SymbolId;
use oxc_span::SPAN;

use crate::isolation::is_server_only_module_specifier;
use crate::options::ActionMetadata;
use crate::symbol::{ExtractedServerMethod, ServerDecoratorKind, ServerSymbolContext};

#[derive(Debug)]
pub struct CompiledEventDescriptor<'a> {
    pub path: Vec<u32>,
    pub event: String,
    pub action_hash: String,
    pub arg_expr: Option<Expression<'a>>,
}

pub struct ClientBuilder<'a> {
    pub ast: &'a AstBuilder<'a>,
    pub server_ctx: &'a ServerSymbolContext<'a>,
}

impl<'a> ClientBuilder<'a> {
    pub fn new(ast: &'a AstBuilder<'a>, server_ctx: &'a ServerSymbolContext<'a>) -> Self {
        Self { ast, server_ctx }
    }

    /// Determines if a class qualifies for zero-Lit pure DOM stub emission.
    pub fn is_zero_lit_eligible(
        &self,
        class: &Class<'a>,
        server_methods: &[ExtractedServerMethod<'a>],
    ) -> bool {
        let server_method_names: HashSet<&str> =
            server_methods.iter().map(|m| m.name.as_str()).collect();

        for element in &class.body.body {
            match element {
                ClassElement::PropertyDefinition(prop) => {
                    if !prop.decorators.is_empty() {
                        return false;
                    }
                }
                ClassElement::AccessorProperty(acc) => {
                    if !acc.decorators.is_empty() {
                        return false;
                    }
                }
                ClassElement::MethodDefinition(method) => {
                    let name = match &method.key {
                        PropertyKey::StaticIdentifier(id) => id.name.as_str(),
                        PropertyKey::StringLiteral(s) => s.value.as_str(),
                        _ => continue,
                    };

                    if name == "constructor" || name == "render" {
                        continue;
                    }
                    if server_method_names.contains(name) {
                        continue;
                    }

                    // Any client lifecycle or custom method prevents pure DOM stub
                    return false;
                }
                _ => {}
            }
        }

        true
    }

    /// Transforms a class definition for the Client artifact.
    #[allow(clippy::too_many_arguments)]
    pub fn transform_class_for_client(
        &self,
        class: &Class<'a>,
        server_methods: &[ExtractedServerMethod<'a>],
        action_map: &HashMap<String, ActionMetadata>,
        parts: &[PartDescriptor],
        part_deps: &[Vec<String>],
        template_id: &str,
        build_id: &str,
        event_descriptors: &[CompiledEventDescriptor<'a>],
        zero_lit: bool,
    ) -> ArenaBox<'a, Class<'a>> {
        let server_method_map: HashMap<&str, &ExtractedServerMethod<'a>> = server_methods
            .iter()
            .map(|m| (m.name.as_str(), m))
            .collect();

        let mut new_elements = ArenaVec::new_in(self.ast);
        let mut has_constructor = false;

        for element in &class.body.body {
            match element {
                ClassElement::MethodDefinition(method) => {
                    let name = match &method.key {
                        PropertyKey::StaticIdentifier(id) => id.name.as_str(),
                        PropertyKey::StringLiteral(s) => s.value.as_str(),
                        _ => continue,
                    };

                    if name == "constructor" {
                        has_constructor = true;
                        new_elements.push(element.clone_in(self.ast.allocator()));
                        continue;
                    }

                    // If zero-Lit, strip render() method from client bundle
                    if zero_lit && name == "render" {
                        continue;
                    }

                    if let Some(server_method) = server_method_map.get(name) {
                        match server_method.kind {
                            ServerDecoratorKind::Loader => {
                                // Strip loader methods completely from client!
                                continue;
                            }
                            ServerDecoratorKind::Action => {
                                // Replace action method body with RPC stub
                                if let Some(act_meta) = action_map.get(name) {
                                    let rpc_stub = self.build_action_rpc_method(
                                        method,
                                        &act_meta.hash,
                                        &server_method.params,
                                    );
                                    new_elements.push(ClassElement::MethodDefinition(rpc_stub));
                                }
                            }
                        }
                    } else {
                        // Retain non-server method in client
                        new_elements.push(element.clone_in(self.ast.allocator()));
                    }
                }
                ClassElement::PropertyDefinition(_) => {
                    // Retain property definitions in client
                    new_elements.push(element.clone_in(self.ast.allocator()));
                }
                other => {
                    new_elements.push(other.clone_in(self.ast.allocator()));
                }
            }
        }

        if zero_lit && !has_constructor {
            new_elements.insert(0, self.build_default_constructor());
        }

        if zero_lit {
            // Attach static __litParts
            new_elements.push(self.build_lit_parts_property(parts));

            // Attach static __litPartDeps
            new_elements.push(self.build_lit_part_deps_property(part_deps));

            // Attach static __litTemplateId
            new_elements.push(self.build_lit_template_id_property(template_id));

            // Attach static __litBuildId
            new_elements.push(self.build_lit_build_id_property(build_id));

            // If template has event bindings, emit connectedCallback calling __litBindEvents
            if !event_descriptors.is_empty() {
                let descriptors_array = self.build_event_descriptors_array(event_descriptors);
                new_elements.push(self.build_connected_callback(descriptors_array));
            }
        }

        let mut new_class = class.clone_in(self.ast.allocator());
        new_class.body.body = new_elements;

        if zero_lit {
            // Change extends LitElement -> extends HTMLElement
            new_class.heritage = Some(ClassHeritage {
                expression: Expression::new_identifier(SPAN, "HTMLElement", self.ast),
                type_arguments: None,
            });
            // Strip unbound class decorators
            new_class.decorators = ArenaVec::new_in(self.ast);
        }

        ArenaBox::new_in(new_class, self.ast)
    }

    /// Converts a PartDescriptor into an AST ObjectExpression.
    pub fn build_part_descriptor_ast(&self, part: &PartDescriptor) -> Expression<'a> {
        let mut props = ArenaVec::new_in(self.ast);

        // type: "ElementAnchored" | "SoleTextChild" | "RangeMarker"
        let type_key = PropertyKey::new_static_identifier(SPAN, "type", self.ast);
        let type_val = Expression::new_string_literal(
            SPAN,
            self.ast.allocator().alloc_str(part.addressing.type_name()),
            None,
            self.ast,
        );
        props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
            SPAN,
            PropertyKind::Init,
            type_key,
            type_val,
            false,
            false,
            false,
            self.ast,
        )));

        // kind: "element" | "sole-text" | "range"
        let kind_str = match &part.addressing {
            PartAddressing::ElementAnchored { .. } => "element",
            PartAddressing::SoleTextChild { .. } => "sole-text",
            PartAddressing::RangeMarker { .. } => "range",
        };
        let kind_key = PropertyKey::new_static_identifier(SPAN, "kind", self.ast);
        let kind_val = Expression::new_string_literal(
            SPAN,
            self.ast.allocator().alloc_str(kind_str),
            None,
            self.ast,
        );
        props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
            SPAN,
            PropertyKind::Init,
            kind_key,
            kind_val,
            false,
            false,
            false,
            self.ast,
        )));

        match &part.addressing {
            PartAddressing::ElementAnchored {
                path,
                target_tag,
                attr_name,
                prefix,
                ..
            } => {
                let path_key = PropertyKey::new_static_identifier(SPAN, "path", self.ast);
                let mut path_elems = ArenaVec::new_in(self.ast);
                for p in path {
                    path_elems.push(ArrayExpressionElement::from(
                        Expression::new_numeric_literal(
                            SPAN,
                            *p as f64,
                            None,
                            oxc_syntax::number::NumberBase::Decimal,
                            self.ast,
                        ),
                    ));
                }
                props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                    SPAN,
                    PropertyKind::Init,
                    path_key,
                    Expression::new_array_expression(SPAN, path_elems, self.ast),
                    false,
                    false,
                    false,
                    self.ast,
                )));

                if let Some(attr) = attr_name {
                    let attr_key = PropertyKey::new_static_identifier(SPAN, "attr", self.ast);
                    let attr_val = Expression::new_string_literal(
                        SPAN,
                        self.ast.allocator().alloc_str(attr),
                        None,
                        self.ast,
                    );
                    props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                        SPAN,
                        PropertyKind::Init,
                        attr_key,
                        attr_val,
                        false,
                        false,
                        false,
                        self.ast,
                    )));
                }

                if let Some(pref) = prefix {
                    let pref_key = PropertyKey::new_static_identifier(SPAN, "prefix", self.ast);
                    let pref_val = Expression::new_string_literal(
                        SPAN,
                        self.ast.allocator().alloc_str(pref),
                        None,
                        self.ast,
                    );
                    props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                        SPAN,
                        PropertyKind::Init,
                        pref_key,
                        pref_val,
                        false,
                        false,
                        false,
                        self.ast,
                    )));
                }

                if let Some(tag) = target_tag {
                    let tag_key = PropertyKey::new_static_identifier(SPAN, "targetTag", self.ast);
                    let tag_val = Expression::new_string_literal(
                        SPAN,
                        self.ast.allocator().alloc_str(tag),
                        None,
                        self.ast,
                    );
                    props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                        SPAN,
                        PropertyKind::Init,
                        tag_key,
                        tag_val,
                        false,
                        false,
                        false,
                        self.ast,
                    )));
                }
            }
            PartAddressing::SoleTextChild {
                parent_path,
                parent_tag,
            } => {
                let path_key = PropertyKey::new_static_identifier(SPAN, "path", self.ast);
                let mut path_elems = ArenaVec::new_in(self.ast);
                for p in parent_path {
                    path_elems.push(ArrayExpressionElement::from(
                        Expression::new_numeric_literal(
                            SPAN,
                            *p as f64,
                            None,
                            oxc_syntax::number::NumberBase::Decimal,
                            self.ast,
                        ),
                    ));
                }
                props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                    SPAN,
                    PropertyKind::Init,
                    path_key,
                    Expression::new_array_expression(SPAN, path_elems, self.ast),
                    false,
                    false,
                    false,
                    self.ast,
                )));

                if let Some(tag) = parent_tag {
                    let tag_key = PropertyKey::new_static_identifier(SPAN, "targetTag", self.ast);
                    let tag_val = Expression::new_string_literal(
                        SPAN,
                        self.ast.allocator().alloc_str(tag),
                        None,
                        self.ast,
                    );
                    props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                        SPAN,
                        PropertyKind::Init,
                        tag_key,
                        tag_val,
                        false,
                        false,
                        false,
                        self.ast,
                    )));
                }
            }
            PartAddressing::RangeMarker {
                name,
                start_path,
                parent_path,
            } => {
                let name_key = PropertyKey::new_static_identifier(SPAN, "name", self.ast);
                let name_val = Expression::new_string_literal(
                    SPAN,
                    self.ast.allocator().alloc_str(name),
                    None,
                    self.ast,
                );
                props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                    SPAN,
                    PropertyKind::Init,
                    name_key,
                    name_val,
                    false,
                    false,
                    false,
                    self.ast,
                )));

                let start_key = PropertyKey::new_static_identifier(SPAN, "startPath", self.ast);
                let mut start_elems = ArenaVec::new_in(self.ast);
                for p in start_path {
                    start_elems.push(ArrayExpressionElement::from(
                        Expression::new_numeric_literal(
                            SPAN,
                            *p as f64,
                            None,
                            oxc_syntax::number::NumberBase::Decimal,
                            self.ast,
                        ),
                    ));
                }
                props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                    SPAN,
                    PropertyKind::Init,
                    start_key,
                    Expression::new_array_expression(SPAN, start_elems, self.ast),
                    false,
                    false,
                    false,
                    self.ast,
                )));

                let parent_key = PropertyKey::new_static_identifier(SPAN, "parentPath", self.ast);
                let mut parent_elems = ArenaVec::new_in(self.ast);
                for p in parent_path {
                    parent_elems.push(ArrayExpressionElement::from(
                        Expression::new_numeric_literal(
                            SPAN,
                            *p as f64,
                            None,
                            oxc_syntax::number::NumberBase::Decimal,
                            self.ast,
                        ),
                    ));
                }
                props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                    SPAN,
                    PropertyKind::Init,
                    parent_key,
                    Expression::new_array_expression(SPAN, parent_elems, self.ast),
                    false,
                    false,
                    false,
                    self.ast,
                )));
            }
        }

        Expression::new_object_expression(SPAN, props, self.ast)
    }

    /// Builds `static __litParts = [ ... ];`
    pub fn build_lit_parts_property(&self, parts: &[PartDescriptor]) -> ClassElement<'a> {
        let mut arr_elems = ArenaVec::new_in(self.ast);
        for p in parts {
            arr_elems.push(ArrayExpressionElement::from(
                self.build_part_descriptor_ast(p),
            ));
        }
        let arr_expr = Expression::new_array_expression(SPAN, arr_elems, self.ast);
        let key = PropertyKey::new_static_identifier(SPAN, "__litParts", self.ast);
        ClassElement::new_property_definition(
            SPAN,
            PropertyDefinitionType::PropertyDefinition,
            ArenaVec::new_in(self.ast),
            key,
            None,
            Some(arr_expr),
            false,
            true, // static
            false,
            false,
            false,
            false,
            false,
            None,
            self.ast,
        )
    }

    /// Builds `static __litPartDeps = [ ... ];`
    pub fn build_lit_part_deps_property(&self, part_deps: &[Vec<String>]) -> ClassElement<'a> {
        let mut outer_elems = ArenaVec::new_in(self.ast);
        for deps in part_deps {
            let mut inner_elems = ArenaVec::new_in(self.ast);
            for d in deps {
                inner_elems.push(ArrayExpressionElement::from(
                    Expression::new_string_literal(
                        SPAN,
                        self.ast.allocator().alloc_str(d),
                        None,
                        self.ast,
                    ),
                ));
            }
            outer_elems.push(ArrayExpressionElement::from(
                Expression::new_array_expression(SPAN, inner_elems, self.ast),
            ));
        }
        let arr_expr = Expression::new_array_expression(SPAN, outer_elems, self.ast);
        let key = PropertyKey::new_static_identifier(SPAN, "__litPartDeps", self.ast);
        ClassElement::new_property_definition(
            SPAN,
            PropertyDefinitionType::PropertyDefinition,
            ArenaVec::new_in(self.ast),
            key,
            None,
            Some(arr_expr),
            false,
            true, // static
            false,
            false,
            false,
            false,
            false,
            None,
            self.ast,
        )
    }

    /// Builds `static __litTemplateId = "...";`
    pub fn build_lit_template_id_property(&self, template_id: &str) -> ClassElement<'a> {
        let key = PropertyKey::new_static_identifier(SPAN, "__litTemplateId", self.ast);
        let str_expr = Expression::new_string_literal(
            SPAN,
            self.ast.allocator().alloc_str(template_id),
            None,
            self.ast,
        );
        ClassElement::new_property_definition(
            SPAN,
            PropertyDefinitionType::PropertyDefinition,
            ArenaVec::new_in(self.ast),
            key,
            None,
            Some(str_expr),
            false,
            true, // static
            false,
            false,
            false,
            false,
            false,
            None,
            self.ast,
        )
    }

    /// Builds `static __litBuildId = "...";`
    pub fn build_lit_build_id_property(&self, build_id: &str) -> ClassElement<'a> {
        let key = PropertyKey::new_static_identifier(SPAN, "__litBuildId", self.ast);
        let str_expr = Expression::new_string_literal(
            SPAN,
            self.ast.allocator().alloc_str(build_id),
            None,
            self.ast,
        );
        ClassElement::new_property_definition(
            SPAN,
            PropertyDefinitionType::PropertyDefinition,
            ArenaVec::new_in(self.ast),
            key,
            None,
            Some(str_expr),
            false,
            true, // static
            false,
            false,
            false,
            false,
            false,
            None,
            self.ast,
        )
    }

    /// Builds event descriptors array expression `[ { path, event, actionHash, argExpr }, ... ]`
    pub fn build_event_descriptors_array(
        &self,
        event_descriptors: &[CompiledEventDescriptor<'a>],
    ) -> Expression<'a> {
        let mut arr_elems = ArenaVec::new_in(self.ast);
        for desc in event_descriptors {
            let mut props = ArenaVec::new_in(self.ast);

            // path: [0, 3]
            let path_key = PropertyKey::new_static_identifier(SPAN, "path", self.ast);
            let mut path_elems = ArenaVec::new_in(self.ast);
            for p in &desc.path {
                path_elems.push(ArrayExpressionElement::from(
                    Expression::new_numeric_literal(
                        SPAN,
                        *p as f64,
                        None,
                        oxc_syntax::number::NumberBase::Decimal,
                        self.ast,
                    ),
                ));
            }
            props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                SPAN,
                PropertyKind::Init,
                path_key,
                Expression::new_array_expression(SPAN, path_elems, self.ast),
                false,
                false,
                false,
                self.ast,
            )));

            // event: "click"
            let evt_key = PropertyKey::new_static_identifier(SPAN, "event", self.ast);
            let evt_val = Expression::new_string_literal(
                SPAN,
                self.ast.allocator().alloc_str(&desc.event),
                None,
                self.ast,
            );
            props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                SPAN,
                PropertyKind::Init,
                evt_key,
                evt_val,
                false,
                false,
                false,
                self.ast,
            )));

            // actionHash: "..."
            let hash_key = PropertyKey::new_static_identifier(SPAN, "actionHash", self.ast);
            let hash_val = Expression::new_string_literal(
                SPAN,
                self.ast.allocator().alloc_str(&desc.action_hash),
                None,
                self.ast,
            );
            props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                SPAN,
                PropertyKind::Init,
                hash_key,
                hash_val,
                false,
                false,
                false,
                self.ast,
            )));

            // argExpr: () => [ ... ]
            if let Some(arg_expr) = &desc.arg_expr {
                let arg_key = PropertyKey::new_static_identifier(SPAN, "argExpr", self.ast);
                props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                    SPAN,
                    PropertyKind::Init,
                    arg_key,
                    arg_expr.clone_in(self.ast.allocator()),
                    false,
                    false,
                    false,
                    self.ast,
                )));
            }

            arr_elems.push(ArrayExpressionElement::from(
                Expression::new_object_expression(SPAN, props, self.ast),
            ));
        }

        Expression::new_array_expression(SPAN, arr_elems, self.ast)
    }

    /// Builds:
    /// ```js
    /// connectedCallback() {
    ///   super.connectedCallback && super.connectedCallback();
    ///   const root = this.shadowRoot || this;
    ///   __litBindEvents(this, root, [ ... ]);
    /// }
    /// ```
    pub fn build_connected_callback(&self, descriptors_expr: Expression<'a>) -> ClassElement<'a> {
        let mut stmts = ArenaVec::new_in(self.ast);

        // super.connectedCallback && super.connectedCallback();
        let super_mem = Expression::new_static_member_expression(
            SPAN,
            Expression::new_super(SPAN, self.ast),
            IdentifierName::new(SPAN, "connectedCallback", self.ast),
            false,
            self.ast,
        );
        let super_call = Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_super(SPAN, self.ast),
                IdentifierName::new(SPAN, "connectedCallback", self.ast),
                false,
                self.ast,
            ),
            None,
            ArenaVec::new_in(self.ast),
            false,
            self.ast,
        );
        let logical = Expression::new_logical_expression(
            SPAN,
            super_mem,
            LogicalOperator::And,
            super_call,
            self.ast,
        );
        stmts.push(Statement::new_expression_statement(SPAN, logical, self.ast));

        // const root = this.shadowRoot || this;
        let this_shadow = Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, self.ast),
            IdentifierName::new(SPAN, "shadowRoot", self.ast),
            false,
            self.ast,
        );
        let root_init = Expression::new_logical_expression(
            SPAN,
            this_shadow,
            LogicalOperator::Or,
            Expression::new_this_expression(SPAN, self.ast),
            self.ast,
        );
        let mut decls = ArenaVec::new_in(self.ast);
        decls.push(VariableDeclarator::new(
            SPAN,
            BindingPattern::new_binding_identifier(SPAN, "root", self.ast),
            None,
            Some(root_init),
            false,
            self.ast,
        ));
        let var_decl = Declaration::new_variable_declaration(
            SPAN,
            VariableDeclarationKind::Const,
            decls,
            false,
            self.ast,
        );
        stmts.push(Statement::from(var_decl));

        // __litBindEvents(this, root, descriptors);
        let mut bind_args = ArenaVec::new_in(self.ast);
        bind_args.push(Argument::from(Expression::new_this_expression(
            SPAN, self.ast,
        )));
        bind_args.push(Argument::from(Expression::new_identifier(
            SPAN, "root", self.ast,
        )));
        bind_args.push(Argument::from(descriptors_expr));
        let bind_call = Expression::new_call_expression(
            SPAN,
            Expression::new_identifier(SPAN, "__litBindEvents", self.ast),
            None,
            bind_args,
            false,
            self.ast,
        );
        stmts.push(Statement::new_expression_statement(
            SPAN, bind_call, self.ast,
        ));

        let func_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(self.ast), stmts, self.ast);
        let formal_params = FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            ArenaVec::new_in(self.ast),
            None,
            self.ast,
        );
        let func = Function::boxed(
            SPAN,
            FunctionType::FunctionExpression,
            None,
            false,
            false,
            false,
            None,
            None,
            formal_params,
            None,
            Some(func_body),
            self.ast,
        );
        let ctor_key = PropertyKey::new_static_identifier(SPAN, "connectedCallback", self.ast);
        ClassElement::new_method_definition(
            SPAN,
            MethodDefinitionType::MethodDefinition,
            ArenaVec::new_in(self.ast),
            ctor_key,
            func,
            MethodDefinitionKind::Method,
            false,
            false,
            false,
            false,
            None,
            self.ast,
        )
    }

    /// Builds `customElements.define('tag-name', ClassName);` statement.
    pub fn build_custom_elements_define(&self, tag: &str, class_name: &str) -> Statement<'a> {
        let mut args = ArenaVec::new_in(self.ast);
        args.push(Argument::from(Expression::new_string_literal(
            SPAN,
            self.ast.allocator().alloc_str(tag),
            None,
            self.ast,
        )));
        args.push(Argument::from(Expression::new_identifier(
            SPAN,
            self.ast.allocator().alloc_str(class_name),
            self.ast,
        )));

        let call = Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "customElements", self.ast),
                IdentifierName::new(SPAN, "define", self.ast),
                false,
                self.ast,
            ),
            None,
            args,
            false,
            self.ast,
        );

        Statement::new_expression_statement(SPAN, call, self.ast)
    }

    /// Builds:
    /// ```js
    /// async methodName(p0, p1) {
    ///   return __litActionRpc(this, "<hash>", [p0, p1]);
    /// }
    /// ```
    fn build_action_rpc_method(
        &self,
        original_method: &ArenaBox<'a, MethodDefinition<'a>>,
        action_hash: &str,
        params: &[crate::symbol::ExtractedParam<'a>],
    ) -> ArenaBox<'a, MethodDefinition<'a>> {
        let mut rpc_args = ArenaVec::new_in(self.ast);

        // arg 0: this
        rpc_args.push(Argument::from(Expression::new_this_expression(
            SPAN, self.ast,
        )));

        // arg 1: "<hash>"
        rpc_args.push(Argument::from(Expression::new_string_literal(
            SPAN,
            self.ast.allocator().alloc_str(action_hash),
            None,
            self.ast,
        )));

        // arg 2: [param1, param2, ...]
        let mut params_array = ArenaVec::new_in(self.ast);
        for p in params {
            params_array.push(ArrayExpressionElement::from(Expression::new_identifier(
                SPAN,
                self.ast.allocator().alloc_str(&p.name),
                self.ast,
            )));
        }
        rpc_args.push(Argument::from(Expression::new_array_expression(
            SPAN,
            params_array,
            self.ast,
        )));

        let rpc_call = Expression::new_call_expression(
            SPAN,
            Expression::new_identifier(SPAN, "__litActionRpc", self.ast),
            None,
            rpc_args,
            false,
            self.ast,
        );

        let mut body_stmts = ArenaVec::new_in(self.ast);
        body_stmts.push(Statement::new_return_statement(
            SPAN,
            Some(rpc_call),
            self.ast,
        ));

        let func_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(self.ast), body_stmts, self.ast);

        let mut new_value = original_method.value.clone_in(self.ast.allocator());
        new_value.r#async = true;
        new_value.body = Some(func_body);

        let mut new_method = original_method.clone_in(self.ast.allocator());
        new_method.decorators = ArenaVec::new_in(self.ast); // strip decorators
        new_method.value = new_value;
        new_method
    }

    fn build_default_constructor(&self) -> ClassElement<'a> {
        let super_call = Expression::new_call_expression(
            SPAN,
            Expression::new_super(SPAN, self.ast),
            None,
            ArenaVec::new_in(self.ast),
            false,
            self.ast,
        );
        let mut stmts = ArenaVec::new_in(self.ast);
        stmts.push(Statement::new_expression_statement(
            SPAN, super_call, self.ast,
        ));

        let func_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(self.ast), stmts, self.ast);

        let formal_params = FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            ArenaVec::new_in(self.ast),
            None,
            self.ast,
        );

        let func = Function::boxed(
            SPAN,
            FunctionType::FunctionExpression,
            None,
            false,
            false,
            false,
            None,
            None,
            formal_params,
            None,
            Some(func_body),
            self.ast,
        );

        let ctor_key = PropertyKey::new_static_identifier(SPAN, "constructor", self.ast);
        ClassElement::new_method_definition(
            SPAN,
            MethodDefinitionType::MethodDefinition,
            ArenaVec::new_in(self.ast),
            ctor_key,
            func,
            MethodDefinitionKind::Constructor,
            false,
            false,
            false,
            false,
            None,
            self.ast,
        )
    }

    /// Injects client runtime import, optionally including __litBindEvents.
    pub fn build_client_rpc_import(&self, has_events: bool) -> Statement<'a> {
        let mut specifiers = ArenaVec::new_in(self.ast);
        specifiers.push(ImportDeclarationSpecifier::ImportSpecifier(
            ArenaBox::new_in(
                ImportSpecifier::new(
                    SPAN,
                    ModuleExportName::IdentifierName(IdentifierName::new(
                        SPAN,
                        "__litActionRpc",
                        self.ast,
                    )),
                    BindingIdentifier::new(SPAN, "__litActionRpc", self.ast),
                    ImportOrExportKind::Value,
                    self.ast,
                ),
                self.ast,
            ),
        ));

        if has_events {
            specifiers.push(ImportDeclarationSpecifier::ImportSpecifier(
                ArenaBox::new_in(
                    ImportSpecifier::new(
                        SPAN,
                        ModuleExportName::IdentifierName(IdentifierName::new(
                            SPAN,
                            "__litBindEvents",
                            self.ast,
                        )),
                        BindingIdentifier::new(SPAN, "__litBindEvents", self.ast),
                        ImportOrExportKind::Value,
                        self.ast,
                    ),
                    self.ast,
                ),
            ));
        }

        Statement::new_import_declaration(
            SPAN,
            Some(specifiers),
            StringLiteral::new(SPAN, "@lit-core/server-elements/client", None, self.ast),
            None,
            None,
            ImportOrExportKind::Value,
            self.ast,
        )
    }

    /// Prunes an import declaration based on remaining references in the client AST.
    pub fn prune_client_import(
        &self,
        import_decl: &ImportDeclaration<'a>,
        referenced_symbols: &HashSet<SymbolId>,
        unresolved_names: &HashSet<String>,
        zero_lit: bool,
    ) -> Option<Statement<'a>> {
        let src = import_decl.source.value.as_str();

        // 1. Inherently server-only modules are pruned unconditionally
        if is_server_only_module_specifier(src) {
            return None;
        }

        // 2. Side-effect imports without specifiers are preserved unless server-only
        let Some(specifiers) = &import_decl.specifiers else {
            return Some(Statement::ImportDeclaration(ArenaBox::new_in(
                import_decl.clone_in(self.ast.allocator()),
                self.ast,
            )));
        };

        // 3. Filter specifiers by remaining references
        let mut retained_specs = ArenaVec::new_in(self.ast);
        for spec in specifiers {
            let (sym_id, local_name, imported_name) = match spec {
                ImportDeclarationSpecifier::ImportSpecifier(named) => (
                    named.local.symbol_id.get().or_else(|| {
                        self.server_ctx.scoping.get_binding(
                            self.server_ctx.scoping.root_scope_id(),
                            named.local.name.as_str().into(),
                        )
                    }),
                    named.local.name.as_str(),
                    Some(named.imported.name().as_str()),
                ),
                ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => (
                    def.local.symbol_id.get().or_else(|| {
                        self.server_ctx.scoping.get_binding(
                            self.server_ctx.scoping.root_scope_id(),
                            def.local.name.as_str().into(),
                        )
                    }),
                    def.local.name.as_str(),
                    None,
                ),
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => (
                    ns.local.symbol_id.get().or_else(|| {
                        self.server_ctx.scoping.get_binding(
                            self.server_ctx.scoping.root_scope_id(),
                            ns.local.name.as_str().into(),
                        )
                    }),
                    ns.local.name.as_str(),
                    None,
                ),
            };

            // Server primitives (loader, action) from @lit-core/server-elements are never retained
            if (src == "@lit-core/server-elements" || src.starts_with("@lit-core/server-elements/"))
                && let Some(imp) = imported_name
                && (imp == "loader" || imp == "action")
            {
                continue;
            }

            // In zero-Lit mode, lit decorator/library imports are stripped unless explicitly referenced in retained client code
            if zero_lit
                && (src == "lit"
                    || src.starts_with("lit/")
                    || src == "lit-html"
                    || src == "lit-element")
            {
                let is_referenced = sym_id.is_some_and(|id| referenced_symbols.contains(&id))
                    || unresolved_names.contains(local_name);
                if !is_referenced {
                    continue;
                }
            }

            // Reference check: is this symbol referenced anywhere in the client AST?
            let is_referenced = sym_id.is_some_and(|id| referenced_symbols.contains(&id))
                || unresolved_names.contains(local_name);

            if is_referenced {
                retained_specs.push(spec.clone_in(self.ast.allocator()));
            }
        }

        if retained_specs.is_empty() {
            return None;
        }

        let mut new_decl = import_decl.clone_in(self.ast.allocator());
        new_decl.specifiers = Some(retained_specs);
        Some(Statement::ImportDeclaration(ArenaBox::new_in(
            new_decl, self.ast,
        )))
    }
}
