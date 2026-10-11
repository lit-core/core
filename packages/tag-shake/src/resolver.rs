use oxc_ast::ast::*;
use oxc_semantic::{Semantic, SymbolId};
use std::collections::HashSet;

pub struct SymbolResolver<'a> {
    pub semantic: &'a Semantic<'a>,
    pub custom_element_decorator_names: HashSet<String>,
    pub decorator_namespaces: HashSet<String>,
}

#[derive(Debug, Clone)]
pub struct ImportLocation {
    pub import_stmt_index: usize,
    pub specifier_index: usize,
    pub specifier_name: String,
    pub source: String,
}

pub fn is_lit_decorator_source(source: &str) -> bool {
    source == "lit/decorators.js"
        || source == "lit/decorators"
        || source == "lit"
        || source == "lit-element"
        || source == "lit-element/decorators.js"
        || source == "lit-element/decorators"
        || source.starts_with("lit/decorators/")
        || source.starts_with("@lit/reactive-element/decorators")
}

impl<'a> SymbolResolver<'a> {
    pub fn new(semantic: &'a Semantic<'a>, program: &Program) -> Self {
        let mut custom_element_decorator_names = HashSet::new();
        let mut decorator_namespaces = HashSet::new();

        for stmt in &program.body {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                let source = import_decl.source.value.as_str();
                if is_lit_decorator_source(source) {
                    if let Some(specifiers) = &import_decl.specifiers {
                        for spec in specifiers {
                            match spec {
                                ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                    if named.imported.name().as_str() == "customElement" {
                                        custom_element_decorator_names
                                            .insert(named.local.name.as_str().to_string());
                                    }
                                }
                                ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                    decorator_namespaces.insert(ns.local.name.as_str().to_string());
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }

        Self {
            semantic,
            custom_element_decorator_names,
            decorator_namespaces,
        }
    }

    /// Check if an identifier name refers to the global scope (not shadowed in root scope).
    pub fn is_global_symbol(&self, name: &str) -> bool {
        let scoping = self.semantic.scoping();
        let root = scoping.root_scope_id();
        scoping.get_binding(root, name.into()).is_none()
    }

    /// Check if an identifier reference refers to a global (not bound to any local symbol).
    pub fn is_global_reference(&self, ident: &IdentifierReference) -> bool {
        if let Some(ref_id) = ident.reference_id.get() {
            let reference = self.semantic.scoping().get_reference(ref_id);
            reference.symbol_id().is_none()
        } else {
            self.is_global_symbol(ident.name.as_str())
        }
    }

    /// Check if customElements refers to the global scope (not shadowed by local variable).
    pub fn is_global_custom_elements(&self) -> bool {
        self.is_global_symbol("customElements")
    }

    /// Check if an expression is a customElement decorator callee (supporting aliases and namespaces).
    pub fn is_custom_element_decorator(&self, callee: &Expression) -> bool {
        match callee {
            Expression::Identifier(id) => {
                if self
                    .custom_element_decorator_names
                    .contains(id.name.as_str())
                {
                    true
                } else if self.custom_element_decorator_names.is_empty()
                    && id.name == "customElement"
                {
                    self.is_global_reference(id)
                } else {
                    false
                }
            }
            Expression::StaticMemberExpression(mem) if mem.property.name == "customElement" => {
                if let Expression::Identifier(obj_id) = &mem.object {
                    self.decorator_namespaces.contains(obj_id.name.as_str())
                        || obj_id.name == "lit"
                        || obj_id.name == "decorators"
                } else {
                    false
                }
            }
            _ => false,
        }
    }

    /// Count references to a specific SymbolId inside an AST statement.
    pub fn count_symbol_references_in_statement(
        &self,
        stmt: &Statement,
        symbol_id: SymbolId,
    ) -> usize {
        struct SymbolRefCounter<'a> {
            scoping: &'a oxc_semantic::Scoping,
            symbol_id: SymbolId,
            count: usize,
        }

        impl<'a> oxc_ast_visit::Visit<'_> for SymbolRefCounter<'a> {
            fn visit_identifier_reference(&mut self, ident: &IdentifierReference) {
                if let Some(ref_id) = ident.reference_id.get() {
                    let reference = self.scoping.get_reference(ref_id);
                    if reference.symbol_id() == Some(self.symbol_id) {
                        self.count += 1;
                    }
                }
            }
        }

        use oxc_ast_visit::Visit;
        let mut counter = SymbolRefCounter {
            scoping: self.semantic.scoping(),
            symbol_id,
            count: 0,
        };
        counter.visit_statement(stmt);
        counter.count
    }

    /// Count references to a specific SymbolId inside an AST expression.
    pub fn count_symbol_references_in_expression(
        &self,
        expr: &Expression,
        symbol_id: SymbolId,
    ) -> usize {
        struct SymbolRefCounter<'a> {
            scoping: &'a oxc_semantic::Scoping,
            symbol_id: SymbolId,
            count: usize,
        }

        impl<'a> oxc_ast_visit::Visit<'_> for SymbolRefCounter<'a> {
            fn visit_identifier_reference(&mut self, ident: &IdentifierReference) {
                if let Some(ref_id) = ident.reference_id.get() {
                    let reference = self.scoping.get_reference(ref_id);
                    if reference.symbol_id() == Some(self.symbol_id) {
                        self.count += 1;
                    }
                }
            }
        }

