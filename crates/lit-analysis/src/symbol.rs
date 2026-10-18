use oxc_ast::ast::*;
use oxc_semantic::{Scoping, SymbolId};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CanonicalLitSymbol {
    LitElement,
    ReactiveElement,
    HtmlTag,
    SvgTag,
    CssTag,
    CustomElementDecorator,
    PropertyDecorator,
    StateDecorator,
    QueryDecorator,
    QueryAllDecorator,
    QueryAsyncDecorator,
    QueryAssignedElementsDecorator,
    QueryAssignedNodesDecorator,
    EventOptionsDecorator,
    LitNamespace,
    DirectiveUntil,
    DirectiveAsyncAppend,
    DirectiveAsyncReplace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CanonicalHelperSymbol {
    Decorate,
    DecorateClass,
    Metadata,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum HeritageProof {
    ProvenLitElement {
        depth: usize,
        mixins: Vec<String>,
    },
    ProvenReactiveElement {
        depth: usize,
        mixins: Vec<String>,
    },
    LocalSubclass {
        base_class_name: String,
        mixins: Vec<String>,
    },
    CrossModuleSubclass {
        module_source: String,
        imported_name: String,
        mixins: Vec<String>,
    },
    ContractualLitElement {
        tag_name: Option<String>,
        mixins: Vec<String>,
    },
    UnrelatedClass,
    Unresolved,
}

pub struct SymbolProofContext<'a> {
    pub scoping: &'a Scoping,
    pub source_text: &'a str,
    pub lit_symbols: HashMap<SymbolId, CanonicalLitSymbol>,
    pub helper_symbols: HashMap<SymbolId, CanonicalHelperSymbol>,
    pub local_name_to_lit: HashMap<String, CanonicalLitSymbol>,
    pub local_name_to_helper: HashMap<String, CanonicalHelperSymbol>,
    pub imported_classes: HashMap<String, (String, String)>, // local_name -> (module_source, imported_name)
    pub local_class_declarations: HashSet<String>,
}

impl<'a> SymbolProofContext<'a> {
    pub fn is_canonical_lit_specifier(src: &str) -> bool {
        src == "lit"
            || src == "lit/index.js"
            || src == "lit/decorators.js"
            || src == "lit/decorators"
            || src.starts_with("lit/")
            || src == "lit-html"
            || src.starts_with("lit-html/")
            || src == "lit-element"
            || src == "lit-element/index.js"
            || src == "lit-element/decorators.js"
            || src == "lit-element/decorators"
            || src.starts_with("lit-element/")
            || src == "@lit/reactive-element"
            || src.starts_with("@lit/reactive-element/")
            || src.starts_with("@lit-labs/")
            || src == "@spectrum-web-components/base"
            || src.starts_with("@spectrum-web-components/base/")
    }

    pub fn is_decorator_helper_source(src: &str) -> bool {
        src == "tslib"
            || src.starts_with("tslib/")
            || src == "@swc/helpers"
            || src.starts_with("@swc/helpers/")
            || src.starts_with("@babel/runtime/helpers/")
            || src == "./decorate.js"
            || src == "../decorate.js"
            || src.ends_with("/decorate.js")
            || src.ends_with("/decorate")
    }

    pub fn scan(program: &'a Program<'a>, scoping: &'a Scoping, source_text: &'a str) -> Self {
        let mut lit_symbols = HashMap::new();
        let mut helper_symbols = HashMap::new();
        let mut local_name_to_lit = HashMap::new();
        let mut local_name_to_helper = HashMap::new();
        let mut imported_classes = HashMap::new();
        let mut local_class_declarations = HashSet::new();

        let root_scope = scoping.root_scope_id();

        // 1. Scan imports
        for stmt in &program.body {
            match stmt {
                Statement::ImportDeclaration(import_decl) => {
                    let source = import_decl.source.value.as_str();

                    if Self::is_canonical_lit_specifier(source) {
                        if let Some(specifiers) = &import_decl.specifiers {
                            for spec in specifiers {
                                match spec {
                                    ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => {
                                        let local_name = def.local.name.as_str().to_string();
                                        let sym_id = def.local.symbol_id.get().or_else(|| {
                                            scoping.get_binding(
                                                root_scope,
                                                def.local.name.as_str().into(),
                                            )
                                        });
                                        let canonical = if source.contains("until") {
                                            Some(CanonicalLitSymbol::DirectiveUntil)
                                        } else if source.contains("async-append") {
                                            Some(CanonicalLitSymbol::DirectiveAsyncAppend)
                                        } else if source.contains("async-replace") {
                                            Some(CanonicalLitSymbol::DirectiveAsyncReplace)
                                        } else {
                                            None
                                        };
                                        if let Some(c) = canonical {
                                            if let Some(sym) = sym_id {
                                                lit_symbols.insert(sym, c);
                                            }
                                            local_name_to_lit.insert(local_name, c);
                                        }
                                    }
                                    ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                        let imported_name = named.imported.name();
                                        let local_name = named.local.name.as_str().to_string();
                                        let sym_id = named.local.symbol_id.get().or_else(|| {
                                            scoping.get_binding(
                                                root_scope,
                                                named.local.name.as_str().into(),
                                            )
                                        });

                                        let canonical = match imported_name.as_str() {
                                            "LitElement" => Some(CanonicalLitSymbol::LitElement),
                                            "ReactiveElement" => {
                                                Some(CanonicalLitSymbol::ReactiveElement)
                                            }
                                            "html" => Some(CanonicalLitSymbol::HtmlTag),
                                            "svg" => Some(CanonicalLitSymbol::SvgTag),
                                            "css" => Some(CanonicalLitSymbol::CssTag),
                                            "customElement" => {
                                                Some(CanonicalLitSymbol::CustomElementDecorator)
                                            }
                                            "property" => {
                                                Some(CanonicalLitSymbol::PropertyDecorator)
                                            }
                                            "state" => Some(CanonicalLitSymbol::StateDecorator),
                                            "query" => Some(CanonicalLitSymbol::QueryDecorator),
                                            "queryAll" => {
                                                Some(CanonicalLitSymbol::QueryAllDecorator)
                                            }
                                            "queryAsync" => {
                                                Some(CanonicalLitSymbol::QueryAsyncDecorator)
                                            }
                                            "queryAssignedElements" => Some(
                                                CanonicalLitSymbol::QueryAssignedElementsDecorator,
                                            ),
                                            "queryAssignedNodes" => Some(
                                                CanonicalLitSymbol::QueryAssignedNodesDecorator,
                                            ),
                                            "eventOptions" => {
                                                Some(CanonicalLitSymbol::EventOptionsDecorator)
                                            }
                                            "until" => Some(CanonicalLitSymbol::DirectiveUntil),
                                            "asyncAppend" => {
                                                Some(CanonicalLitSymbol::DirectiveAsyncAppend)
                                            }
                                            "asyncReplace" => {
                                                Some(CanonicalLitSymbol::DirectiveAsyncReplace)
                                            }
                                            _ => {
                                                if source.contains("until") {
                                                    Some(CanonicalLitSymbol::DirectiveUntil)
                                                } else if source.contains("async-append") {
                                                    Some(CanonicalLitSymbol::DirectiveAsyncAppend)
                                                } else if source.contains("async-replace") {
                                                    Some(CanonicalLitSymbol::DirectiveAsyncReplace)
                                                } else {
                                                    None
                                                }
                                            }
                                        };

                                        if let Some(c) = canonical {
                                            if let Some(sym) = sym_id {
                                                lit_symbols.insert(sym, c);
                                            }
                                            local_name_to_lit.insert(local_name, c);
                                        }
                                    }
                                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                        let local_name = ns.local.name.as_str().to_string();
                                        let sym_id = ns.local.symbol_id.get().or_else(|| {
                                            scoping.get_binding(
                                                root_scope,
                                                ns.local.name.as_str().into(),
                                            )
                                        });
                                        if let Some(sym) = sym_id {
                                            lit_symbols
                                                .insert(sym, CanonicalLitSymbol::LitNamespace);
                                        }
                                        local_name_to_lit
                                            .insert(local_name, CanonicalLitSymbol::LitNamespace);
                                    }
                                }
                            }
                        }
                    } else if Self::is_decorator_helper_source(source) {
                        if let Some(specifiers) = &import_decl.specifiers {
                            for spec in specifiers {
                                if let ImportDeclarationSpecifier::ImportSpecifier(named) = spec {
                                    let imported_name = named.imported.name();
                                    let local_name = named.local.name.as_str().to_string();
                                    let sym_id = named.local.symbol_id.get().or_else(|| {
                                        scoping.get_binding(
                                            root_scope,
                                            named.local.name.as_str().into(),
                                        )
                                    });

                                    let helper = match imported_name.as_str() {
                                        "__decorate" | "_ts_decorate" | "decorate" => {
                                            Some(CanonicalHelperSymbol::Decorate)
                                        }
                                        "__decorateClass" => {
                                            Some(CanonicalHelperSymbol::DecorateClass)
                                        }
                                        "__metadata" | "metadata" => {
                                            Some(CanonicalHelperSymbol::Metadata)
                                        }
                                        _ => None,
                                    };

                                    if let Some(h) = helper {
                                        if let Some(sym) = sym_id {
                                            helper_symbols.insert(sym, h);
                                        }
                                        local_name_to_helper.insert(local_name, h);
                                    }
                                }
                            }
                        }
                    } else if let Some(specifiers) = &import_decl.specifiers {
                        // Track external imported class names for cross-module heritage
                        for spec in specifiers {
                            if let ImportDeclarationSpecifier::ImportSpecifier(named) = spec {
                                let imported_name = named.imported.name().to_string();
                                let local_name = named.local.name.as_str().to_string();
                                imported_classes
                                    .insert(local_name, (source.to_string(), imported_name));
                            } else if let ImportDeclarationSpecifier::ImportDefaultSpecifier(def) =
                                spec
                            {
                                let local_name = def.local.name.as_str().to_string();
                                imported_classes.insert(
                                    local_name,
                                    (source.to_string(), "default".to_string()),
                                );
                            }
                        }
                    }
                }
                Statement::ClassDeclaration(cls) => {
                    if let Some(id) = &cls.id {
                        local_class_declarations.insert(id.name.as_str().to_string());
                    }
                }
                Statement::ExportDeclaration(export) => {
                    if let Declaration::ClassDeclaration(cls) = &export.declaration {
                        if let Some(id) = &cls.id {
                            local_class_declarations.insert(id.name.as_str().to_string());
                        }
                    }
                }
                _ => {}
            }
        }

        Self {
            scoping,
            source_text,
            lit_symbols,
            helper_symbols,
            local_name_to_lit,
            local_name_to_helper,
            imported_classes,
            local_class_declarations,
        }
    }

    pub fn resolve_symbol(&self, ident: &IdentifierReference) -> Option<CanonicalLitSymbol> {
        if let Some(sym_id) = ident
            .reference_id
            .get()
            .and_then(|r| self.scoping.get_reference(r).symbol_id())
        {
            if let Some(sym) = self.lit_symbols.get(&sym_id) {
                return Some(*sym);
            }
        }
        self.local_name_to_lit.get(ident.name.as_str()).copied()
    }

    pub fn is_lit_html_tag(&self, expr: &Expression) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                self.resolve_symbol(ident) == Some(CanonicalLitSymbol::HtmlTag)
            }
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "html" {
                    if let Expression::Identifier(obj_id) = &mem.object {
                        return self.resolve_symbol(obj_id)
                            == Some(CanonicalLitSymbol::LitNamespace);
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn is_lit_svg_tag(&self, expr: &Expression) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                self.resolve_symbol(ident) == Some(CanonicalLitSymbol::SvgTag)
            }
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "svg" {
                    if let Expression::Identifier(obj_id) = &mem.object {
                        return self.resolve_symbol(obj_id)
                            == Some(CanonicalLitSymbol::LitNamespace);
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn is_lit_css_tag(&self, expr: &Expression) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                self.resolve_symbol(ident) == Some(CanonicalLitSymbol::CssTag)
            }
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "css" {
                    if let Expression::Identifier(obj_id) = &mem.object {
                        return self.resolve_symbol(obj_id)
                            == Some(CanonicalLitSymbol::LitNamespace);
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn is_proven_decorator(&self, expr: &Expression) -> Option<CanonicalLitSymbol> {
        match expr {
            Expression::Identifier(ident) => self.resolve_symbol(ident),
            Expression::CallExpression(call) => match &call.callee {
                Expression::Identifier(ident) => self.resolve_symbol(ident),
                Expression::StaticMemberExpression(mem) => {
                    let prop_name = mem.property.name.as_str();
                    if let Expression::Identifier(obj_id) = &mem.object {
                        if self.resolve_symbol(obj_id) == Some(CanonicalLitSymbol::LitNamespace) {
                            return match prop_name {
                                "customElement" => Some(CanonicalLitSymbol::CustomElementDecorator),
                                "property" => Some(CanonicalLitSymbol::PropertyDecorator),
                                "state" => Some(CanonicalLitSymbol::StateDecorator),
                                "query" => Some(CanonicalLitSymbol::QueryDecorator),
                                "queryAll" => Some(CanonicalLitSymbol::QueryAllDecorator),
                                "queryAsync" => Some(CanonicalLitSymbol::QueryAsyncDecorator),
                                "queryAssignedElements" => {
                                    Some(CanonicalLitSymbol::QueryAssignedElementsDecorator)
                                }
                                "queryAssignedNodes" => {
                                    Some(CanonicalLitSymbol::QueryAssignedNodesDecorator)
                                }
                                "eventOptions" => Some(CanonicalLitSymbol::EventOptionsDecorator),
                                _ => None,
                            };
                        }
                    }
                    None
                }
                _ => None,
            },
            _ => None,
        }
    }

    pub fn resolve_directive_call(&self, expr: &Expression) -> Option<CanonicalLitSymbol> {
        match expr {
            Expression::Identifier(ident) => {
                let sym = self.resolve_symbol(ident);
                match sym {
                    Some(
                        CanonicalLitSymbol::DirectiveUntil
                        | CanonicalLitSymbol::DirectiveAsyncAppend
                        | CanonicalLitSymbol::DirectiveAsyncReplace,
                    ) => sym,
                    _ => match ident.name.as_str() {
                        "until" => Some(CanonicalLitSymbol::DirectiveUntil),
                        "asyncAppend" => Some(CanonicalLitSymbol::DirectiveAsyncAppend),
                        "asyncReplace" => Some(CanonicalLitSymbol::DirectiveAsyncReplace),
                        _ => None,
                    },
                }
            }
            Expression::StaticMemberExpression(mem) => {
                let prop_name = mem.property.name.as_str();
                if let Expression::Identifier(obj_id) = &mem.object {
                    if self.resolve_symbol(obj_id) == Some(CanonicalLitSymbol::LitNamespace)
                        || obj_id.name == "lit"
                    {
                        match prop_name {
                            "until" => Some(CanonicalLitSymbol::DirectiveUntil),
                            "asyncAppend" => Some(CanonicalLitSymbol::DirectiveAsyncAppend),
                            "asyncReplace" => Some(CanonicalLitSymbol::DirectiveAsyncReplace),
                            _ => None,
                        }
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    /// Recursively proves the heritage chain of a class expression or declaration.
    pub fn prove_heritage(&self, class: &Class) -> HeritageProof {
        let super_class = match &class.heritage {
            Some(h) => &h.expression,
            None => {
                if self.has_lit_markers(class) {
                    return HeritageProof::ContractualLitElement {
                        tag_name: None,
                        mixins: Vec::new(),
                    };
                } else {
                    return HeritageProof::UnrelatedClass;
                }
            }
        };

        let mut mixins = Vec::new();
        let proof = self.trace_heritage_expr(super_class, &mut mixins, 0);

        match proof {
            HeritageProof::ProvenLitElement { .. }
            | HeritageProof::ProvenReactiveElement { .. }
            | HeritageProof::LocalSubclass { .. }
            | HeritageProof::ContractualLitElement { .. } => proof,
            HeritageProof::CrossModuleSubclass {
                ref module_source,
                ref imported_name,
                ref mixins,
            } => {
                if self.has_lit_markers(class) {
                    HeritageProof::CrossModuleSubclass {
                        module_source: module_source.clone(),
                        imported_name: imported_name.clone(),
                        mixins: mixins.clone(),
                    }
                } else {
                    HeritageProof::UnrelatedClass
                }
            }
            HeritageProof::Unresolved | HeritageProof::UnrelatedClass => {
                if self.has_lit_markers(class) {
                    HeritageProof::ContractualLitElement {
                        tag_name: None,
                        mixins,
                    }
                } else {
                    HeritageProof::UnrelatedClass
                }
            }
        }
    }

    fn trace_heritage_expr(
        &self,
        expr: &Expression,
        mixins: &mut Vec<String>,
        depth: usize,
    ) -> HeritageProof {
        match expr {
            Expression::Identifier(ident) => {
                let sym = self.resolve_symbol(ident);
                if sym == Some(CanonicalLitSymbol::LitElement) {
                    return HeritageProof::ProvenLitElement {
                        depth,
                        mixins: mixins.clone(),
                    };
                }
                if sym == Some(CanonicalLitSymbol::ReactiveElement) {
                    return HeritageProof::ProvenReactiveElement {
                        depth,
                        mixins: mixins.clone(),
                    };
                }

                let name = ident.name.as_str();
                if let Some((module_source, imported_name)) = self.imported_classes.get(name) {
                    if Self::is_canonical_lit_specifier(module_source) {
                        return HeritageProof::ProvenLitElement {
                            depth: depth + 1,
                            mixins: mixins.clone(),
                        };
                    } else {
                        return HeritageProof::CrossModuleSubclass {
                            module_source: module_source.clone(),
                            imported_name: imported_name.clone(),
                            mixins: mixins.clone(),
                        };
                    }
                }

                if self.local_class_declarations.contains(name) {
                    return HeritageProof::LocalSubclass {
                        base_class_name: name.to_string(),
                        mixins: mixins.clone(),
                    };
                }

                // Check for fallback by name if minifier preserved LitElement / ReactiveElement
                if name == "LitElement" {
                    return HeritageProof::ProvenLitElement {
                        depth,
                        mixins: mixins.clone(),
                    };
                }
                if name == "ReactiveElement" {
                    return HeritageProof::ProvenReactiveElement {
                        depth,
                        mixins: mixins.clone(),
                    };
                }

                HeritageProof::Unresolved
            }
            Expression::CallExpression(call) => {
                // Mixin pattern: Callee(BaseClass, ...options)
                let callee_name = match &call.callee {
                    Expression::Identifier(id) => id.name.as_str().to_string(),
                    _ => "AnonymousMixin".to_string(),
                };
                mixins.push(callee_name);

                // Examine arguments to locate base class
                for arg in &call.arguments {
                    if let Some(arg_expr) = arg.as_expression() {
                        let res = self.trace_heritage_expr(arg_expr, mixins, depth + 1);
                        if !matches!(
                            res,
                            HeritageProof::Unresolved | HeritageProof::UnrelatedClass
                        ) {
                            return res;
                        }
                    }
                }
                HeritageProof::Unresolved
            }
            Expression::StaticMemberExpression(mem) => {
                let prop_name = mem.property.name.as_str();
                if let Expression::Identifier(obj_id) = &mem.object {
                    if self.resolve_symbol(obj_id) == Some(CanonicalLitSymbol::LitNamespace) {
                        if prop_name == "LitElement" {
                            return HeritageProof::ProvenLitElement {
                                depth,
                                mixins: mixins.clone(),
                            };
                        }
                        if prop_name == "ReactiveElement" {
                            return HeritageProof::ProvenReactiveElement {
                                depth,
                                mixins: mixins.clone(),
                            };
                        }
                    }
                }
                HeritageProof::Unresolved
            }
            _ => HeritageProof::Unresolved,
        }
    }

    pub fn has_lit_markers(&self, class: &Class) -> bool {
        if self.has_lit_render_method(class) {
            return true;
        }
        if class.decorators.iter().any(|d| {
            self.is_proven_decorator(&d.expression)
                == Some(CanonicalLitSymbol::CustomElementDecorator)
        }) {
            return true;
        }
        for element in &class.body.body {
            match element {
                ClassElement::PropertyDefinition(prop) => {
                    if prop.r#static
                        && (prop.key.is_specific_static_name("properties")
                            || prop.key.is_specific_static_name("styles"))
                    {
                        return true;
                    }
                    if prop.decorators.iter().any(|d| {
                        matches!(
                            self.is_proven_decorator(&d.expression),
                            Some(
                                CanonicalLitSymbol::PropertyDecorator
                                    | CanonicalLitSymbol::StateDecorator
                            )
                        )
                    }) {
                        return true;
                    }
                }
                ClassElement::MethodDefinition(method)
                    if method.r#static
                        && (method.key.is_specific_static_name("properties")
                            || method.key.is_specific_static_name("styles")) =>
                {
                    return true;
                }
                _ => {}
            }
        }
        false
    }

    pub fn has_lit_render_method(&self, class: &Class) -> bool {
        for element in &class.body.body {
            if let ClassElement::MethodDefinition(method) = element {
                if !method.r#static && method.key.is_specific_static_name("render") {
                    if let Some(body) = &method.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt {
                                if let Some(arg) = &ret.argument {
                                    let mut curr = arg;
                                    while let Expression::ParenthesizedExpression(p) = curr {
                                        curr = &p.expression;
                                    }
                                    if let Expression::TaggedTemplateExpression(tagged) = curr {
                                        if self.is_lit_html_tag(&tagged.tag)
                                            || self.is_lit_svg_tag(&tagged.tag)
                                        {
                                            return true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        false
    }
}
