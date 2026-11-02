use std::collections::{HashMap, HashSet};

use oxc_ast::ast::*;
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{Scoping, SymbolId};
use oxc_span::Span;

use crate::diagnostics::{DiagnosticCode, error_diagnostic};
use crate::options::ServerSplitDiagnostic;

const NODE_BUILTINS: &[&str] = &[
    "fs",
    "path",
    "crypto",
    "os",
    "stream",
    "net",
    "http",
    "https",
    "child_process",
    "url",
    "buffer",
    "util",
    "events",
    "zlib",
    "async_hooks",
    "dns",
    "tls",
    "cluster",
    "readline",
    "vm",
];

pub fn is_server_only_module_specifier(source: &str) -> bool {
    if source.starts_with("node:")
        || source.starts_with("cloudflare:")
        || source.starts_with("workerd:")
    {
        return true;
    }
    if source.starts_with("@cloudflare/") {
        return true;
    }
    if NODE_BUILTINS.contains(&source) {
        return true;
    }
    if source.contains(".server.")
        || source.ends_with(".server")
        || source.ends_with(".server.js")
        || source.ends_with(".server.ts")
    {
        return true;
    }
    false
}

pub struct IsolationProof<'a> {
    pub scoping: &'a Scoping,
    pub server_symbols: HashMap<SymbolId, (String, String)>, // sym_id -> (name, source_module)
    pub server_symbol_names: HashMap<String, String>,        // name -> source_module
    pub violations: Vec<ServerSplitDiagnostic>,
}