        use oxc_ast_visit::Visit;
        let mut counter = SymbolRefCounter {
            scoping: self.semantic.scoping(),
            symbol_id,
            count: 0,
        };
        counter.visit_expression(expr);
        counter.count
    }

    /// Query whether a symbol is referenced anywhere in the program outside a set of excluded statements and decorators.
    pub fn is_symbol_referenced_outside_removals(
        &self,
        symbol_id: SymbolId,
        excluded_stmt_indices: &HashSet<usize>,
        excluded_decorators: &[(usize, usize)],
        program: &Program,
    ) -> bool {
        let scoping = self.semantic.scoping();
        let total_refs = scoping.get_resolved_references(symbol_id).count();
        if total_refs == 0 {
            return false;
        }

        let mut excluded_refs = 0;
        for &idx in excluded_stmt_indices {
            if let Some(stmt) = program.body.get(idx) {
                excluded_refs += self.count_symbol_references_in_statement(stmt, symbol_id);
            }
        }

        for &(stmt_idx, dec_idx) in excluded_decorators {
            if excluded_stmt_indices.contains(&stmt_idx) {
                continue;
            }
            if let Some(stmt) = program.body.get(stmt_idx) {
                let decorator = match stmt {
                    Statement::ClassDeclaration(cls) => cls.decorators.get(dec_idx),
                    Statement::ExportDeclaration(exp) => {
                        if let Declaration::ClassDeclaration(cls) = &exp.declaration {
                            cls.decorators.get(dec_idx)
                        } else {
                            None
                        }
                    }
                    Statement::ExportDefaultDeclaration(exp) => {
                        if let ExportDefaultDeclarationKind::ClassDeclaration(cls) =
                            &exp.declaration
                        {
                            cls.decorators.get(dec_idx)
                        } else {
                            None
                        }
                    }
                    _ => None,
                };
                if let Some(dec) = decorator {
                    excluded_refs +=
                        self.count_symbol_references_in_expression(&dec.expression, symbol_id);
                }
            }
        }

        total_refs > excluded_refs
    }

    /// Check if an identifier is exported from the module.
    pub fn is_identifier_exported(program: &Program, name: &str) -> bool {
        for stmt in &program.body {
            match stmt {
                Statement::ExportDeclaration(export_decl) => match &export_decl.declaration {
                    Declaration::ClassDeclaration(cls) => {
                        if let Some(id) = &cls.id {
                            if id.name.as_str() == name {
                                return true;
                            }
                        }
                    }
                    Declaration::VariableDeclaration(var_decl) => {
                        for decl in &var_decl.declarations {
                            if let BindingPattern::BindingIdentifier(id) = &decl.id {
                                if id.name.as_str() == name {
                                    return true;
                                }
                            }
                        }
                    }
                    _ => {}
                },
                Statement::ExportNamedDeclaration(export_decl) => {
                    for spec in &export_decl.specifiers {
                        if spec.local.name().as_str() == name {
                            return true;
                        }
                    }
                }
                Statement::ExportDefaultDeclaration(export_decl) => {
                    match &export_decl.declaration {
                        ExportDefaultDeclarationKind::Identifier(id) => {
                            if id.name.as_str() == name {
                                return true;
                            }
                        }
                        ExportDefaultDeclarationKind::ClassDeclaration(cls) => {
                            if let Some(id) = &cls.id {
                                if id.name.as_str() == name {
                                    return true;
                                }
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
        false
    }

    /// Locate where a component name is imported in the program.
    pub fn find_import_location(program: &Program, name: &str) -> Option<ImportLocation> {
        for (stmt_idx, stmt) in program.body.iter().enumerate() {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                if let Some(specifiers) = &import_decl.specifiers {
                    for (spec_idx, spec) in specifiers.iter().enumerate() {
                        if let ImportDeclarationSpecifier::ImportSpecifier(named) = spec {
                            if named.local.name.as_str() == name {
                                return Some(ImportLocation {
                                    import_stmt_index: stmt_idx,
                                    specifier_index: spec_idx,
                                    specifier_name: named.imported.name().as_str().to_string(),
                                    source: import_decl.source.value.as_str().to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
        None
    }
}
