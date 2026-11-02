use std::collections::HashMap;

use oxc_ast::ast::*;
use oxc_semantic::{Scoping, SymbolId};
use oxc_span::Span;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CanonicalServerSymbol {
    Loader,
    Action,
    ServerElement,
    ServerElementMixin,
    ServerNamespace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerDecoratorKind {
    Loader,
    Action,
}

#[derive(Debug, Clone)]
pub struct ExtractedParam<'a> {
    pub name: String,
    pub binding_names: Vec<String>,
    pub optional: bool,
    pub ts_type_annotation: Option<&'a TSTypeAnnotation<'a>>,
    pub span: Span,
}

#[derive(Debug, Clone)]
pub struct ExtractedServerMethod<'a> {
    pub kind: ServerDecoratorKind,
    pub name: String,
    pub is_async: bool,
    pub params: Vec<ExtractedParam<'a>>,
    pub span: Span,
    pub body_span: Option<Span>,
    pub method_def: &'a MethodDefinition<'a>,
}

pub struct ServerSymbolContext<'a> {
    pub scoping: &'a Scoping,
    pub server_symbols: HashMap<SymbolId, CanonicalServerSymbol>,
    pub server_import_sources: HashMap<SymbolId, String>,
}

impl<'a> ServerSymbolContext<'a> {
    pub fn scan(program: &'a Program<'a>, scoping: &'a Scoping) -> Self {
        let mut server_symbols = HashMap::new();
        let mut server_import_sources = HashMap::new();
        let root_scope = scoping.root_scope_id();

        for stmt in &program.body {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                let specifier = import_decl.source.value.as_str();
                let is_server_pkg = specifier == "@lit-core/server-elements"
                    || specifier.starts_with("@lit-core/server-elements/");
                if is_server_pkg && let Some(specifiers) = &import_decl.specifiers {
                    for spec in specifiers {
                        match spec {
                            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                let sym_id = named.local.symbol_id.get().or_else(|| {
                                    scoping
                                        .get_binding(root_scope, named.local.name.as_str().into())
                                });
                                if let Some(sym_id) = sym_id {
                                    let imported_name = named.imported.name();
                                    let canonical = match imported_name.as_str() {
                                        "loader" => Some(CanonicalServerSymbol::Loader),
                                        "action" => Some(CanonicalServerSymbol::Action),
                                        "ServerElement" => {
                                            Some(CanonicalServerSymbol::ServerElement)
                                        }
                                        "ServerElementMixin" => {
                                            Some(CanonicalServerSymbol::ServerElementMixin)
                                        }
                                        _ => None,
                                    };
                                    if let Some(c) = canonical {
                                        server_symbols.insert(sym_id, c);
                                        server_import_sources.insert(sym_id, specifier.to_string());
                                    }
                                }
                            }
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                let sym_id = ns.local.symbol_id.get().or_else(|| {
                                    scoping.get_binding(root_scope, ns.local.name.as_str().into())
                                });
                                if let Some(sym_id) = sym_id {
                                    server_symbols
                                        .insert(sym_id, CanonicalServerSymbol::ServerNamespace);
                                    server_import_sources.insert(sym_id, specifier.to_string());
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }

        Self {
            scoping,
            server_symbols,
            server_import_sources,
        }
    }

    /// Resolves an expression to check if it resolves to a @loader() or @action() decorator call.
    pub fn resolve_server_decorator(&self, expr: &Expression<'a>) -> Option<ServerDecoratorKind> {
        let inner = expr.without_parentheses();
        if let Expression::CallExpression(call) = inner {
            let callee = call.callee.without_parentheses();
            match callee {
                Expression::Identifier(ident) => {
                    let sym_id = ident
                        .reference_id
                        .get()
                        .and_then(|r_id| self.scoping.get_reference(r_id).symbol_id())
                        .or_else(|| {
                            self.scoping.get_binding(
                                self.scoping.root_scope_id(),
                                ident.name.as_str().into(),
                            )
                        });

                    if let Some(sym_id) = sym_id {
                        match self.server_symbols.get(&sym_id) {
                            Some(CanonicalServerSymbol::Loader) => {
                                return Some(ServerDecoratorKind::Loader);
                            }
                            Some(CanonicalServerSymbol::Action) => {
                                return Some(ServerDecoratorKind::Action);
                            }
                            _ => {}
                        }
                    }
                }
                Expression::StaticMemberExpression(mem) => {
                    if let Expression::Identifier(obj_ident) = mem.object.without_parentheses() {
                        let obj_sym = obj_ident
                            .reference_id
                            .get()
                            .and_then(|r_id| self.scoping.get_reference(r_id).symbol_id())
                            .or_else(|| {
                                self.scoping.get_binding(
                                    self.scoping.root_scope_id(),
                                    obj_ident.name.as_str().into(),
                                )
                            });

                        if let Some(obj_sym) = obj_sym
                            && let Some(CanonicalServerSymbol::ServerNamespace) =
                                self.server_symbols.get(&obj_sym)
                        {
                            match mem.property.name.as_str() {
                                "loader" => return Some(ServerDecoratorKind::Loader),
                                "action" => return Some(ServerDecoratorKind::Action),
                                _ => {}
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        None
    }

    /// Extracts decorated server methods from a class declaration.
    pub fn extract_server_methods(&self, class: &'a Class<'a>) -> Vec<ExtractedServerMethod<'a>> {
        let mut results = Vec::new();

        for element in &class.body.body {
            if let ClassElement::MethodDefinition(method) = element {
                let mut method_kind = None;

                // 1. Direct decorators on the method
                for dec in &method.decorators {
                    if let Some(kind) = self.resolve_server_decorator(&dec.expression) {
                        method_kind = Some(kind);
                        break;
                    }
                }

                if let Some(kind) = method_kind {
                    let name = match &method.key {
                        PropertyKey::StaticIdentifier(id) => id.name.as_str().to_string(),
                        PropertyKey::StringLiteral(s) => s.value.as_str().to_string(),
                        _ => continue,
                    };

                    let is_async = method.value.r#async;
                    let body_span = method.value.body.as_ref().map(|b| b.span);

                    let mut params = Vec::new();
                    for param in &method.value.params.items {
                        let mut binding_names = Vec::new();
                        extract_binding_names(&param.pattern, &mut binding_names);
                        let param_name = if let Some(first) = binding_names.first() {
                            first.clone()
                        } else {
                            "param".to_string()
                        };

                        let optional = param.optional
                            || matches!(&param.pattern, BindingPattern::AssignmentPattern(_));
                        let ts_type_annotation = param.type_annotation.as_deref();

                        params.push(ExtractedParam {
                            name: param_name,
                            binding_names,
                            optional,
                            ts_type_annotation,
                            span: param.span,
                        });
                    }

                    results.push(ExtractedServerMethod {
                        kind,
                        name,
                        is_async,
                        params,
                        span: method.span,
                        body_span,
                        method_def: method,
                    });
                }
            }
        }

        results
    }

    /// Extracts custom element tag name from class decorator or customElements.define call.
    pub fn find_tag_name(&self, program: &'a Program<'a>, class: &'a Class<'a>) -> Option<String> {
        let lit_sym_ctx = lit_analysis::symbol::SymbolProofContext::scan(program, self.scoping, "");

        // 1. Class decorators: @customElement('tag-name') via semantic proof
        for dec in &class.decorators {
            if let Some(tag) = lit_sym_ctx.is_class_custom_element_decorator_call(&dec.expression) {
                return Some(tag);
            }
        }

        // 2. customElements.define('tag-name', ClassName) at top level via semantic proof
        let class_sym = class.id.as_ref().and_then(|id| id.symbol_id.get());

        for stmt in &program.body {
            if let Statement::ExpressionStatement(expr_stmt) = stmt
                && let Expression::CallExpression(call) = expr_stmt.expression.without_parentheses()
                && let Some(reg) = lit_sym_ctx.is_custom_elements_define(call)
            {
                let targets_class = match reg.class_expr.without_parentheses() {
                    Expression::Identifier(id) => {
                        let id_sym = id
                            .reference_id
                            .get()
                            .and_then(|r| self.scoping.get_reference(r).symbol_id())
                            .or_else(|| {
                                self.scoping.get_binding(
                                    self.scoping.root_scope_id(),
                                    id.name.as_str().into(),
                                )
                            });
                        id_sym.is_some() && id_sym == class_sym
                    }
                    _ => false,
                };
                if targets_class && let Some(tag) = reg.tag {
                    return Some(tag);
                }
            }
        }

        None
    }

    /// Checks if the target class is already registered via customElements.define
    pub fn is_class_registered_via_custom_elements_define(
        &self,
        program: &'a Program<'a>,
        class: &'a Class<'a>,
    ) -> bool {
        let lit_sym_ctx = lit_analysis::symbol::SymbolProofContext::scan(program, self.scoping, "");
        let class_sym = class.id.as_ref().and_then(|id| id.symbol_id.get());

        for stmt in &program.body {
            if let Statement::ExpressionStatement(expr_stmt) = stmt
                && let Expression::CallExpression(call) = expr_stmt.expression.without_parentheses()
                && let Some(reg) = lit_sym_ctx.is_custom_elements_define(call)
            {
                let targets_class = match reg.class_expr.without_parentheses() {
                    Expression::Identifier(id) => {
                        let id_sym = id
                            .reference_id
                            .get()
                            .and_then(|r| self.scoping.get_reference(r).symbol_id())
                            .or_else(|| {
                                self.scoping.get_binding(
                                    self.scoping.root_scope_id(),
                                    id.name.as_str().into(),
                                )
                            });
                        id_sym.is_some() && id_sym == class_sym
                    }
                    _ => false,
                };
                if targets_class {
                    return true;
                }
            }
        }
        false
    }
}

fn extract_binding_names<'a>(pattern: &'a BindingPattern<'a>, out: &mut Vec<String>) {
    match pattern {
        BindingPattern::BindingIdentifier(id) => {
            out.push(id.name.as_str().to_string());
        }
        BindingPattern::ObjectPattern(obj) => {
            for prop in &obj.properties {
                extract_binding_names(&prop.value, out);
            }
            if let Some(rest) = &obj.rest {
                extract_binding_names(&rest.argument, out);
            }
        }
        BindingPattern::ArrayPattern(arr) => {
            for elem_pat in arr.elements.iter().flatten() {
                extract_binding_names(elem_pat, out);
            }
            if let Some(rest) = &arr.rest {
                extract_binding_names(&rest.argument, out);
            }
        }
        BindingPattern::AssignmentPattern(assign) => {
            extract_binding_names(&assign.left, out);
        }
    }
}
