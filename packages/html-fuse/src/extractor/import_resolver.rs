use oxc_ast::ast::{ImportDeclaration, ImportDeclarationSpecifier};
use oxc_semantic::{Scoping, SymbolId};
use std::collections::HashSet;

pub fn is_canonical_lit_specifier(src: &str) -> bool {
    src == "lit"
        || src.starts_with("lit/")
        || src == "lit-html"
        || src.starts_with("lit-html/")
        || src == "lit-element"
        || src.starts_with("lit-element/")
        || src.starts_with("@lit/")
}

pub struct ImportResolver {
    pub lit_html_symbols: HashSet<SymbolId>,
    pub lit_svg_symbols: HashSet<SymbolId>,
    pub lit_namespaces: HashSet<SymbolId>,
    pub html_svg_identifiers: HashSet<String>,
    pub has_imports: bool,
}

impl Default for ImportResolver {
    fn default() -> Self {
        Self::new()
    }
}

impl ImportResolver {
    pub fn new() -> Self {
        Self {
            lit_html_symbols: HashSet::new(),
            lit_svg_symbols: HashSet::new(),
            lit_namespaces: HashSet::new(),
            html_svg_identifiers: HashSet::new(),
            has_imports: false,
        }
    }

    pub fn process_import(&mut self, import_decl: &ImportDeclaration, scoping: &Scoping) {
        self.has_imports = true;
        let src = import_decl.source.value.as_str();
        if !is_canonical_lit_specifier(src) {
            return;
        }

        if let Some(specifiers) = &import_decl.specifiers {
            for spec in specifiers {
                match spec {
                    ImportDeclarationSpecifier::ImportSpecifier(named_spec) => {
                        let imported_name = named_spec.imported.name();
                        if imported_name == "html" || imported_name == "svg" {
                            let root = scoping.root_scope_id();
                            let sym_id = named_spec.local.symbol_id.get().or_else(|| {
                                scoping.get_binding(root, named_spec.local.name.as_str().into())
                            });
                            if let Some(sym) = sym_id {
                                self.lit_html_symbols.insert(sym);
                                if imported_name == "svg" {
                                    self.lit_svg_symbols.insert(sym);
                                }
                            }
                            self.html_svg_identifiers
                                .insert(named_spec.local.name.as_str().to_string());
                        }
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns_spec) => {
                        let root = scoping.root_scope_id();
                        let sym_id = ns_spec.local.symbol_id.get().or_else(|| {
                            scoping.get_binding(root, ns_spec.local.name.as_str().into())
                        });
                        if let Some(sym) = sym_id {
                            self.lit_namespaces.insert(sym);
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    pub fn is_target_tag(&self, tag_name: &str) -> bool {
        if self.html_svg_identifiers.contains(tag_name) {
            return true;
        }
        // Fallback only if the file has zero imports
        if !self.has_imports && (tag_name == "html" || tag_name == "svg") {
            return true;
        }
        false
    }
}
