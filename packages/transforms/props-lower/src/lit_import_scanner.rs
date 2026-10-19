use oxc_ast::ast::*;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LitDecoratorKind {
    CustomElement,
    Property,
    State,
    Query,
    QueryAll,
    QueryAsync,
    QueryAssignedElements,
    QueryAssignedNodes,
    EventOptions,
    Localized,
}

impl LitDecoratorKind {
    pub fn from_canonical_name(name: &str) -> Option<Self> {
        match name {
            "customElement" => Some(Self::CustomElement),
            "property" => Some(Self::Property),
            "state" => Some(Self::State),
            "query" => Some(Self::Query),
            "queryAll" => Some(Self::QueryAll),
            "queryAsync" => Some(Self::QueryAsync),
            "queryAssignedElements" => Some(Self::QueryAssignedElements),
            "queryAssignedNodes" => Some(Self::QueryAssignedNodes),
            "eventOptions" => Some(Self::EventOptions),
            "localized" => Some(Self::Localized),
            _ => None,
        }
    }
}

pub fn is_lit_import(specifier: &str) -> bool {
    specifier == "lit"
        || specifier == "lit/decorators.js"
        || specifier == "lit/decorators"
        || specifier.starts_with("lit/")
        || specifier == "lit-element"
        || specifier == "lit-element/decorators.js"
        || specifier == "lit-element/decorators"
        || specifier.starts_with("lit-element/")
        || specifier == "@lit/reactive-element"
        || specifier.starts_with("@lit/reactive-element/decorators")
        || specifier == "@lit/localize"
}

pub fn is_helper_source(specifier: &str) -> bool {
    specifier == "tslib"
        || specifier.starts_with("tslib/")
        || specifier == "@swc/helpers"
        || specifier.starts_with("@swc/helpers/")
        || specifier.starts_with("@babel/runtime/helpers/")
        || specifier == "./decorate.js"
        || specifier == "../decorate.js"
        || specifier.ends_with("/decorate.js")
        || specifier.ends_with("/decorate")
}

pub fn is_canonical_helper_name(name: &str) -> bool {
    name == "__decorate"
        || name == "__decorateClass"
        || name == "_ts_decorate"
        || name == "decorate"
        || name == "applyDecoratedDescriptor"
}

pub fn is_canonical_metadata_name(name: &str) -> bool {
    name == "__metadata" || name == "metadata"
}

#[derive(Debug, Default)]
pub struct ImportContext {
    /// Maps local identifier name (as imported in the file) to its LitDecoratorKind
    pub decorator_bindings: HashMap<String, LitDecoratorKind>,
    /// Maps namespace import local name (e.g. `import * as lit from 'lit'`) to its import specifier
    pub namespace_bindings: HashMap<String, String>,
    /// Tracked decorator helper bindings (e.g. `import { __decorate as dec } from 'tslib'`)
    pub helper_bindings: HashSet<String>,
    /// Tracked metadata helper bindings (e.g. `import { __metadata as meta } from 'tslib'`)
    pub metadata_bindings: HashSet<String>,
    /// Tracked helper namespace bindings (e.g. `import * as tslib from 'tslib'`)
    pub helper_namespaces: HashSet<String>,
}

