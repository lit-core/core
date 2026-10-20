use lit_analysis::symbol::{CanonicalHelperSymbol, SymbolProofContext};
use oxc_allocator::ArenaVec;
use oxc_ast::ast::*;
use oxc_semantic::Semantic;
use std::collections::HashSet;

pub fn is_identifier_referenced_semantically<'a>(semantic: &Semantic<'a>, name: &str) -> bool {
    let scoping = semantic.scoping();
    let root = scoping.root_scope_id();
    if let Some(sym) = scoping.get_binding(root, name.into()) {
        scoping.get_resolved_references(sym).count() > 0
    } else {
        scoping.root_unresolved_references().contains_key(name)
    }
}

pub fn strip_dead_decorator_helpers_flags<'a>(
    statements: &mut ArenaVec<'a, Statement<'a>>,
    decorate_used: bool,
    metadata_used: bool,
    helper_bindings: &HashSet<String>,
    metadata_bindings: &HashSet<String>,
) {
    if decorate_used && metadata_used {
        return;
    }

    statements.retain_mut(|stmt| match stmt {
        Statement::VariableDeclaration(var_decl) => {
            var_decl.declarations.retain(|decl| {
                if let BindingPattern::BindingIdentifier(id) = &decl.id {
                    let name = id.name.as_str();
                    let helper_kind = SymbolProofContext::map_helper_named_import(name);
                    let is_decorate = matches!(
                        helper_kind,
                        Some(
                            CanonicalHelperSymbol::Decorate | CanonicalHelperSymbol::DecorateClass
                        )
                    ) || helper_bindings.contains(name);
                    let is_metadata = matches!(helper_kind, Some(CanonicalHelperSymbol::Metadata))
                        || metadata_bindings.contains(name);
                    let remove = (!decorate_used && is_decorate) || (!metadata_used && is_metadata);
                    !remove
                } else {
                    true
                }
            });
            !var_decl.declarations.is_empty()
        }
        Statement::ImportDeclaration(import_decl) => {
            let is_helper_src =
                SymbolProofContext::is_decorator_helper_source(import_decl.source.value.as_str());
            if let Some(specifiers) = &mut import_decl.specifiers {
                specifiers.retain(|spec| match spec {
                    ImportDeclarationSpecifier::ImportSpecifier(s) => {
                        let name = s.local.name.as_str();
                        let imported_name = s.imported.name();
                        let helper_kind =
                            SymbolProofContext::map_helper_named_import(imported_name.as_str())
                                .or_else(|| SymbolProofContext::map_helper_named_import(name));
                        let is_decorate = (is_helper_src
                            && matches!(
                                helper_kind,
                                Some(
                                    CanonicalHelperSymbol::Decorate
                                        | CanonicalHelperSymbol::DecorateClass
                                )
                            ))
                            || helper_bindings.contains(name);
                        let is_metadata = (is_helper_src
                            && matches!(helper_kind, Some(CanonicalHelperSymbol::Metadata)))
                            || metadata_bindings.contains(name);
                        let remove =
                            (!decorate_used && is_decorate) || (!metadata_used && is_metadata);
                        !remove
                    }
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                        let name = s.local.name.as_str();
                        let is_decorate = is_helper_src || helper_bindings.contains(name);
                        !(!decorate_used && is_decorate)
                    }
                    _ => true,
                });
                !specifiers.is_empty()
            } else {
                true
            }
        }
        _ => true,
    });
}