impl<'a> IsolationProof<'a> {
    pub fn new(program: &'a Program<'a>, scoping: &'a Scoping) -> Self {
        let mut server_symbols = HashMap::new();
        let mut server_symbol_names = HashMap::new();
        let mut violations = Vec::new();
        let root_scope = scoping.root_scope_id();

        for stmt in &program.body {
            match stmt {
                Statement::ImportDeclaration(import_decl) => {
                    let src = import_decl.source.value.as_str();
                    if is_server_only_module_specifier(src)
                        && let Some(specifiers) = &import_decl.specifiers
                    {
                        for spec in specifiers {
                            match spec {
                                ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                    let local_name = named.local.name.as_str().to_string();
                                    if let Some(sym_id) =
                                        named.local.symbol_id.get().or_else(|| {
                                            scoping.get_binding(
                                                root_scope,
                                                named.local.name.as_str().into(),
                                            )
                                        })
                                    {
                                        server_symbols
                                            .insert(sym_id, (local_name.clone(), src.to_string()));
                                    }
                                    server_symbol_names.insert(local_name, src.to_string());
                                }
                                ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => {
                                    let local_name = def.local.name.as_str().to_string();
                                    if let Some(sym_id) = def.local.symbol_id.get().or_else(|| {
                                        scoping
                                            .get_binding(root_scope, def.local.name.as_str().into())
                                    }) {
                                        server_symbols
                                            .insert(sym_id, (local_name.clone(), src.to_string()));
                                    }
                                    server_symbol_names.insert(local_name, src.to_string());
                                }
                                ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                    let local_name = ns.local.name.as_str().to_string();
                                    if let Some(sym_id) = ns.local.symbol_id.get().or_else(|| {
                                        scoping
                                            .get_binding(root_scope, ns.local.name.as_str().into())
                                    }) {
                                        server_symbols
                                            .insert(sym_id, (local_name.clone(), src.to_string()));
                                    }
                                    server_symbol_names.insert(local_name, src.to_string());
                                }
                            }
                        }
                    }
                }
                Statement::ExportAllDeclaration(export_all) => {
                    let src = export_all.source.value.as_str();
                    if is_server_only_module_specifier(src) {
                        violations.push(error_diagnostic(
                            DiagnosticCode::SE101,
                            format!(
                                "Security violation: server-only module '{}' cannot be re-exported from client-facing component module.",
                                src
                            ),
                            export_all.span,
                        ));
                    }
                }
                Statement::ExportFromDeclaration(export_from) => {
                    let src = export_from.source.value.as_str();
                    if is_server_only_module_specifier(src) {
                        violations.push(error_diagnostic(
                            DiagnosticCode::SE101,
                            format!(
                                "Security violation: server-only module '{}' cannot be re-exported from client-facing component module.",
                                src
                            ),
                            export_from.span,
                        ));
                        for spec in &export_from.specifiers {
                            server_symbol_names
                                .insert(spec.exported.name().to_string(), src.to_string());
                        }
                    }
                }
                Statement::ExportNamedDeclaration(export_named) => {
                    for spec in &export_named.specifiers {
                        let name = spec.local.name();
                        let is_server =
                            if let ModuleExportName::IdentifierReference(ident) = &spec.local {
                                if let Some(r_id) = ident.reference_id.get() {
                                    if let Some(sym_id) = scoping.get_reference(r_id).symbol_id() {
                                        server_symbols.get(&sym_id).cloned()
                                    } else {
                                        server_symbol_names
                                            .get(name.as_str())
                                            .map(|s| (name.to_string(), s.clone()))
                                    }
                                } else {
                                    server_symbol_names
                                        .get(name.as_str())
                                        .map(|s| (name.to_string(), s.clone()))
                                }
                            } else {
                                server_symbol_names
                                    .get(name.as_str())
                                    .map(|s| (name.to_string(), s.clone()))
                            };
                        if let Some((_, src)) = is_server {
                            violations.push(error_diagnostic(
                                DiagnosticCode::SE101,
                                format!(
                                    "Security violation: server-only binding '{}' from '{}' cannot be exported from client-facing component module.",
                                    name, src
                                ),
                                spec.span,
                            ));
                        }
                    }
                }
                _ => {}
            }
        }

        Self {
            scoping,
            server_symbols,
            server_symbol_names,
            violations,
        }
    }

    /// Records an imported symbol used in @loader() or @action() as a server-only binding
    pub fn add_server_import(&mut self, sym_id: SymbolId, name: String, source_module: String) {
        self.server_symbols
            .insert(sym_id, (name.clone(), source_module.clone()));
        self.server_symbol_names.insert(name, source_module);
    }

    /// Records loader parameter names as server-bound bindings.
    pub fn add_loader_param(&mut self, param_name: &str) {
        self.server_symbol_names
            .insert(param_name.to_string(), "@loader() parameter".to_string());
    }

    /// Audits top-level module statements outside the component class.
    pub fn audit_module_statements(&mut self, program: &'a Program<'a>, target_cls_idx: usize) {
        for (idx, stmt) in program.body.iter().enumerate() {
            if idx == target_cls_idx || matches!(stmt, Statement::ImportDeclaration(_)) {
                continue;
            }
            let mut visitor = ClientScopeVisitor {
                proof: self,
                in_render: false,
            };
            visitor.visit_statement(stmt);
        }
    }

    /// Checks if a statement directly references any server-only symbol.
    pub fn statement_references_server(&self, stmt: &Statement<'a>) -> bool {
        struct CheckVisitor<'s, 'a> {
            proof: &'s IsolationProof<'a>,
            found: bool,
        }
        impl<'s, 'a> Visit<'a> for CheckVisitor<'s, 'a> {
            fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
                if let Some(r_id) = ident.reference_id.get() {
                    if let Some(sym_id) = self.proof.scoping.get_reference(r_id).symbol_id() {
                        if self.proof.server_symbols.contains_key(&sym_id) {
                            self.found = true;
                            return;
                        }
                    } else if self
                        .proof
                        .server_symbol_names
                        .contains_key(ident.name.as_str())
                    {
                        self.found = true;
                        return;
                    }
                } else if self
                    .proof
                    .server_symbol_names
                    .contains_key(ident.name.as_str())
                {
                    self.found = true;
                    return;
                }
                walk::walk_identifier_reference(self, ident);
            }
        }
        let mut v = CheckVisitor {
            proof: self,
            found: false,
        };
        v.visit_statement(stmt);
        v.found
    }

    /// Audits client class elements and statements to prove isolation.
    pub fn audit_class(
        &mut self,
        class: &'a Class<'a>,
        server_methods: &[crate::symbol::ExtractedServerMethod<'a>],
    ) {
        let server_method_spans: HashSet<Span> = server_methods.iter().map(|m| m.span).collect();

        for element in &class.body.body {
            match element {
                ClassElement::MethodDefinition(method) => {
                    let is_server = server_method_spans.contains(&method.span);
                    if is_server {
                        continue;
                    }

                    let mut visitor = ClientScopeVisitor {
                        proof: self,
                        in_render: method
                            .key
                            .static_name()
                            .map(|n| n == "render")
                            .unwrap_or(false),
                    };
                    visitor.visit_method_definition(method);
                }
                ClassElement::PropertyDefinition(prop) => {
                    let mut visitor = ClientScopeVisitor {
                        proof: self,
                        in_render: false,
                    };
                    visitor.visit_property_definition(prop);
                }
                ClassElement::AccessorProperty(acc) => {
                    let mut visitor = ClientScopeVisitor {
                        proof: self,
                        in_render: false,
                    };
                    visitor.visit_accessor_property(acc);
                }
                ClassElement::StaticBlock(block) => {
                    let mut visitor = ClientScopeVisitor {
                        proof: self,
                        in_render: false,
                    };
                    visitor.visit_static_block(block);
                }
                _ => {}
            }
        }
    }
}

struct ClientScopeVisitor<'s, 'a> {
    proof: &'s mut IsolationProof<'a>,
    in_render: bool,
}

impl<'s, 'a> Visit<'a> for ClientScopeVisitor<'s, 'a> {
    fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
        let name = ident.name.as_str();

        let mut violation_source = None;

        // 1. Check SymbolId
        if let Some(r_id) = ident.reference_id.get() {
            if let Some(sym_id) = self.proof.scoping.get_reference(r_id).symbol_id() {
                if let Some((_, src)) = self.proof.server_symbols.get(&sym_id) {
                    violation_source = Some(src.clone());
                }
            } else if let Some(src) = self.proof.server_symbol_names.get(name) {
                violation_source = Some(src.clone());
            }
        } else if let Some(src) = self.proof.server_symbol_names.get(name) {
            violation_source = Some(src.clone());
        }

        if let Some(source_mod) = violation_source {
            let context_desc = if self.in_render {
                "render()"
            } else {
                "client scope"
            };
            self.proof.violations.push(error_diagnostic(
                DiagnosticCode::SE101,
                format!(
                    "Security violation: identifier '{}' resolves to server-only binding from '{}', but is accessed within {}.",
                    name, source_mod, context_desc
                ),
                ident.span,
            ));
        }

        walk::walk_identifier_reference(self, ident);
    }
}
