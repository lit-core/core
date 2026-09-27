use oxc_allocator::ArenaVec;
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DirectiveKind {
    ClassMap,
    StyleMap,
    IfDefined,
    Guard,
    Repeat,
    Cache,
    Until,
    Live,
}

impl DirectiveKind {
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "classMap" => Some(Self::ClassMap),
            "styleMap" => Some(Self::StyleMap),
            "ifDefined" => Some(Self::IfDefined),
            "guard" => Some(Self::Guard),
            "repeat" => Some(Self::Repeat),
            "cache" => Some(Self::Cache),
            "until" => Some(Self::Until),
            "live" => Some(Self::Live),
            _ => None,
        }
    }
}

pub fn is_lit_import_source(src: &str) -> bool {
    src == "lit"
        || src.starts_with("lit/")
        || src == "lit-element"
        || src.starts_with("lit-element/")
        || src == "lit-html"
        || src.starts_with("lit-html/")
        || src.starts_with("@lit/")
}

pub fn is_lit_directive_source(src: &str) -> bool {
    src.contains("lit/directives/")
        || src.contains("lit-html/directives/")
        || src.contains("@lit/directive")
}

#[derive(Debug, Default)]
pub struct ImportContext {
    pub directive_bindings: HashMap<String, DirectiveKind>,
    pub lit_bindings: HashSet<String>,
    pub lit_sources: HashSet<String>,
}

impl ImportContext {
    pub fn scan<'a>(program: &Program<'a>) -> Self {
        let mut ctx = Self::default();

        for stmt in &program.body {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                let src = import_decl.source.value.as_str();
                let is_lit = is_lit_import_source(src);
                let is_directive = is_lit_directive_source(src);

                if is_lit || is_directive {
                    ctx.lit_sources.insert(src.to_string());
                }

                if let Some(specifiers) = &import_decl.specifiers {
                    for spec in specifiers {
                        match spec {
                            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                let imported_name = named.imported.name();
                                let local_name = named.local.name.as_str();

                                if is_directive || is_lit {
                                    if let Some(kind) = DirectiveKind::from_name(imported_name.as_str()) {
                                        ctx.directive_bindings.insert(local_name.to_string(), kind);
                                    }
                                }

                                if is_lit {
                                    ctx.lit_bindings.insert(local_name.to_string());
                                }
                            }
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => {
                                if is_lit {
                                    ctx.lit_bindings.insert(def.local.name.as_str().to_string());
                                }
                            }
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                if is_lit {
                                    ctx.lit_bindings.insert(ns.local.name.as_str().to_string());
                                }
                            }
                        }
                    }
                }
            }
        }

        ctx
    }

    pub fn has_lit_imports(&self) -> bool {
        !ctx_is_empty(self)
    }

    pub fn get_directive_kind(&self, name: &str) -> Option<DirectiveKind> {
        self.directive_bindings
            .get(name)
            .copied()
            .or_else(|| DirectiveKind::from_name(name))
    }
}

fn ctx_is_empty(ctx: &ImportContext) -> bool {
    ctx.lit_sources.is_empty() && ctx.directive_bindings.is_empty() && ctx.lit_bindings.is_empty()
}

pub fn clean_dead_imports<'a>(
    program: &mut Program<'a>,
    ast: &AstBuilder<'a>,
    used_identifiers: &HashSet<String>,
) {
    let mut retained_stmts = ArenaVec::new_in(ast);

    for mut stmt in program.body.drain(..) {
        if let Statement::ImportDeclaration(ref mut import_decl) = stmt {
            let src = import_decl.source.value.as_str();
            if is_lit_import_source(src) || is_lit_directive_source(src) {
                if let Some(ref mut specifiers) = import_decl.specifiers {
                    specifiers.retain(|spec| {
                        let local_name = match spec {
                            ImportDeclarationSpecifier::ImportSpecifier(named) => named.local.name.as_str(),
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => def.local.name.as_str(),
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => ns.local.name.as_str(),
                        };
                        used_identifiers.contains(local_name)
                    });

                    if specifiers.is_empty() {
                        continue;
                    }
                }
            }
        }
        retained_stmts.push(stmt);
    }

    program.body = retained_stmts;
}
