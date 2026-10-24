use lit_analysis::symbol::{CanonicalLitSymbol, SymbolProofContext};
use oxc_allocator::ArenaVec;
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;
use std::collections::HashSet;

pub fn clean_lit_import<'a>(
    import_decl: &mut ImportDeclaration<'a>,
    referenced_names: &HashSet<String>,
    decorator_local_names: &HashSet<String>,
    ast: &AstBuilder<'a>,
) -> bool {
    let specifier = import_decl.source.value.as_str();
    let is_canonical = SymbolProofContext::is_canonical_lit_specifier(specifier);
    let has_known_decorator = import_decl.specifiers.as_ref().is_some_and(|specs| {
        specs.iter().any(|s| match s {
            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                decorator_local_names.contains(named.local.name.as_str())
            }
            _ => false,
        })
    });
    if !is_canonical && !has_known_decorator {
        return true;
    }

    let Some(specifiers) = &mut import_decl.specifiers else {
        return true;
    };

    let old_specs = std::mem::replace(specifiers, ArenaVec::new_in(ast));
    let mut new_specs = ArenaVec::new_in(ast);

    for mut spec in old_specs {
        match &mut spec {
            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                let imported_name = named.imported.name();
                let local_name = named.local.name.as_str();
                if imported_name.as_str() == "localized"
                    && (is_canonical || decorator_local_names.contains(local_name))
                {
                    named.imported = ModuleExportName::IdentifierName(IdentifierName::new(
                        SPAN,
                        "updateWhenLocaleChanges",
                        ast,
                    ));
                    if local_name == "localized" {
                        named.local = BindingIdentifier::new(SPAN, "updateWhenLocaleChanges", ast);
                    }
                    new_specs.push(spec);
                } else if decorator_local_names.contains(local_name)
                    || (is_canonical && is_lit_decorator_name(specifier, imported_name.as_str()))
                {
                    // Only strip if NO references remain in the program!
                    if referenced_names.contains(local_name) {
                        new_specs.push(spec);
                    }
                } else {
                    new_specs.push(spec);
                }
            }
            _ => {
                new_specs.push(spec);
            }
        }
    }

    if new_specs.is_empty() {
        false
    } else {
        *specifiers = new_specs;
        true
    }
}

fn is_lit_decorator_name(specifier: &str, imported_name: &str) -> bool {
    matches!(
        SymbolProofContext::map_lit_named_import(specifier, imported_name),
        Some(
            CanonicalLitSymbol::PropertyDecorator
                | CanonicalLitSymbol::StateDecorator
                | CanonicalLitSymbol::CustomElementDecorator
                | CanonicalLitSymbol::QueryDecorator
                | CanonicalLitSymbol::QueryAllDecorator
                | CanonicalLitSymbol::QueryAsyncDecorator
                | CanonicalLitSymbol::QueryAssignedElementsDecorator
                | CanonicalLitSymbol::QueryAssignedNodesDecorator
                | CanonicalLitSymbol::EventOptionsDecorator
                | CanonicalLitSymbol::LocalizedDecorator
        )
    )
}
