use oxc_ast::ast::*;
use oxc_semantic::{Scoping, SymbolId};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CanonicalDirective {
    Until,
    AsyncAppend,
    AsyncReplace,
    Cache,
    Choose,
    ClassMap,
    Guard,
    IfDefined,
    Keyed,
    Live,
    Map,
    Range,
    Ref,
    Repeat,
    StyleMap,
    TemplateContent,
    UnsafeHTML,
    UnsafeSVG,
    UnsafeMathML,
    When,
    Slice,
    Join,
}

impl CanonicalDirective {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Until => "until",
            Self::AsyncAppend => "asyncAppend",
            Self::AsyncReplace => "asyncReplace",
            Self::Cache => "cache",
            Self::Choose => "choose",
            Self::ClassMap => "classMap",
            Self::Guard => "guard",
            Self::IfDefined => "ifDefined",
            Self::Keyed => "keyed",
            Self::Live => "live",
            Self::Map => "map",
            Self::Range => "range",
            Self::Ref => "ref",
            Self::Repeat => "repeat",
            Self::StyleMap => "styleMap",
            Self::TemplateContent => "templateContent",
            Self::UnsafeHTML => "unsafeHTML",
            Self::UnsafeSVG => "unsafeSVG",
            Self::UnsafeMathML => "unsafeMathML",
            Self::When => "when",
            Self::Slice => "slice",
            Self::Join => "join",
        }
    }

    pub fn slug(&self) -> &'static str {
        match self {
            Self::Until => "until",
            Self::AsyncAppend => "async-append",
            Self::AsyncReplace => "async-replace",
            Self::Cache => "cache",
            Self::Choose => "choose",
            Self::ClassMap => "class-map",
            Self::Guard => "guard",
            Self::IfDefined => "if-defined",
            Self::Keyed => "keyed",
            Self::Live => "live",
            Self::Map => "map",
            Self::Range => "range",
            Self::Ref => "ref",
            Self::Repeat => "repeat",
            Self::StyleMap => "style-map",
            Self::TemplateContent => "template-content",
            Self::UnsafeHTML => "unsafe-html",
            Self::UnsafeSVG => "unsafe-svg",
            Self::UnsafeMathML => "unsafe-mathml",
            Self::When => "when",
            Self::Slice => "slice",
            Self::Join => "join",
        }
    }

    pub fn from_canonical_name(name: &str) -> Option<Self> {
        match name {
            "until" | "UntilDirective" => Some(Self::Until),
            "asyncAppend" | "AsyncAppendDirective" => Some(Self::AsyncAppend),
            "asyncReplace" | "AsyncReplaceDirective" => Some(Self::AsyncReplace),
            "cache" | "CacheDirective" => Some(Self::Cache),
            "choose" => Some(Self::Choose),
            "classMap" | "ClassMapDirective" => Some(Self::ClassMap),
            "guard" | "GuardDirective" => Some(Self::Guard),
            "ifDefined" => Some(Self::IfDefined),
            "keyed" | "KeyedDirective" => Some(Self::Keyed),
            "live" | "LiveDirective" => Some(Self::Live),
            "map" => Some(Self::Map),
            "range" => Some(Self::Range),
            "ref" | "createRef" | "RefDirective" => Some(Self::Ref),
            "repeat" | "RepeatDirective" => Some(Self::Repeat),
            "styleMap" | "StyleMapDirective" => Some(Self::StyleMap),
            "templateContent" | "TemplateContentDirective" => Some(Self::TemplateContent),
            "unsafeHTML" | "UnsafeHTMLDirective" => Some(Self::UnsafeHTML),
            "unsafeSVG" | "UnsafeSVGDirective" => Some(Self::UnsafeSVG),
            "unsafeMathML" | "UnsafeMathMLDirective" => Some(Self::UnsafeMathML),
            "when" => Some(Self::When),
            "slice" => Some(Self::Slice),
            "join" => Some(Self::Join),
            _ => None,
        }
    }

    pub fn from_slug(slug: &str) -> Option<Self> {
        let clean = slug.strip_suffix(".js").unwrap_or(slug);
        match clean {
            "until" => Some(Self::Until),
            "async-append" => Some(Self::AsyncAppend),
            "async-replace" => Some(Self::AsyncReplace),
            "cache" => Some(Self::Cache),
            "choose" => Some(Self::Choose),
            "class-map" => Some(Self::ClassMap),
            "guard" => Some(Self::Guard),
            "if-defined" => Some(Self::IfDefined),
            "keyed" => Some(Self::Keyed),
            "live" => Some(Self::Live),
            "map" => Some(Self::Map),
            "range" => Some(Self::Range),
            "ref" => Some(Self::Ref),
            "repeat" => Some(Self::Repeat),
            "style-map" => Some(Self::StyleMap),
            "template-content" => Some(Self::TemplateContent),
            "unsafe-html" => Some(Self::UnsafeHTML),
            "unsafe-svg" => Some(Self::UnsafeSVG),
            "unsafe-mathml" => Some(Self::UnsafeMathML),
            "when" => Some(Self::When),
            "slice" => Some(Self::Slice),
            "join" => Some(Self::Join),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CanonicalLitSymbol {
    LitElement,
    ReactiveElement,
    HtmlTag,
    StaticHtmlTag,
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
    LocalizedDecorator,
    NoChange,
    Nothing,
    LitNamespace,
    Directive(CanonicalDirective),
    DirectiveNamespace(CanonicalDirective),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CanonicalHelperSymbol {
    Decorate,
    DecorateClass,
    ApplyDecoratedDescriptor,
    Metadata,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedClassInfo {
    pub module_source: String,
    pub imported_name: String,
}

#[derive(Debug, Clone)]
pub struct CustomElementRegistration<'a> {
    pub tag: Option<String>,
    pub class_expr: &'a Expression<'a>,
    pub is_dynamic: bool,
    pub span: (u32, u32),
}

impl<'a> PartialEq for CustomElementRegistration<'a> {
    fn eq(&self, other: &Self) -> bool {
        self.tag == other.tag
            && self.is_dynamic == other.is_dynamic
            && self.span == other.span
            && std::ptr::eq(self.class_expr, other.class_expr)
    }
}

impl<'a> Eq for CustomElementRegistration<'a> {}

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
    None,
}

impl HeritageProof {
    #[inline]
    pub fn is_reactive(&self) -> bool {
        matches!(
            self,
            Self::ProvenLitElement { .. }
                | Self::ProvenReactiveElement { .. }
                | Self::LocalSubclass { .. }
                | Self::CrossModuleSubclass { .. }
                | Self::ContractualLitElement { .. }
        )
    }
}

pub struct SymbolProofContext<'a> {
    pub scoping: &'a Scoping,
    pub source_text: &'a str,
    pub lit_symbols: HashMap<SymbolId, CanonicalLitSymbol>,
    pub helper_symbols: HashMap<SymbolId, CanonicalHelperSymbol>,
    pub imported_classes: HashMap<SymbolId, ImportedClassInfo>,
    pub local_classes: HashMap<SymbolId, String>,
    pub local_heritage_proofs: HashMap<SymbolId, HeritageProof>,
    pub class_span_names: HashMap<(u32, u32), String>,
    pub transpiled_decorated_classes: std::collections::HashSet<String>,
    pub external_styled_classes: std::collections::HashSet<String>,
    pub has_lit_imports: bool,
}

impl<'a> SymbolProofContext<'a> {
    pub fn is_static_html_specifier(src: &str) -> bool {
        src == "lit/static-html.js"
            || src == "lit/static-html"
            || src == "lit-html/static.js"
            || src == "lit-html/static"
    }

    pub fn is_canonical_lit_specifier(src: &str) -> bool {
        src == "lit"
            || src.starts_with("lit/")
            || src == "lit-html"
            || src.starts_with("lit-html/")
            || src == "lit-element"
            || src.starts_with("lit-element/")
            || src == "@lit/reactive-element"
            || src.starts_with("@lit/reactive-element/")
            || src == "@lit/localize"
            || src.starts_with("@lit/localize/")
            || src.starts_with("@lit-labs/")
    }

    pub fn is_decorator_helper_source(src: &str) -> bool {
        src == "tslib"
            || src.starts_with("tslib/")
            || src == "@swc/helpers"
            || src.starts_with("@swc/helpers/")
            || src == "@babel/runtime/helpers"
            || src.starts_with("@babel/runtime/helpers/")
    }

    pub fn extract_static_string(expr: &Expression) -> Option<String> {
        match expr.without_parentheses() {
            Expression::StringLiteral(s) => Some(s.value.as_str().to_string()),
            Expression::TemplateLiteral(t) if t.expressions.is_empty() && t.quasis.len() == 1 => {
                Some(t.quasis[0].value.raw.as_str().to_string())
            }
            _ => None,
        }
    }

    pub fn is_valid_custom_element_tag(name: &str) -> bool {
        let bytes = name.as_bytes();
        if bytes.is_empty() || !bytes[0].is_ascii_lowercase() {
            return false;
        }
        let mut has_hyphen = false;
        for &b in bytes {
            if b == b'-' {
                has_hyphen = true;
            } else if !(b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'_') {
                return false;
            }
        }
        has_hyphen
            && !matches!(
                name,
                "annotation-xml"
                    | "color-profile"
                    | "font-face"
                    | "font-face-src"
                    | "font-face-uri"
                    | "font-face-format"
                    | "font-face-name"
                    | "missing-glyph"
            )
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

    pub fn map_lit_named_import(source: &str, imported_name: &str) -> Option<CanonicalLitSymbol> {
        if Self::is_static_html_specifier(source) {
            return match imported_name {
                "html" => Some(CanonicalLitSymbol::StaticHtmlTag),
                "svg" => Some(CanonicalLitSymbol::SvgTag),
                _ => None,
            };
        }
        match imported_name {
            "LitElement" => Some(CanonicalLitSymbol::LitElement),
            "ReactiveElement" => Some(CanonicalLitSymbol::ReactiveElement),
            "html" => Some(CanonicalLitSymbol::HtmlTag),
            "svg" => Some(CanonicalLitSymbol::SvgTag),
            "css" => Some(CanonicalLitSymbol::CssTag),
            "customElement" => Some(CanonicalLitSymbol::CustomElementDecorator),
            "property" => Some(CanonicalLitSymbol::PropertyDecorator),
            "state" => Some(CanonicalLitSymbol::StateDecorator),
            "query" => Some(CanonicalLitSymbol::QueryDecorator),
            "queryAll" => Some(CanonicalLitSymbol::QueryAllDecorator),
            "queryAsync" => Some(CanonicalLitSymbol::QueryAsyncDecorator),
            "queryAssignedElements" => Some(CanonicalLitSymbol::QueryAssignedElementsDecorator),
            "queryAssignedNodes" => Some(CanonicalLitSymbol::QueryAssignedNodesDecorator),
            "eventOptions" => Some(CanonicalLitSymbol::EventOptionsDecorator),
            "localized" => Some(CanonicalLitSymbol::LocalizedDecorator),
            "noChange" => Some(CanonicalLitSymbol::NoChange),
            "nothing" => Some(CanonicalLitSymbol::Nothing),
            _ => {
                if let Some(d) = CanonicalDirective::from_canonical_name(imported_name) {
                    Some(CanonicalLitSymbol::Directive(d))
                } else if let Some(slug) = Self::extract_directive_slug(source) {
                    if let Some(d) = CanonicalDirective::from_slug(slug) {
                        if imported_name == "default" || imported_name == d.name() {
                            Some(CanonicalLitSymbol::Directive(d))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
        }
    }

    pub fn map_lit_default_import(source: &str) -> Option<CanonicalLitSymbol> {
        if let Some(slug) = Self::extract_directive_slug(source) {
            if let Some(d) = CanonicalDirective::from_slug(slug) {
                return Some(CanonicalLitSymbol::Directive(d));
            }
        }
        None
    }

    pub fn map_helper_named_import(imported_name: &str) -> Option<CanonicalHelperSymbol> {
        match imported_name {
            "__decorate" | "_ts_decorate" | "__ts_decorate" | "decorate" | "_decorate"
            | "tsDecorate" | "_tsDecorate" => Some(CanonicalHelperSymbol::Decorate),
            "__decorateClass" | "_decorateClass" | "decorateClass" | "_ts_decorateClass"
            | "__ts_decorateClass" | "tsDecorateClass" | "_tsDecorateClass" | "_decorate_class"
            | "__decorate_class" | "decorate_class" => Some(CanonicalHelperSymbol::DecorateClass),
            "applyDecoratedDescriptor"
            | "_applyDecoratedDescriptor"
            | "__applyDecoratedDescriptor"
            | "_apply_decorated_descriptor"
            | "__apply_decorated_descriptor"
            | "apply_decorated_descriptor" => Some(CanonicalHelperSymbol::ApplyDecoratedDescriptor),
            "__metadata" | "_metadata" | "metadata" | "_ts_metadata" | "__ts_metadata"
            | "tsMetadata" | "_tsMetadata" => Some(CanonicalHelperSymbol::Metadata),
            _ => None,
        }
    }

    pub fn map_helper_default_import(source: &str) -> Option<CanonicalHelperSymbol> {
        if source.contains("applyDecoratedDescriptor")
            || source.contains("apply_decorated_descriptor")
        {
            Some(CanonicalHelperSymbol::ApplyDecoratedDescriptor)
        } else if source.contains("decorateClass") || source.contains("decorate_class") {
            Some(CanonicalHelperSymbol::DecorateClass)
        } else if source.contains("decorate") {
            Some(CanonicalHelperSymbol::Decorate)
        } else if source.contains("metadata") {
            Some(CanonicalHelperSymbol::Metadata)
        } else {
            None
        }
    }

    fn find_class_expr<'b, 'p>(expr: &'b Expression<'p>) -> Option<&'b Class<'p>> {
        match expr.without_parentheses() {
            Expression::ClassExpression(cls) => Some(cls),
            Expression::CallExpression(call) => {
                for arg in &call.arguments {
                    if let Some(cls) = arg.as_expression().and_then(|e| Self::find_class_expr(e)) {
                        return Some(cls);
                    }
                }
                None
            }
            _ => None,
        }
    }

    pub fn scan<'p>(program: &'p Program<'p>, scoping: &'a Scoping, source_text: &'a str) -> Self {
        let mut lit_symbols = HashMap::new();
        let mut helper_symbols = HashMap::new();
        let mut imported_classes = HashMap::new();
        let mut local_classes = HashMap::new();
        let mut local_heritage_exprs = HashMap::new();
        let mut class_span_names = HashMap::new();
        let mut transpiled_decorated_classes = std::collections::HashSet::new();
        let mut external_styled_classes = std::collections::HashSet::new();
        let mut has_lit_imports = false;

        let root_scope = scoping.root_scope_id();

        // 1. Scan imports and declarations
        for stmt in &program.body {
            match stmt {
                Statement::ImportDeclaration(import_decl) => {
                    let source = import_decl.source.value.as_str();

                    if Self::is_canonical_lit_specifier(source) {
                        has_lit_imports = true;
                        if let Some(specifiers) = &import_decl.specifiers {
                            for spec in specifiers {
                                match spec {
                                    ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => {
                                        if let Some(sym_id) =
                                            def.local.symbol_id.get().or_else(|| {
                                                scoping.get_binding(
                                                    root_scope,
                                                    def.local.name.as_str().into(),
                                                )
                                            })
                                        {
                                            if let Some(c) = Self::map_lit_default_import(source) {
                                                lit_symbols.insert(sym_id, c);
                                            }
                                        }
                                    }
                                    ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                        let imported_name = named.imported.name();
                                        if let Some(sym_id) =
                                            named.local.symbol_id.get().or_else(|| {
                                                scoping.get_binding(
                                                    root_scope,
                                                    named.local.name.as_str().into(),
                                                )
                                            })
                                        {
                                            if let Some(c) = Self::map_lit_named_import(
                                                source,
                                                imported_name.as_str(),
                                            ) {
                                                lit_symbols.insert(sym_id, c);
                                            }
                                        }
                                    }
                                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                        if Self::is_static_html_specifier(source) {
                                            continue;
                                        }
                                        if let Some(sym_id) =
                                            ns.local.symbol_id.get().or_else(|| {
                                                scoping.get_binding(
                                                    root_scope,
                                                    ns.local.name.as_str().into(),
                                                )
                                            })
                                        {
                                            if let Some(slug) = Self::extract_directive_slug(source)
                                            {
                                                if let Some(d) = CanonicalDirective::from_slug(slug)
                                                {
                                                    lit_symbols.insert(
                                                        sym_id,
                                                        CanonicalLitSymbol::DirectiveNamespace(d),
                                                    );
                                                } else {
                                                    lit_symbols.insert(
                                                        sym_id,
                                                        CanonicalLitSymbol::LitNamespace,
                                                    );
                                                }
                                            } else {
                                                lit_symbols.insert(
                                                    sym_id,
                                                    CanonicalLitSymbol::LitNamespace,
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else if let Some(specifiers) = &import_decl.specifiers {
                        for spec in specifiers {
                            match spec {
                                ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                    let imported_name = named.imported.name();
                                    if let Some(sym_id) =
                                        named.local.symbol_id.get().or_else(|| {
                                            scoping.get_binding(
                                                root_scope,
                                                named.local.name.as_str().into(),
                                            )
                                        })
                                    {
                                        if let Some(h) =
                                            Self::map_helper_named_import(imported_name.as_str())
                                                .or_else(|| {
                                                    Self::map_helper_named_import(
                                                        named.local.name.as_str(),
                                                    )
                                                })
                                        {
                                            helper_symbols.insert(sym_id, h);
                                        } else {
                                            imported_classes.insert(
                                                sym_id,
                                                ImportedClassInfo {
                                                    module_source: source.to_string(),
                                                    imported_name: imported_name.to_string(),
                                                },
                                            );
                                        }
                                    }
                                }
                                ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => {
                                    if let Some(sym_id) = def.local.symbol_id.get().or_else(|| {
                                        scoping
                                            .get_binding(root_scope, def.local.name.as_str().into())
                                    }) {
                                        if let Some(h) = Self::map_helper_default_import(source)
                                            .or_else(|| {
                                                Self::map_helper_named_import(
                                                    def.local.name.as_str(),
                                                )
                                            })
                                        {
                                            helper_symbols.insert(sym_id, h);
                                        } else {
                                            imported_classes.insert(
                                                sym_id,
                                                ImportedClassInfo {
                                                    module_source: source.to_string(),
                                                    imported_name: "default".to_string(),
                                                },
                                            );
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
                Statement::ClassDeclaration(cls) => {
                    if let Some(id) = &cls.id {
                        class_span_names
                            .insert((cls.span.start, cls.span.end), id.name.as_str().to_string());
                        if let Some(sym_id) = id
                            .symbol_id
                            .get()
                            .or_else(|| scoping.get_binding(root_scope, id.name.as_str().into()))
                        {
                            local_classes.insert(sym_id, id.name.as_str().to_string());
                        }
                    }
                }
                Statement::ExportDeclaration(export) => match &export.declaration {
                    Declaration::ClassDeclaration(cls) => {
                        if let Some(id) = &cls.id {
                            class_span_names.insert(
                                (cls.span.start, cls.span.end),
                                id.name.as_str().to_string(),
                            );
                            if let Some(sym_id) = id.symbol_id.get().or_else(|| {
                                scoping.get_binding(root_scope, id.name.as_str().into())
                            }) {
                                local_classes.insert(sym_id, id.name.as_str().to_string());
                            }
                        }
                    }
                    Declaration::VariableDeclaration(var_decl) => {
                        for decl in &var_decl.declarations {
                            if let BindingPattern::BindingIdentifier(id) = &decl.id {
                                let sym_id = id.symbol_id.get().or_else(|| {
                                    scoping.get_binding(root_scope, id.name.as_str().into())
                                });
                                if let Some(sym_id) = sym_id {
                                    if let Some(h) = Self::map_helper_named_import(id.name.as_str())
                                    {
                                        helper_symbols.insert(sym_id, h);
                                    }
                                }
                                if let Some(init) = &decl.init {
                                    if let Some(cls) = Self::find_class_expr(init) {
                                        class_span_names.insert(
                                            (cls.span.start, cls.span.end),
                                            id.name.as_str().to_string(),
                                        );
                                        if let Some(sym_id) = sym_id {
                                            local_classes
                                                .insert(sym_id, id.name.as_str().to_string());
                                        }
                                    } else if let Some(sym_id) = sym_id {
                                        local_heritage_exprs.insert(sym_id, init);
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                },
                Statement::VariableDeclaration(var_decl) => {
                    for decl in &var_decl.declarations {
                        if let BindingPattern::BindingIdentifier(id) = &decl.id {
                            let sym_id = id.symbol_id.get().or_else(|| {
                                scoping.get_binding(root_scope, id.name.as_str().into())
                            });
                            if let Some(init) = &decl.init {
                                if let Some(sym_id) = sym_id {
                                    if matches!(
                                        init.without_parentheses(),
                                        Expression::LogicalExpression(_)
                                    ) {
                                        if let Some(h) =
                                            Self::map_helper_named_import(id.name.as_str())
                                        {
                                            helper_symbols.insert(sym_id, h);
                                        }
                                    }
                                }
                                if let Some(cls) = Self::find_class_expr(init) {
                                    class_span_names.insert(
                                        (cls.span.start, cls.span.end),
                                        id.name.as_str().to_string(),
                                    );
                                    if let Some(sym_id) = sym_id {
                                        local_classes.insert(sym_id, id.name.as_str().to_string());
                                    }
                                } else if let Some(sym_id) = sym_id {
                                    local_heritage_exprs.insert(sym_id, init);
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        let mut ctx = Self {
            scoping,
            source_text,
            lit_symbols,
            helper_symbols,
            imported_classes,
            local_classes,
            local_heritage_proofs: HashMap::new(),
            class_span_names,
            transpiled_decorated_classes: std::collections::HashSet::new(),
            external_styled_classes: std::collections::HashSet::new(),
            has_lit_imports,
        };

        let mut local_heritage_proofs = HashMap::new();
        for (&sym_id, &init_expr) in &local_heritage_exprs {
            let mut mixins = Vec::new();
            let proof = ctx.trace_heritage_expr_with_map(
                init_expr,
                Some(&local_heritage_exprs),
                &mut mixins,
                0,
            );
            if !matches!(
                proof,
                HeritageProof::Unresolved | HeritageProof::UnrelatedClass | HeritageProof::None
            ) {
                local_heritage_proofs.insert(sym_id, proof);
            }
        }
        ctx.local_heritage_proofs = local_heritage_proofs;

        // 2. Scan top-level statements for transpiled decorators and external static styles
        for stmt in &program.body {
            if let Statement::ExpressionStatement(expr_stmt) = stmt {
                ctx.scan_top_level_expr(
                    &expr_stmt.expression,
                    &mut transpiled_decorated_classes,
                    &mut external_styled_classes,
                );
            }
        }
        ctx.transpiled_decorated_classes = transpiled_decorated_classes;
        ctx.external_styled_classes = external_styled_classes;

        ctx
    }

    fn scan_top_level_expr<'p>(
        &self,
        expr: &Expression<'p>,
        decorated_classes: &mut std::collections::HashSet<String>,
        styled_classes: &mut std::collections::HashSet<String>,
    ) {
        match expr.without_parentheses() {
            Expression::CallExpression(call) => {
                self.scan_helper_call(call, decorated_classes);
            }
            Expression::AssignmentExpression(assign) => {
                if let AssignmentTarget::StaticMemberExpression(mem) = &assign.left {
                    if mem.property.name == "styles" || mem.property.name == "css" {
                        if let Expression::Identifier(target_id) = mem.object.without_parentheses()
                        {
                            styled_classes.insert(target_id.name.as_str().to_string());
                        }
                    }
                }
                if let Expression::CallExpression(call) = assign.right.without_parentheses() {
                    self.scan_helper_call(call, decorated_classes);
                }
            }
            Expression::SequenceExpression(seq) => {
                for e in &seq.expressions {
                    self.scan_top_level_expr(e, decorated_classes, styled_classes);
                }
            }
            _ => {}
        }
    }

    fn scan_helper_call<'p>(
        &self,
        call: &CallExpression<'p>,
        decorated_classes: &mut std::collections::HashSet<String>,
    ) {
        if call.arguments.len() < 2 {
            return;
        }
        let is_helper = match call.callee.without_parentheses() {
            Expression::Identifier(id) => matches!(
                self.resolve_helper_symbol(id),
                Some(
                    CanonicalHelperSymbol::Decorate
                        | CanonicalHelperSymbol::DecorateClass
                        | CanonicalHelperSymbol::ApplyDecoratedDescriptor
                )
            ),
            _ => false,
        };
        if !is_helper {
            return;
        }

        // Form A: __decorate([decorators], TargetClass.prototype, "prop", ...)
        if call.arguments.len() >= 3 {
            if let Some(Expression::StaticMemberExpression(mem)) = call.arguments[1].as_expression()
            {
                if mem.property.name == "prototype" {
                    if let Expression::Identifier(target_id) = mem.object.without_parentheses() {
                        if let Some(Expression::ArrayExpression(arr)) =
                            call.arguments[0].as_expression()
                        {
                            if arr.elements.iter().any(|el| {
                                el.as_expression()
                                    .and_then(|e| self.is_proven_decorator(e))
                                    .is_some()
                            }) {
                                decorated_classes.insert(target_id.name.as_str().to_string());
                            }
                        }
                    }
                }
            }
        }

        // Form B: TargetClass = __decorate([decorators], TargetClass)
        if let Some(Expression::Identifier(target_id)) = call.arguments[1].as_expression() {
            if let Some(Expression::ArrayExpression(arr)) = call.arguments[0].as_expression() {
                if arr.elements.iter().any(|el| {
                    el.as_expression()
                        .map(|e| {
                            self.is_proven_decorator(e).is_some()
                                || self.is_class_custom_element_decorator_call(e).is_some()
                        })
                        .unwrap_or(false)
                }) {
                    decorated_classes.insert(target_id.name.as_str().to_string());
                }
            }
        }
    }

    pub fn is_class_custom_element_decorator_call(&self, expr: &Expression) -> Option<String> {
        if !self.has_lit_imports() {
            return None;
        }
        let Expression::CallExpression(call) = expr.without_parentheses() else {
            return None;
        };
        if self.resolve_decorator_call(call) == Some(CanonicalLitSymbol::CustomElementDecorator) {
            return call
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .and_then(Self::extract_static_string);
        }
        if call.arguments.len() != 1 {
            return None;
        }
        let arg_expr = call.arguments[0].as_expression()?;
        let tag = Self::extract_static_string(arg_expr)?;
        if !Self::is_valid_custom_element_tag(&tag) {
            return None;
        }
        match call.callee.without_parentheses() {
            Expression::Identifier(id) => {
                if let Some(ref_id) = id.reference_id.get() {
                    if let Some(sym_id) = self.scoping.get_reference(ref_id).symbol_id() {
                        if self.imported_classes.contains_key(&sym_id)
                            || self.lit_symbols.contains_key(&sym_id)
                        {
                            return Some(tag);
                        }
                    }
                }
                None
            }
            _ => None,
        }
    }

    pub fn get_class_name<'b, 'p>(&'b self, class: &'b Class<'p>) -> Option<&'b str> {
        if let Some(id) = &class.id {
            Some(id.name.as_str())
        } else {
            self.class_span_names
                .get(&(class.span.start, class.span.end))
                .map(|s| s.as_str())
        }
    }

    pub fn has_lit_imports(&self) -> bool {
        self.has_lit_imports || !self.lit_symbols.is_empty()
    }

    pub fn resolve_decorator(&self, decorator: &Decorator) -> Option<CanonicalLitSymbol> {
        self.is_proven_decorator(&decorator.expression)
    }

    pub fn is_unresolved_global(&self, ident: &IdentifierReference) -> bool {
        if let Some(ref_id) = ident.reference_id.get() {
            self.scoping.get_reference(ref_id).symbol_id().is_none()
        } else {
            self.scoping
                .get_binding(self.scoping.root_scope_id(), ident.name.as_str().into())
                .is_none()
        }
    }

    pub fn is_custom_elements_define_callee(&self, callee: &Expression) -> bool {
        let callee = callee.without_parentheses();
        let Expression::StaticMemberExpression(mem) = callee else {
            return false;
        };
        if mem.property.name != "define" {
            return false;
        }

        match mem.object.without_parentheses() {
            Expression::Identifier(id) => {
                id.name == "customElements" && self.is_unresolved_global(id)
            }
            Expression::StaticMemberExpression(inner)
                if inner.property.name == "customElements" =>
            {
                match inner.object.without_parentheses() {
                    Expression::Identifier(g) => {
                        let name = g.name.as_str();
                        (name == "window" || name == "globalThis" || name == "self")
                            && self.is_unresolved_global(g)
                    }
                    _ => false,
                }
            }
            _ => false,
        }
    }

    pub fn is_custom_elements_define(
        &self,
        call: &'a CallExpression<'a>,
    ) -> Option<CustomElementRegistration<'a>> {
        if !self.is_custom_elements_define_callee(&call.callee) {
            return None;
        }
        if call.arguments.len() < 2 {
            return None;
        }

        let first_arg = call.arguments[0].as_expression()?;
        let second_arg = call.arguments[1].as_expression()?;

        let (tag, is_dynamic) = match first_arg {
            Expression::StringLiteral(lit) => (Some(lit.value.to_string()), false),
            Expression::TemplateLiteral(t) if t.expressions.is_empty() && !t.quasis.is_empty() => {
                (Some(t.quasis[0].value.raw.to_string()), false)
            }
            _ => (None, true),
        };

        Some(CustomElementRegistration {
            tag,
            class_expr: second_arg,
            is_dynamic,
            span: (call.span.start, call.span.end),
        })
    }

    pub fn resolve_symbol(&self, ident: &IdentifierReference) -> Option<CanonicalLitSymbol> {
        let ref_id = ident.reference_id.get()?;
        let sym_id = self.scoping.get_reference(ref_id).symbol_id()?;
        self.lit_symbols.get(&sym_id).copied()
    }

    pub fn resolve_helper_symbol(
        &self,
        ident: &IdentifierReference,
    ) -> Option<CanonicalHelperSymbol> {
        if let Some(ref_id) = ident.reference_id.get() {
            if let Some(sym_id) = self.scoping.get_reference(ref_id).symbol_id() {
                if let Some(h) = self.helper_symbols.get(&sym_id).copied() {
                    return Some(h);
                }
            }
        }
        if self.is_unresolved_global(ident) {
            return Self::map_helper_named_import(ident.name.as_str());
        }
        None
    }

    pub fn is_lit_html_tag(&self, expr: &Expression) -> bool {
        match expr.without_parentheses() {
            Expression::Identifier(ident) => {
                self.resolve_symbol(ident) == Some(CanonicalLitSymbol::HtmlTag)
            }
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "html" {
                    if let Expression::Identifier(obj_id) = mem.object.without_parentheses() {
                        return self.resolve_symbol(obj_id)
                            == Some(CanonicalLitSymbol::LitNamespace);
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn is_lit_html_or_static_tag(&self, expr: &Expression) -> bool {
        match expr.without_parentheses() {
            Expression::Identifier(ident) => matches!(
                self.resolve_symbol(ident),
                Some(CanonicalLitSymbol::HtmlTag | CanonicalLitSymbol::StaticHtmlTag)
            ),
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "html" {
                    if let Expression::Identifier(obj_id) = mem.object.without_parentheses() {
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
        match expr.without_parentheses() {
            Expression::Identifier(ident) => {
                self.resolve_symbol(ident) == Some(CanonicalLitSymbol::SvgTag)
            }
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "svg" {
                    if let Expression::Identifier(obj_id) = mem.object.without_parentheses() {
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
        match expr.without_parentheses() {
            Expression::Identifier(ident) => {
                self.resolve_symbol(ident) == Some(CanonicalLitSymbol::CssTag)
            }
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "css" {
                    if let Expression::Identifier(obj_id) = mem.object.without_parentheses() {
                        return self.resolve_symbol(obj_id)
                            == Some(CanonicalLitSymbol::LitNamespace);
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn resolve_decorator_call(&self, call: &CallExpression) -> Option<CanonicalLitSymbol> {
        match call.callee.without_parentheses() {
            Expression::Identifier(ident) => self.resolve_symbol(ident),
            Expression::StaticMemberExpression(mem) => {
                let prop_name = mem.property.name.as_str();
                if let Expression::Identifier(obj_id) = mem.object.without_parentheses() {
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
                            "localized" => Some(CanonicalLitSymbol::LocalizedDecorator),
                            _ => None,
                        };
                    }
                }
                None
            }
            _ => None,
        }
    }

    pub fn is_proven_decorator(&self, expr: &Expression) -> Option<CanonicalLitSymbol> {
        match expr.without_parentheses() {
            Expression::Identifier(ident) => self.resolve_symbol(ident),
            Expression::StaticMemberExpression(mem) => {
                let prop_name = mem.property.name.as_str();
                if let Expression::Identifier(obj_id) = mem.object.without_parentheses() {
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
                            "localized" => Some(CanonicalLitSymbol::LocalizedDecorator),
                            _ => None,
                        };
                    }
                }
                None
            }
            Expression::CallExpression(call) => self.resolve_decorator_call(call),
            _ => None,
        }
    }

    pub fn resolve_directive(&self, call: &CallExpression) -> Option<CanonicalDirective> {
        self.resolve_directive_expr(&call.callee)
    }

    pub fn resolve_directive_expr(&self, expr: &Expression) -> Option<CanonicalDirective> {
        match expr.without_parentheses() {
            Expression::Identifier(ident) => match self.resolve_symbol(ident) {
                Some(CanonicalLitSymbol::Directive(d)) => Some(d),
                _ => None,
            },
            Expression::StaticMemberExpression(mem) => match mem.object.without_parentheses() {
                Expression::Identifier(obj_id) => match self.resolve_symbol(obj_id) {
                    Some(CanonicalLitSymbol::DirectiveNamespace(d)) => {
                        if mem.property.name == d.name() || mem.property.name == "default" {
                            Some(d)
                        } else {
                            None
                        }
                    }
                    Some(CanonicalLitSymbol::LitNamespace) => {
                        CanonicalDirective::from_canonical_name(mem.property.name.as_str())
                    }
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        }
    }

    pub fn resolve_directive_call(&self, expr: &Expression) -> Option<CanonicalDirective> {
        self.resolve_directive_expr(expr)
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
                    return HeritageProof::None;
                }
            }
        };

        let mut mixins = Vec::new();
        let proof = self.trace_heritage_expr(super_class, &mut mixins, 0);

        match proof {
            HeritageProof::ProvenLitElement { .. }
            | HeritageProof::ProvenReactiveElement { .. } => proof,
            HeritageProof::ContractualLitElement { .. } => {
                if self.has_lit_markers(class) {
                    proof
                } else {
                    HeritageProof::None
                }
            }
            HeritageProof::LocalSubclass {
                ref base_class_name,
                ref mixins,
            } => {
                if self.has_lit_markers(class) {
                    HeritageProof::LocalSubclass {
                        base_class_name: base_class_name.clone(),
                        mixins: mixins.clone(),
                    }
                } else {
                    HeritageProof::None
                }
            }
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
                    HeritageProof::None
                }
            }
            HeritageProof::Unresolved | HeritageProof::UnrelatedClass | HeritageProof::None => {
                if self.has_lit_markers(class) {
                    HeritageProof::ContractualLitElement {
                        tag_name: None,
                        mixins,
                    }
                } else {
                    HeritageProof::None
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
        self.trace_heritage_expr_with_map(expr, None, mixins, depth)
    }

    fn trace_heritage_expr_with_map<'p>(
        &self,
        expr: &Expression<'p>,
        expr_map: Option<&HashMap<SymbolId, &'p Expression<'p>>>,
        mixins: &mut Vec<String>,
        depth: usize,
    ) -> HeritageProof {
        if depth > 12 {
            return HeritageProof::Unresolved;
        }
        match expr.without_parentheses() {
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

                if let Some(ref_id) = ident.reference_id.get() {
                    if let Some(sym_id) = self.scoping.get_reference(ref_id).symbol_id() {
                        if let Some(proof) = self.local_heritage_proofs.get(&sym_id) {
                            return match proof {
                                HeritageProof::ProvenLitElement {
                                    depth: d,
                                    mixins: m,
                                } => {
                                    mixins.extend(m.iter().cloned());
                                    HeritageProof::ProvenLitElement {
                                        depth: depth + d,
                                        mixins: mixins.clone(),
                                    }
                                }
                                HeritageProof::ProvenReactiveElement {
                                    depth: d,
                                    mixins: m,
                                } => {
                                    mixins.extend(m.iter().cloned());
                                    HeritageProof::ProvenReactiveElement {
                                        depth: depth + d,
                                        mixins: mixins.clone(),
                                    }
                                }
                                HeritageProof::LocalSubclass {
                                    base_class_name,
                                    mixins: m,
                                } => {
                                    mixins.extend(m.iter().cloned());
                                    HeritageProof::LocalSubclass {
                                        base_class_name: base_class_name.clone(),
                                        mixins: mixins.clone(),
                                    }
                                }
                                HeritageProof::CrossModuleSubclass {
                                    module_source,
                                    imported_name,
                                    mixins: m,
                                } => {
                                    mixins.extend(m.iter().cloned());
                                    HeritageProof::CrossModuleSubclass {
                                        module_source: module_source.clone(),
                                        imported_name: imported_name.clone(),
                                        mixins: mixins.clone(),
                                    }
                                }
                                other => other.clone(),
                            };
                        }
                        if let Some(map) = expr_map {
                            if let Some(init_expr) = map.get(&sym_id) {
                                return self.trace_heritage_expr_with_map(
                                    init_expr,
                                    expr_map,
                                    mixins,
                                    depth + 1,
                                );
                            }
                        }

                        if let Some(imported) = self.imported_classes.get(&sym_id) {
                            if Self::is_canonical_lit_specifier(&imported.module_source) {
                                return HeritageProof::ProvenLitElement {
                                    depth: depth + 1,
                                    mixins: mixins.clone(),
                                };
                            } else {
                                return HeritageProof::CrossModuleSubclass {
                                    module_source: imported.module_source.clone(),
                                    imported_name: imported.imported_name.clone(),
                                    mixins: mixins.clone(),
                                };
                            }
                        }

                        if let Some(class_name) = self.local_classes.get(&sym_id) {
                            return HeritageProof::LocalSubclass {
                                base_class_name: class_name.clone(),
                                mixins: mixins.clone(),
                            };
                        }
                    }
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
                        let res = self.trace_heritage_expr_with_map(
                            arg_expr,
                            expr_map,
                            mixins,
                            depth + 1,
                        );
                        if !matches!(
                            res,
                            HeritageProof::Unresolved
                                | HeritageProof::UnrelatedClass
                                | HeritageProof::None
                        ) {
                            return res;
                        }
                    }
                }
                HeritageProof::Unresolved
            }
            Expression::StaticMemberExpression(mem) => {
                let prop_name = mem.property.name.as_str();
                if let Expression::Identifier(obj_id) = mem.object.without_parentheses() {
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

    pub fn expr_contains_lit_css(&self, expr: &Expression) -> bool {
        let expr = expr.without_parentheses();
        match expr {
            Expression::TaggedTemplateExpression(tagged) => self.is_lit_css_tag(&tagged.tag),
            Expression::ArrayExpression(arr) => arr.elements.iter().any(|elem| {
                if let Some(e) = elem.as_expression() {
                    self.expr_contains_lit_css(e)
                } else {
                    false
                }
            }),
            Expression::CallExpression(call) => match call.callee.without_parentheses() {
                Expression::Identifier(id) => {
                    if let Some(ref_id) = id.reference_id.get() {
                        if let Some(sym_id) = self.scoping.get_reference(ref_id).symbol_id() {
                            if let Some(imported) = self.imported_classes.get(&sym_id) {
                                return Self::is_canonical_lit_specifier(&imported.module_source)
                                    && imported.imported_name == "unsafeCSS";
                            }
                        }
                    }
                    false
                }
                Expression::StaticMemberExpression(mem) => {
                    if mem.property.name == "unsafeCSS" {
                        if let Expression::Identifier(obj_id) = mem.object.without_parentheses() {
                            return self.resolve_symbol(obj_id)
                                == Some(CanonicalLitSymbol::LitNamespace);
                        }
                    }
                    false
                }
                _ => false,
            },
            _ => false,
        }
    }

    pub fn has_lit_styles(&self, class: &Class) -> bool {
        if let Some(name) = self.get_class_name(class) {
            if self.external_styled_classes.contains(name) {
                return true;
            }
        }
        for element in &class.body.body {
            match element {
                ClassElement::PropertyDefinition(prop)
                    if prop.r#static && prop.key.is_specific_static_name("styles") =>
                {
                    if let Some(val) = &prop.value {
                        if self.expr_contains_lit_css(val) {
                            return true;
                        }
                    }
                }
                ClassElement::MethodDefinition(method)
                    if method.r#static
                        && method.kind == MethodDefinitionKind::Get
                        && method.key.is_specific_static_name("styles") =>
                {
                    if let Some(body) = &method.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt {
                                if let Some(arg) = &ret.argument {
                                    if self.expr_contains_lit_css(arg) {
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                }
                ClassElement::StaticBlock(block) => {
                    for stmt in &block.body {
                        if let Statement::ExpressionStatement(expr_stmt) = stmt {
                            if let Expression::AssignmentExpression(assign) = &expr_stmt.expression
                            {
                                if let AssignmentTarget::StaticMemberExpression(mem) = &assign.left
                                {
                                    if mem.property.name == "styles" || mem.property.name == "css" {
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        false
    }

    fn is_lit_property_options(&self, expr: &Expression) -> bool {
        let expr = expr.without_parentheses();
        match expr {
            Expression::ObjectExpression(obj) => obj.properties.iter().any(|prop| match prop {
                ObjectPropertyKind::ObjectProperty(p) => {
                    p.key.is_specific_static_name("type")
                        || p.key.is_specific_static_name("reflect")
                        || p.key.is_specific_static_name("attribute")
                        || p.key.is_specific_static_name("converter")
                        || p.key.is_specific_static_name("hasChanged")
                        || p.key.is_specific_static_name("state")
                        || p.key.is_specific_static_name("noAccessor")
                }
                _ => false,
            }),
            Expression::Identifier(id) => {
                let name = id.name.as_str();
                name == "String"
                    || name == "Number"
                    || name == "Boolean"
                    || name == "Array"
                    || name == "Object"
            }
            _ => false,
        }
    }

    pub fn is_lit_static_properties_object(&self, expr: &Expression) -> bool {
        if !self.has_lit_imports() {
            return false;
        }
        let expr = expr.without_parentheses();
        if let Expression::ObjectExpression(obj) = expr {
            if obj.properties.is_empty() {
                return false;
            }
            obj.properties.iter().any(|prop| match prop {
                ObjectPropertyKind::ObjectProperty(p) => self.is_lit_property_options(&p.value),
                _ => false,
            })
        } else {
            false
        }
    }

    pub fn has_lit_static_properties(&self, class: &Class) -> bool {
        if !self.has_lit_imports() {
            return false;
        }
        for element in &class.body.body {
            match element {
                ClassElement::PropertyDefinition(prop)
                    if prop.r#static && prop.key.is_specific_static_name("properties") =>
                {
                    if let Some(val) = &prop.value {
                        if self.is_lit_static_properties_object(val) {
                            return true;
                        }
                    }
                }
                ClassElement::MethodDefinition(method)
                    if method.r#static
                        && method.kind == MethodDefinitionKind::Get
                        && method.key.is_specific_static_name("properties") =>
                {
                    if let Some(body) = &method.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt {
                                if let Some(arg) = &ret.argument {
                                    if self.is_lit_static_properties_object(arg) {
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        false
    }

    pub fn has_proven_lit_decorators(&self, class: &Class) -> bool {
        if let Some(name) = self.get_class_name(class) {
            if self.transpiled_decorated_classes.contains(name) {
                return true;
            }
        }
        if class.decorators.iter().any(|d| {
            matches!(
                self.is_proven_decorator(&d.expression),
                Some(CanonicalLitSymbol::CustomElementDecorator)
            ) || self
                .is_class_custom_element_decorator_call(&d.expression)
                .is_some()
        }) {
            return true;
        }

        for element in &class.body.body {
            match element {
                ClassElement::PropertyDefinition(prop)
                    if prop.decorators.iter().any(|d| {
                        matches!(
                            self.is_proven_decorator(&d.expression),
                            Some(
                                CanonicalLitSymbol::PropertyDecorator
                                    | CanonicalLitSymbol::StateDecorator
                                    | CanonicalLitSymbol::QueryDecorator
                                    | CanonicalLitSymbol::QueryAllDecorator
                                    | CanonicalLitSymbol::QueryAsyncDecorator
                                    | CanonicalLitSymbol::QueryAssignedElementsDecorator
                                    | CanonicalLitSymbol::QueryAssignedNodesDecorator
                                    | CanonicalLitSymbol::EventOptionsDecorator
                            )
                        )
                    }) =>
                {
                    return true;
                }
                ClassElement::MethodDefinition(method)
                    if method.decorators.iter().any(|d| {
                        matches!(
                            self.is_proven_decorator(&d.expression),
                            Some(
                                CanonicalLitSymbol::PropertyDecorator
                                    | CanonicalLitSymbol::StateDecorator
                                    | CanonicalLitSymbol::EventOptionsDecorator
                            )
                        )
                    }) =>
                {
                    return true;
                }
                ClassElement::AccessorProperty(accessor)
                    if accessor.decorators.iter().any(|d| {
                        matches!(
                            self.is_proven_decorator(&d.expression),
                            Some(
                                CanonicalLitSymbol::PropertyDecorator
                                    | CanonicalLitSymbol::StateDecorator
                            )
                        )
                    }) =>
                {
                    return true;
                }
                _ => {}
            }
        }

        false
    }

    pub fn has_proven_lit_base_class(&self, class: &Class) -> bool {
        if let Some(h) = &class.heritage {
            let mut mixins = Vec::new();
            matches!(
                self.trace_heritage_expr(&h.expression, &mut mixins, 0),
                HeritageProof::ProvenLitElement { .. }
                    | HeritageProof::ProvenReactiveElement { .. }
            )
        } else {
            false
        }
    }

    pub fn has_lit_markers(&self, class: &Class) -> bool {
        if !self.has_lit_imports() {
            return false;
        }

        let has_tag = self.has_lit_render_method(class) || self.has_lit_styles(class);
        let has_decorator = self.has_proven_lit_decorators(class);
        let has_base = self.has_proven_lit_base_class(class);

        if !has_base && !has_tag && !has_decorator {
            return false;
        }

        true
    }

    fn expr_contains_lit_template(&self, expr: &Expression) -> bool {
        match expr.without_parentheses() {
            Expression::TaggedTemplateExpression(tagged) => {
                self.is_lit_html_or_static_tag(&tagged.tag) || self.is_lit_svg_tag(&tagged.tag)
            }
            Expression::ConditionalExpression(cond) => {
                self.expr_contains_lit_template(&cond.consequent)
                    || self.expr_contains_lit_template(&cond.alternate)
            }
            Expression::LogicalExpression(log) => {
                self.expr_contains_lit_template(&log.left)
                    || self.expr_contains_lit_template(&log.right)
            }
            _ => false,
        }
    }

    pub fn has_lit_render_method(&self, class: &Class) -> bool {
        for element in &class.body.body {
            if let ClassElement::MethodDefinition(method) = element {
                if !method.r#static && method.key.is_specific_static_name("render") {
                    if let Some(body) = &method.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt {
                                if let Some(arg) = &ret.argument {
                                    if self.expr_contains_lit_template(arg) {
                                        return true;
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
