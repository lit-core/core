use oxc_allocator::ArenaVec;
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_semantic::{Scoping, SymbolId};
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
    pub has_lit_imports: bool,
    pub directive_bindings: HashMap<String, DirectiveKind>,
    pub directive_symbols: HashMap<SymbolId, DirectiveKind>,
    pub lit_element_symbols: HashSet<SymbolId>,
    pub html_symbols: HashSet<SymbolId>,
    pub custom_element_symbols: HashSet<SymbolId>,
    pub property_symbols: HashSet<SymbolId>,
    pub state_symbols: HashSet<SymbolId>,
    pub other_decorator_symbols: HashSet<SymbolId>,
    pub lit_namespace_symbols: HashSet<SymbolId>,
    pub lit_element_names: HashSet<String>,
    pub html_names: HashSet<String>,
    pub custom_element_names: HashSet<String>,
    pub property_names: HashSet<String>,
    pub state_names: HashSet<String>,
    pub other_decorator_names: HashSet<String>,
    pub lit_namespace_names: HashSet<String>,
    pub lit_bindings: HashSet<String>,
    pub lit_sources: HashSet<String>,
}

impl ImportContext {
    pub fn scan<'a>(program: &Program<'a>, scoping: &Scoping) -> Self {
        let mut ctx = Self::default();
        let root = scoping.root_scope_id();

        for stmt in &program.body {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                let src = import_decl.source.value.as_str();
                let is_lit = is_lit_import_source(src);
                let is_directive = is_lit_directive_source(src);

                if is_lit || is_directive {
                    ctx.has_lit_imports = true;
                    ctx.lit_sources.insert(src.to_string());
                }

                if let Some(specifiers) = &import_decl.specifiers {
                    for spec in specifiers {
                        match spec {
                            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                let imported_name = named.imported.name();
                                let local_name = named.local.name.as_str();
                                let sym_id = named
                                    .local
                                    .symbol_id
                                    .get()
                                    .or_else(|| scoping.get_binding(root, local_name.into()));

                                if (is_directive || is_lit)
                                    && let Some(kind) =
                                        DirectiveKind::from_name(imported_name.as_str())
                                {
                                    if let Some(s) = sym_id {
                                        ctx.directive_symbols.insert(s, kind);
                                    }
                                    ctx.directive_bindings.insert(local_name.to_string(), kind);
                                }

                                if is_lit {
                                    ctx.lit_bindings.insert(local_name.to_string());
                                    match imported_name.as_str() {
                                        "LitElement" | "ReactiveElement" => {
                                            if let Some(s) = sym_id {
                                                ctx.lit_element_symbols.insert(s);
                                            }
                                            ctx.lit_element_names.insert(local_name.to_string());
                                        }
                                        "html" => {
                                            if let Some(s) = sym_id {
                                                ctx.html_symbols.insert(s);
                                            }
                                            ctx.html_names.insert(local_name.to_string());
                                        }
                                        "customElement" => {
                                            if let Some(s) = sym_id {
                                                ctx.custom_element_symbols.insert(s);
                                            }
                                            ctx.custom_element_names.insert(local_name.to_string());
                                        }
                                        "property" => {
                                            if let Some(s) = sym_id {
                                                ctx.property_symbols.insert(s);
                                            }
                                            ctx.property_names.insert(local_name.to_string());
                                        }
                                        "state" => {
                                            if let Some(s) = sym_id {
                                                ctx.state_symbols.insert(s);
                                            }
                                            ctx.state_names.insert(local_name.to_string());
                                        }
                                        "query"
                                        | "queryAll"
                                        | "queryAsync"
                                        | "queryAssignedElements"
                                        | "queryAssignedNodes"
                                        | "eventOptions" => {
                                            if let Some(s) = sym_id {
                                                ctx.other_decorator_symbols.insert(s);
                                            }
                                            ctx.other_decorator_names
                                                .insert(local_name.to_string());
                                        }
                                        _ => {
                                            if src.contains("decorator") {
                                                if let Some(s) = sym_id {
                                                    ctx.other_decorator_symbols.insert(s);
                                                }
                                                ctx.other_decorator_names
                                                    .insert(local_name.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => {
                                let local_name = def.local.name.as_str();
                                if is_lit {
                                    ctx.lit_bindings.insert(local_name.to_string());
                                }
                            }
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                let local_name = ns.local.name.as_str();
                                if is_lit {
                                    let sym_id =
                                        ns.local.symbol_id.get().or_else(|| {
                                            scoping.get_binding(root, local_name.into())
                                        });
                                    if let Some(s) = sym_id {
                                        ctx.lit_namespace_symbols.insert(s);
                                    }
                                    ctx.lit_namespace_names.insert(local_name.to_string());
                                    ctx.lit_bindings.insert(local_name.to_string());
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
        self.has_lit_imports
    }

    pub fn is_lit_element(&self, expr: &Expression, scoping: &Scoping) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                let sym_id = if let Some(ref_id) = ident.reference_id.get() {
                    scoping.get_reference(ref_id).symbol_id()
                } else {
                    let root = scoping.root_scope_id();
                    scoping.get_binding(root, ident.name.as_str().into())
                };

                if let Some(sym) = sym_id {
                    self.lit_element_symbols.contains(&sym)
                } else {
                    false
                }
            }
            Expression::StaticMemberExpression(mem) => {
                if (mem.property.name == "LitElement" || mem.property.name == "ReactiveElement")
                    && let Expression::Identifier(obj) = &mem.object
                {
                    let obj_sym = if let Some(ref_id) = obj.reference_id.get() {
                        scoping.get_reference(ref_id).symbol_id()
                    } else {
                        let root = scoping.root_scope_id();
                        scoping.get_binding(root, obj.name.as_str().into())
                    };

                    if let Some(sym) = obj_sym {
                        return self.lit_namespace_symbols.contains(&sym);
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn is_html_tag(&self, expr: &Expression, scoping: &Scoping) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                let sym_id = if let Some(ref_id) = ident.reference_id.get() {
                    scoping.get_reference(ref_id).symbol_id()
                } else {
                    let root = scoping.root_scope_id();
                    scoping.get_binding(root, ident.name.as_str().into())
                };

                if let Some(sym) = sym_id {
                    self.html_symbols.contains(&sym)
                } else {
                    false
                }
            }
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "html"
                    && let Expression::Identifier(obj) = &mem.object
                {
                    let obj_sym = if let Some(ref_id) = obj.reference_id.get() {
                        scoping.get_reference(ref_id).symbol_id()
                    } else {
                        let root = scoping.root_scope_id();
                        scoping.get_binding(root, obj.name.as_str().into())
                    };

                    if let Some(sym) = obj_sym {
                        return self.lit_namespace_symbols.contains(&sym);
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn is_custom_element_decorator(&self, expr: &Expression, scoping: &Scoping) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                let sym_id = if let Some(ref_id) = ident.reference_id.get() {
                    scoping.get_reference(ref_id).symbol_id()
                } else {
                    let root = scoping.root_scope_id();
                    scoping.get_binding(root, ident.name.as_str().into())
                };

                if let Some(sym) = sym_id {
                    self.custom_element_symbols.contains(&sym)
                } else {
                    false
                }
            }
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "customElement"
                    && let Expression::Identifier(obj) = &mem.object
                {
                    let obj_sym = if let Some(ref_id) = obj.reference_id.get() {
                        scoping.get_reference(ref_id).symbol_id()
                    } else {
                        let root = scoping.root_scope_id();
                        scoping.get_binding(root, obj.name.as_str().into())
                    };

                    if let Some(sym) = obj_sym {
                        return self.lit_namespace_symbols.contains(&sym);
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn is_property_decorator(&self, expr: &Expression, scoping: &Scoping) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                let sym_id = if let Some(ref_id) = ident.reference_id.get() {
                    scoping.get_reference(ref_id).symbol_id()
                } else {
                    let root = scoping.root_scope_id();
                    scoping.get_binding(root, ident.name.as_str().into())
                };

                if let Some(sym) = sym_id {
                    self.property_symbols.contains(&sym)
                } else {
                    false
                }
            }
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "property"
                    && let Expression::Identifier(obj) = &mem.object
                {
                    let obj_sym = if let Some(ref_id) = obj.reference_id.get() {
                        scoping.get_reference(ref_id).symbol_id()
                    } else {
                        let root = scoping.root_scope_id();
                        scoping.get_binding(root, obj.name.as_str().into())
                    };

                    if let Some(sym) = obj_sym {
                        return self.lit_namespace_symbols.contains(&sym);
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn is_state_decorator(&self, expr: &Expression, scoping: &Scoping) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                let sym_id = if let Some(ref_id) = ident.reference_id.get() {
                    scoping.get_reference(ref_id).symbol_id()
                } else {
                    let root = scoping.root_scope_id();
                    scoping.get_binding(root, ident.name.as_str().into())
                };

                if let Some(sym) = sym_id {
                    self.state_symbols.contains(&sym)
                } else {
                    false
                }
            }
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "state"
                    && let Expression::Identifier(obj) = &mem.object
                {
                    let obj_sym = if let Some(ref_id) = obj.reference_id.get() {
                        scoping.get_reference(ref_id).symbol_id()
                    } else {
                        let root = scoping.root_scope_id();
                        scoping.get_binding(root, obj.name.as_str().into())
                    };

                    if let Some(sym) = obj_sym {
                        return self.lit_namespace_symbols.contains(&sym);
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn is_other_lit_decorator(&self, expr: &Expression, scoping: &Scoping) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                let sym_id = if let Some(ref_id) = ident.reference_id.get() {
                    scoping.get_reference(ref_id).symbol_id()
                } else {
                    let root = scoping.root_scope_id();
                    scoping.get_binding(root, ident.name.as_str().into())
                };

                if let Some(sym) = sym_id {
                    self.other_decorator_symbols.contains(&sym)
                } else {
                    false
                }
            }
            Expression::StaticMemberExpression(mem) => {
                if let Expression::Identifier(obj) = &mem.object {
                    let obj_sym = if let Some(ref_id) = obj.reference_id.get() {
                        scoping.get_reference(ref_id).symbol_id()
                    } else {
                        let root = scoping.root_scope_id();
                        scoping.get_binding(root, obj.name.as_str().into())
                    };

                    if let Some(sym) = obj_sym {
                        return self.lit_namespace_symbols.contains(&sym);
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn get_directive_kind(&self, name: &str) -> Option<DirectiveKind> {
        self.directive_bindings.get(name).copied()
    }

    pub fn get_directive_kind_by_expr(
        &self,
        expr: &Expression,
        scoping: &Scoping,
    ) -> Option<DirectiveKind> {
        match expr {
            Expression::Identifier(ident) => {
                let sym_id = if let Some(ref_id) = ident.reference_id.get() {
                    scoping.get_reference(ref_id).symbol_id()
                } else {
                    let root = scoping.root_scope_id();
                    scoping.get_binding(root, ident.name.as_str().into())
                };

                if let Some(sym) = sym_id {
                    self.directive_symbols.get(&sym).copied()
                } else {
                    self.directive_bindings.get(ident.name.as_str()).copied()
                }
            }
            _ => None,
        }
    }
}

pub fn clean_dead_imports<'a>(program: &mut Program<'a>, ast: &AstBuilder<'a>) {
    use oxc_ast_visit::Visit;

    struct UsedIdentifierVisitor {
        used: HashSet<String>,
    }

    impl<'a> Visit<'a> for UsedIdentifierVisitor {
        fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
            self.used.insert(ident.name.as_str().to_string());
        }

        fn visit_export_specifier(&mut self, spec: &ExportSpecifier<'a>) {
            self.used.insert(spec.local.name().as_str().to_string());
        }
    }

    let mut visitor = UsedIdentifierVisitor {
        used: HashSet::new(),
    };
    for stmt in &program.body {
        if !matches!(stmt, Statement::ImportDeclaration(_)) {
            visitor.visit_statement(stmt);
        }
    }
    let used_names = visitor.used;

    let old_body = std::mem::replace(&mut program.body, ArenaVec::new_in(ast));
    let mut retained_stmts = ArenaVec::new_in(ast);

    for mut stmt in old_body {
        if let Statement::ImportDeclaration(ref mut import_decl) = stmt {
            let src = import_decl.source.value.as_str();
            let is_cleanable = is_lit_import_source(src) || is_lit_directive_source(src);
            if is_cleanable && let Some(ref mut specifiers) = import_decl.specifiers {
                specifiers.retain(|spec| {
                    let local_name = match spec {
                        ImportDeclarationSpecifier::ImportSpecifier(named) => {
                            named.local.name.as_str()
                        }
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => {
                            def.local.name.as_str()
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                            ns.local.name.as_str()
                        }
                    };
                    used_names.contains(local_name)
                });

                if specifiers.is_empty() {
                    continue;
                }
            }
        }
        retained_stmts.push(stmt);
    }

    program.body = retained_stmts;
}
