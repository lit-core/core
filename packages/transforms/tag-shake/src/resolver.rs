use lit_analysis::{CanonicalHelperSymbol, CanonicalLitSymbol, SymbolProofContext};
use oxc_ast::ast::*;
use oxc_semantic::{Semantic, SymbolId};
use std::collections::HashSet;

pub struct SymbolResolver<'a> {
    pub semantic: &'a Semantic<'a>,
    pub program: &'a Program<'a>,
    pub symbol_ctx: SymbolProofContext<'a>,
}

#[derive(Debug, Clone)]
pub struct ImportLocation {
    pub import_stmt_index: usize,
    pub specifier_index: usize,
    pub specifier_name: String,
    pub source: String,
}

impl<'a> SymbolResolver<'a> {
    pub fn new(semantic: &'a Semantic<'a>, program: &'a Program<'a>, source_text: &'a str) -> Self {
        let scoping = semantic.scoping();
        let symbol_ctx = SymbolProofContext::scan(program, scoping, source_text);
        Self {
            semantic,
            program,
            symbol_ctx,
        }
    }

    /// Check whether an identifier reference refers to a class declaration extending
    /// a component base class or imported from a component module.
    pub fn is_component_reference(&self, ident: &IdentifierReference) -> bool {
        // 1. Check if imported from an external module
        if let Some(ref_id) = ident.reference_id.get() {
            if let Some(sym_id) = self.semantic.scoping().get_reference(ref_id).symbol_id() {
                if self.symbol_ctx.imported_classes.contains_key(&sym_id) {
                    return true;
                }
            }
        }
        if Self::find_import_location(self.program, ident.name.as_str()).is_some() {
            return true;
        }

        // 2. Check if declared as a class in the current program extending a component base class
        for stmt in &self.program.body {
            let class_opt = match stmt {
                Statement::ClassDeclaration(cls) => Some(cls.as_ref()),
                Statement::ExportDeclaration(exp) => {
                    if let Declaration::ClassDeclaration(cls) = &exp.declaration {
                        Some(cls.as_ref())
                    } else {
                        None
                    }
                }
                Statement::ExportDefaultDeclaration(exp) => {
                    if let ExportDefaultDeclarationKind::ClassDeclaration(cls) = &exp.declaration {
                        Some(cls.as_ref())
                    } else {
                        None
                    }
                }
                _ => None,
            };

            if let Some(cls) = class_opt {
                if let Some(cls_id) = &cls.id {
                    if cls_id.name == ident.name {
                        let proof = self.symbol_ctx.prove_heritage(cls);
                        if proof.is_reactive() || self.is_extends_html_element(cls) {
                            return true;
                        }
                    }
                }
            }
        }

        false
    }

    /// Check if a class explicitly extends global unshadowed HTMLElement.
    pub fn is_extends_html_element(&self, cls: &Class) -> bool {
        if let Some(ref heritage) = cls.heritage {
            match heritage.expression.without_parentheses() {
                Expression::Identifier(super_id) => {
                    super_id.name == "HTMLElement" && self.symbol_ctx.is_unresolved_global(super_id)
                }
                Expression::StaticMemberExpression(mem) if mem.property.name == "HTMLElement" => {
                    if let Expression::Identifier(obj_id) = mem.object.without_parentheses() {
                        (obj_id.name == "window"
                            || obj_id.name == "globalThis"
                            || obj_id.name == "self")
                            && self.symbol_ctx.is_unresolved_global(obj_id)
                    } else {
                        false
                    }
                }
                _ => false,
            }
        } else {
            false
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
        self.symbol_ctx.is_unresolved_global(ident)
    }

    /// Check if customElements refers to the global scope (not shadowed by local variable).
    pub fn is_global_custom_elements(&self) -> bool {
        self.is_global_symbol("customElements")
    }

    /// Check if an expression is a customElement decorator callee (supporting aliases and namespaces).
    pub fn is_custom_element_decorator(&self, callee: &Expression) -> bool {
        match callee.without_parentheses() {
            Expression::Identifier(id) => {
                if self.symbol_ctx.resolve_symbol(id)
                    == Some(CanonicalLitSymbol::CustomElementDecorator)
                {
                    true
                } else if id.name == "customElement" && self.symbol_ctx.is_unresolved_global(id) {
                    !self
                        .symbol_ctx
                        .lit_symbols
                        .values()
                        .any(|s| *s == CanonicalLitSymbol::CustomElementDecorator)
                } else {
                    false
                }
            }
            Expression::StaticMemberExpression(mem) if mem.property.name == "customElement" => {
                if let Expression::Identifier(obj_id) = mem.object.without_parentheses() {
                    self.symbol_ctx.resolve_symbol(obj_id) == Some(CanonicalLitSymbol::LitNamespace)
                } else {
                    false
                }
            }
            _ => false,
        }
    }

    /// Check if an identifier reference resolves to a decorator helper (__decorate, _ts_decorate, etc.).
    pub fn is_decorator_helper(&self, ident: &IdentifierReference) -> bool {
        matches!(
            self.symbol_ctx.resolve_helper_symbol(ident),
            Some(CanonicalHelperSymbol::Decorate | CanonicalHelperSymbol::DecorateClass)
        )
    }

    /// Check if an expression is a decorator helper callee (supporting aliases and member expressions).
    pub fn is_decorator_helper_callee(&self, callee: &Expression) -> bool {
        match callee.without_parentheses() {
            Expression::Identifier(ident) => self.is_decorator_helper(ident),
            Expression::StaticMemberExpression(mem) => {
                matches!(
                    SymbolProofContext::map_helper_named_import(mem.property.name.as_str()),
                    Some(CanonicalHelperSymbol::Decorate | CanonicalHelperSymbol::DecorateClass)
                )
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
