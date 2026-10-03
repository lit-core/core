use oxc_ast::ast::*;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DirectiveKind {
    ClassMap,
    StyleMap,
    IfDefined,
    When,
    Choose,
    Map,
    Join,
    Range,
    Guard,
    Live,
    Keyed,
    Cache,
    Repeat,
    TemplateContent,
    UnsafeHTML,
    UnsafeSVG,
    UnsafeMathML,
    Until,
    AsyncAppend,
    AsyncReplace,
    Ref,
}

impl DirectiveKind {
    pub fn name(&self) -> &'static str {
        match self {
            Self::ClassMap => "classMap",
            Self::StyleMap => "styleMap",
            Self::IfDefined => "ifDefined",
            Self::When => "when",
            Self::Choose => "choose",
            Self::Map => "map",
            Self::Join => "join",
            Self::Range => "range",
            Self::Guard => "guard",
            Self::Live => "live",
            Self::Keyed => "keyed",
            Self::Cache => "cache",
            Self::Repeat => "repeat",
            Self::TemplateContent => "templateContent",
            Self::UnsafeHTML => "unsafeHTML",
            Self::UnsafeSVG => "unsafeSVG",
            Self::UnsafeMathML => "unsafeMathML",
            Self::Until => "until",
            Self::AsyncAppend => "asyncAppend",
            Self::AsyncReplace => "asyncReplace",
            Self::Ref => "ref",
        }
    }

    pub fn from_canonical_name(name: &str) -> Option<Self> {
        match name {
            "classMap" | "ClassMapDirective" => Some(Self::ClassMap),
            "styleMap" | "StyleMapDirective" => Some(Self::StyleMap),
            "ifDefined" => Some(Self::IfDefined),
            "when" => Some(Self::When),
            "choose" => Some(Self::Choose),
            "map" => Some(Self::Map),
            "join" => Some(Self::Join),
            "range" => Some(Self::Range),
            "guard" => Some(Self::Guard),
            "live" => Some(Self::Live),
            "keyed" => Some(Self::Keyed),
            "cache" => Some(Self::Cache),
            "repeat" => Some(Self::Repeat),
            "templateContent" => Some(Self::TemplateContent),
            "unsafeHTML" | "UnsafeHTMLDirective" => Some(Self::UnsafeHTML),
            "unsafeSVG" => Some(Self::UnsafeSVG),
            "unsafeMathML" => Some(Self::UnsafeMathML),
            "until" | "UntilDirective" => Some(Self::Until),
            "asyncAppend" => Some(Self::AsyncAppend),
            "asyncReplace" | "AsyncReplaceDirective" => Some(Self::AsyncReplace),
            "ref" | "createRef" => Some(Self::Ref),
            _ => None,
        }
    }

    pub fn from_directive_slug(slug: &str) -> Option<Self> {
        let clean = slug.strip_suffix(".js").unwrap_or(slug);
        match clean {
            "class-map" => Some(Self::ClassMap),
            "style-map" => Some(Self::StyleMap),
            "if-defined" => Some(Self::IfDefined),
            "when" => Some(Self::When),
            "choose" => Some(Self::Choose),
            "map" => Some(Self::Map),
            "join" => Some(Self::Join),
            "range" => Some(Self::Range),
            "guard" => Some(Self::Guard),
            "live" => Some(Self::Live),
            "keyed" => Some(Self::Keyed),
            "cache" => Some(Self::Cache),
            "repeat" => Some(Self::Repeat),
            "template-content" => Some(Self::TemplateContent),
            "unsafe-html" => Some(Self::UnsafeHTML),
            "unsafe-svg" => Some(Self::UnsafeSVG),
            "unsafe-mathml" => Some(Self::UnsafeMathML),
            "until" => Some(Self::Until),
            "async-append" => Some(Self::AsyncAppend),
            "async-replace" => Some(Self::AsyncReplace),
            "ref" => Some(Self::Ref),
            _ => None,
        }
    }
}

pub fn extract_directive_slug(specifier: &str) -> Option<&str> {
    if let Some(rest) = specifier.strip_prefix("lit/directives/") {
        Some(rest)
    } else if let Some(rest) = specifier.strip_prefix("lit-html/directives/") {
        Some(rest)
    } else {
        None
    }
}

pub fn is_lit_core_import(specifier: &str) -> bool {
    specifier == "lit"
        || specifier == "lit-html"
        || specifier == "lit-element"
        || specifier == "@lit/reactive-element"
}

pub fn is_directive_export_module(specifier: &str) -> bool {
    is_lit_core_import(specifier)
        || specifier.ends_with("/directives.js")
        || specifier.ends_with("/directives")
}

#[derive(Debug, Default)]
pub struct ImportContext {
    /// Maps local identifier name (as imported in the file) to its DirectiveKind
    pub directive_bindings: HashMap<String, DirectiveKind>,
    /// Maps namespace local name to its DirectiveKind (if namespace import from lit/directives/*)
    pub namespace_bindings: HashMap<String, DirectiveKind>,
    /// Whether `nothing` is already imported from lit/lit-html
    pub has_nothing_imported: bool,
    /// Specifier for existing lit import if any ("lit" or "lit-html")
    pub primary_lit_source: Option<String>,
}

impl ImportContext {
    pub fn scan<'a>(program: &Program<'a>) -> Self {
        let mut ctx = Self::default();

        for stmt in &program.body {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                let specifier = import_decl.source.value.as_str();

                // Check if this is a directive module: e.g. lit/directives/class-map.js
                if let Some(slug) = extract_directive_slug(specifier) {
                    if let Some(kind_from_slug) = DirectiveKind::from_directive_slug(slug) {
                        if let Some(specifiers) = &import_decl.specifiers {
                            for spec in specifiers {
                                match spec {
                                    ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                        let local_name = named.local.name.as_str().to_string();
                                        ctx.directive_bindings.insert(local_name, kind_from_slug);
                                    }
                                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                        let local_name = ns.local.name.as_str().to_string();
                                        ctx.namespace_bindings.insert(local_name, kind_from_slug);
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                } else if is_directive_export_module(specifier) {
                    if is_lit_core_import(specifier) && ctx.primary_lit_source.is_none() {
                        ctx.primary_lit_source = Some(specifier.to_string());
                    }
                    if let Some(specifiers) = &import_decl.specifiers {
                        for spec in specifiers {
                            if let ImportDeclarationSpecifier::ImportSpecifier(named) = spec {
                                let imported_name = named.imported.name();
                                if imported_name == "nothing" {
                                    ctx.has_nothing_imported = true;
                                }
                                // Also recognize if directives are imported from lit directly
                                if let Some(kind) =
                                    DirectiveKind::from_canonical_name(imported_name.as_str())
                                {
                                    let local_name = named.local.name.as_str().to_string();
                                    ctx.directive_bindings.insert(local_name, kind);
                                }
                            }
                        }
                    }
                }
            }
        }

        ctx
    }

    pub fn has_directives(&self) -> bool {
        !self.directive_bindings.is_empty() || !self.namespace_bindings.is_empty()
    }

    pub fn get_directive_kind(&self, local_name: &str) -> Option<DirectiveKind> {
        self.directive_bindings.get(local_name).copied()
    }
}