impl ImportContext {
    /// Scans program import and variable statements to populate recognized Lit decorator and helper bindings.
    pub fn scan<'a>(program: &Program<'a>) -> Self {
        let mut ctx = Self::default();

        for stmt in &program.body {
            match stmt {
                Statement::ImportDeclaration(import_decl) => {
                    let specifier = import_decl.source.value.as_str();

                    if is_lit_import(specifier) {
                        if let Some(specifiers) = &import_decl.specifiers {
                            for spec in specifiers {
                                match spec {
                                    ImportDeclarationSpecifier::ImportSpecifier(named_spec) => {
                                        let canonical_name = named_spec.imported.name();
                                        if let Some(kind) = LitDecoratorKind::from_canonical_name(
                                            canonical_name.as_str(),
                                        ) {
                                            let local_name =
                                                named_spec.local.name.as_str().to_string();
                                            ctx.decorator_bindings.insert(local_name, kind);
                                        }
                                    }
                                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(
                                        ns_spec,
                                    ) => {
                                        let local_name = ns_spec.local.name.as_str().to_string();
                                        ctx.namespace_bindings
                                            .insert(local_name, specifier.to_string());
                                    }
                                    _ => {}
                                }
                            }
                        }
                    } else if is_helper_source(specifier) {
                        if let Some(specifiers) = &import_decl.specifiers {
                            for spec in specifiers {
                                match spec {
                                    ImportDeclarationSpecifier::ImportSpecifier(named_spec) => {
                                        let canonical_name = named_spec.imported.name();
                                        if is_canonical_helper_name(canonical_name.as_str()) {
                                            ctx.helper_bindings
                                                .insert(named_spec.local.name.as_str().to_string());
                                        } else if is_canonical_metadata_name(
                                            canonical_name.as_str(),
                                        ) {
                                            ctx.metadata_bindings
                                                .insert(named_spec.local.name.as_str().to_string());
                                        }
                                    }
                                    ImportDeclarationSpecifier::ImportDefaultSpecifier(
                                        default_spec,
                                    ) => {
                                        ctx.helper_bindings
                                            .insert(default_spec.local.name.as_str().to_string());
                                    }
                                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(
                                        ns_spec,
                                    ) => {
                                        ctx.helper_namespaces
                                            .insert(ns_spec.local.name.as_str().to_string());
                                    }
                                }
                            }
                        }
                    }
                }
                Statement::VariableDeclaration(var_decl) => {
                    for decl in &var_decl.declarations {
                        if let BindingPattern::BindingIdentifier(id) = &decl.id {
                            if let Some(Expression::Identifier(init_id)) = &decl.init {
                                if is_canonical_helper_name(init_id.name.as_str())
                                    || ctx.helper_bindings.contains(init_id.name.as_str())
                                {
                                    ctx.helper_bindings.insert(id.name.as_str().to_string());
                                } else if is_canonical_metadata_name(init_id.name.as_str())
                                    || ctx.metadata_bindings.contains(init_id.name.as_str())
                                {
                                    ctx.metadata_bindings.insert(id.name.as_str().to_string());
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        ctx
    }

    pub fn has_lit_decorators(&self) -> bool {
        !self.decorator_bindings.is_empty() || !self.namespace_bindings.is_empty()
    }

    pub fn get_decorator_kind(&self, name: &str) -> Option<LitDecoratorKind> {
        self.decorator_bindings.get(name).copied()
    }

    pub fn get_member_decorator_kind(
        &self,
        object_name: &str,
        member_name: &str,
    ) -> Option<LitDecoratorKind> {
        if let Some(spec) = self.namespace_bindings.get(object_name) {
            if is_lit_import(spec) {
                return LitDecoratorKind::from_canonical_name(member_name);
            }
        }
        None
    }

    pub fn is_decorator_helper(&self, expr: &Expression) -> bool {
        match expr {
            Expression::Identifier(id) => {
                let name = id.name.as_str();
                self.helper_bindings.contains(name) || is_canonical_helper_name(name)
            }
            Expression::StaticMemberExpression(mem) => {
                let prop = mem.property.name.as_str();
                if let Expression::Identifier(obj) = &mem.object {
                    if self.helper_namespaces.contains(obj.name.as_str())
                        || obj.name == "tslib"
                        || obj.name == "babelHelpers"
                    {
                        return is_canonical_helper_name(prop);
                    }
                }
                is_canonical_helper_name(prop)
            }
            _ => false,
        }
    }

    pub fn is_metadata_helper(&self, expr: &Expression) -> bool {
        match expr {
            Expression::Identifier(id) => {
                let name = id.name.as_str();
                self.metadata_bindings.contains(name) || is_canonical_metadata_name(name)
            }
            Expression::StaticMemberExpression(mem) => {
                is_canonical_metadata_name(mem.property.name.as_str())
            }
            _ => false,
        }
    }
}
