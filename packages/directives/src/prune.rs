use oxc_allocator::{ArenaVec, Box as ArenaBox};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::import_scanner::{extract_directive_slug, is_directive_export_module};
use crate::transform::DirectiveLowerer;

pub fn prune_and_update_imports<'a>(
    program: &mut Program<'a>,
    lowerer: &DirectiveLowerer<'a, '_>,
    ast: &AstBuilder<'a>,
) {
    let scoping = lowerer.scoping;
    let root = scoping.root_scope_id();
    let mut new_body = ArenaVec::new_in(ast);
    let mut injected_nothing = false;

    for mut stmt in std::mem::replace(&mut program.body, ArenaVec::new_in(ast)) {
        if let Statement::ImportDeclaration(import_decl) = &mut stmt {
            let specifier = import_decl.source.value.as_str();

            // If it's a directive module: lit/directives/* or lit-html/directives/*
            if extract_directive_slug(specifier).is_some() {
                if let Some(specifiers) = &mut import_decl.specifiers {
                    // Filter out lowered specifiers
                    specifiers.retain(|spec| match spec {
                        ImportDeclarationSpecifier::ImportSpecifier(named) => {
                            let sym = named.local.symbol_id.get().or_else(|| {
                                scoping.get_binding(root, named.local.name.as_str().into())
                            });
                            if let Some(sym_id) = sym {
                                if lowerer.import_ctx.directive_symbols.contains_key(&sym_id) {
                                    let total_refs =
                                        scoping.get_resolved_references(sym_id).count();
                                    let lowered_refs = lowerer
                                        .lowered_symbol_refs
                                        .get(&sym_id)
                                        .copied()
                                        .unwrap_or(0);
                                    return !(lowered_refs > 0 && lowered_refs >= total_refs);
                                }
                            }
                            let local = named.local.name.as_str();
                            if let Some(kind) = lowerer.import_ctx.directive_bindings.get(local) {
                                let was_lowered = lowerer.directives_used.contains(kind.name());
                                return !was_lowered;
                            }
                            true
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                            let sym = ns.local.symbol_id.get().or_else(|| {
                                scoping.get_binding(root, ns.local.name.as_str().into())
                            });
                            if let Some(sym_id) = sym {
                                if lowerer.import_ctx.namespace_symbols.contains_key(&sym_id) {
                                    let total_refs =
                                        scoping.get_resolved_references(sym_id).count();
                                    let lowered_refs = lowerer
                                        .lowered_namespace_refs
                                        .get(&sym_id)
                                        .copied()
                                        .unwrap_or(0);
                                    return !(lowered_refs > 0 && lowered_refs >= total_refs);
                                }
                            }
                            let local = ns.local.name.as_str();
                            if let Some(kind) = lowerer.import_ctx.namespace_bindings.get(local) {
                                let was_lowered = lowerer.directives_used.contains(kind.name());
                                return !was_lowered;
                            }
                            true
                        }
                        _ => true,
                    });

                    if specifiers.is_empty() {
                        // Entire import declaration is now empty, prune it!
                        continue;
                    }
                }
            } else if is_directive_export_module(specifier) {
                if let Some(specifiers) = &mut import_decl.specifiers {
                    specifiers.retain(|spec| match spec {
                        ImportDeclarationSpecifier::ImportSpecifier(named) => {
                            let sym = named.local.symbol_id.get().or_else(|| {
                                scoping.get_binding(root, named.local.name.as_str().into())
                            });
                            if let Some(sym_id) = sym {
                                if lowerer.import_ctx.directive_symbols.contains_key(&sym_id) {
                                    let total_refs =
                                        scoping.get_resolved_references(sym_id).count();
                                    let lowered_refs = lowerer
                                        .lowered_symbol_refs
                                        .get(&sym_id)
                                        .copied()
                                        .unwrap_or(0);
                                    return !(lowered_refs > 0 && lowered_refs >= total_refs);
                                }
                            }
                            true
                        }
                        _ => true,
                    });
                }

                if lowerer.used_nothing
                    && !lowerer.import_ctx.has_nothing_imported
                    && !injected_nothing
                    && (specifier == "lit" || specifier == "lit-html")
                {
                    // Inject `nothing` into existing lit import
                    if let Some(specifiers) = &mut import_decl.specifiers {
                        let imported = ModuleExportName::new_identifier_name(SPAN, "nothing", ast);
                        let local = BindingIdentifier::new(SPAN, "nothing", ast);
                        let new_spec =
                            ImportDeclarationSpecifier::ImportSpecifier(ArenaBox::new_in(
                                ImportSpecifier::new(
                                    SPAN,
                                    imported,
                                    local,
                                    ImportOrExportKind::Value,
                                    ast,
                                ),
                                ast,
                            ));
                        specifiers.push(new_spec);
                        injected_nothing = true;
                    }
                }

                if let Some(specifiers) = &import_decl.specifiers {
                    if specifiers.is_empty() {
                        continue;
                    }
                }
            }
        }
        new_body.push(stmt);
    }

    // If `nothing` was used, not originally imported, and no existing `lit` import was found,
    // prepend `import { nothing } from 'lit';`
    if lowerer.used_nothing && !lowerer.import_ctx.has_nothing_imported && !injected_nothing {
        let imported = ModuleExportName::new_identifier_name(SPAN, "nothing", ast);
        let local = BindingIdentifier::new(SPAN, "nothing", ast);
        let specifier = ImportDeclarationSpecifier::ImportSpecifier(ArenaBox::new_in(
            ImportSpecifier::new(SPAN, imported, local, ImportOrExportKind::Value, ast),
            ast,
        ));
        let mut specifiers = ArenaVec::new_in(ast);
        specifiers.push(specifier);
        let source_lit = StringLiteral::new(SPAN, "lit", None, ast);
        let import_decl = Statement::new_import_declaration(
            SPAN,
            Some(specifiers),
            source_lit,
            None,
            None,
            ImportOrExportKind::Value,
            ast,
        );
        new_body.insert(0, import_decl);
    }

    program.body = new_body;
}
