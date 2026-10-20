use crate::emit_css::build_jsx_style_element;
use lit_analysis::{
    AttributePart, AttributePrefix, AttributeValue, ElementNamespace, LitComponentInfo,
    PropertyType, TemplateAttribute, TemplateElement, TemplateIR, TemplateNode, TemplateSlot,
};

use oxc_allocator::{Allocator, ArenaVec, CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

/// Query lowering metadata for @query and @queryAll decorators.
#[derive(Debug, Clone)]
pub struct QueryLoweringInfo {
    pub property_name: String,
    pub selector: String,
    pub ref_var_name: String,
    pub is_all: bool,
}

/// Internal resolved component descriptor
#[derive(Debug, Clone)]
pub struct ResolvedComponent {
    pub component_name: String,
    pub import_path: Option<String>,
    pub is_local: bool,
    pub property_types: HashMap<String, PropertyType>,
    pub known_events: HashSet<String>,
}

/// Registry mapping tag names to component resolution
#[derive(Debug, Clone, Default)]
pub struct ComponentTagRegistry {
    pub tags: HashMap<String, ResolvedComponent>,
}

impl ComponentTagRegistry {
    pub fn new(
        local_components: &[LitComponentInfo],
        known_tags: Option<&HashMap<String, String>>,
        component_registry: Option<&HashMap<String, crate::KnownComponentDto>>,
    ) -> Self {
        let mut registry = Self::default();

        // 1. Populate from known_tags shortcut: {"my-icon": "MyIcon"}
        if let Some(tags) = known_tags {
            for (tag, comp_name) in tags {
                let tag_lower = tag.to_ascii_lowercase();
                let mut default_import = String::from("./");
                default_import.push_str(&tag_lower);
                default_import.push_str(".js");
                registry.tags.insert(
                    tag_lower,
                    ResolvedComponent {
                        component_name: comp_name.clone(),
                        import_path: Some(default_import),
                        is_local: false,
                        property_types: HashMap::new(),
                        known_events: HashSet::new(),
                    },
                );
            }
        }

        // 2. Populate from component_registry with full metadata
        if let Some(reg) = component_registry {
            for (tag, dto) in reg {
                let tag_key = dto.tag_name.as_deref().unwrap_or(tag).to_ascii_lowercase();
                let mut default_import = String::from("./");
                default_import.push_str(&tag_key);
                default_import.push_str(".js");
                let import_path = dto.import_path.clone().or(Some(default_import));
                registry.tags.insert(
                    tag_key,
                    ResolvedComponent {
                        component_name: dto.component_name.clone(),
                        import_path,
                        is_local: false,
                        property_types: HashMap::new(),
                        known_events: HashSet::new(),
                    },
                );
            }
        }

        // 3. Populate from local module components (highest priority, is_local = true)
        for comp in local_components {
            if let Some(tag) = &comp.tag_name {
                let mut prop_types = HashMap::new();
                for prop in &comp.properties {
                    prop_types.insert(prop.name.clone(), prop.property_type);
                    if let Some(attr) = &prop.attribute {
                        prop_types.insert(attr.clone(), prop.property_type);
                    }
                }
                let mut events = HashSet::new();
                for ev in &comp.events {
                    events.insert(ev.name.clone());
                }

                registry.tags.insert(
                    tag.to_ascii_lowercase(),
                    ResolvedComponent {
                        component_name: comp.component_name.clone(),
                        import_path: None,
                        is_local: true,
                        property_types: prop_types,
                        known_events: events,
                    },
                );
            }
        }

        registry
    }

    pub fn resolve(&self, tag_name: &str) -> Option<&ResolvedComponent> {
        self.tags.get(&tag_name.to_ascii_lowercase())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ThisRewritingTarget {
    Props,
    #[default]
    Host,
    Preserve,
}

/// Peels any outer `ParenthesizedExpression` layers, returning the innermost expression reference.
pub fn peel_parentheses<'e, 'a>(mut expr: &'e Expression<'a>) -> &'e Expression<'a> {
    while let Expression::ParenthesizedExpression(paren) = expr {
        expr = &paren.expression;
    }
    expr
}

/// Extracts the underlying target expression from an expression, arrow function, or function expression,
/// peeling parentheses at every boundary.
pub fn extract_target_expression<'e, 'a>(expr: &'e Expression<'a>) -> Option<&'e Expression<'a>> {
    let peeled = peel_parentheses(expr);
    match peeled {
        Expression::ArrowFunctionExpression(arrow) => {
            if let Some(concise) = arrow.body.as_expression() {
                Some(peel_parentheses(concise))
            } else if let ArrowFunctionBody::FunctionBody(b) = &arrow.body {
                b.statements.iter().find_map(|s| {
                    if let Statement::ReturnStatement(r) = s {
                        r.argument.as_ref().map(|arg| peel_parentheses(arg))
                    } else {
                        None
                    }
                })
            } else {
                None
            }
        }
        Expression::FunctionExpression(f) => {
            if let Some(b) = &f.body {
                b.statements.iter().find_map(|s| {
                    if let Statement::ReturnStatement(r) = s {
                        r.argument.as_ref().map(|arg| peel_parentheses(arg))
                    } else {
                        None
                    }
                })
            } else {
                None
            }
        }
        other => Some(other),
    }
}

/// Configuration options for JSX emission.
#[derive(Debug, Clone)]
pub struct JsxEmitOptions {
    pub is_tier0: bool,
    pub preserve_whitespace: bool,
    pub custom_element_suffix: Option<String>,
    pub static_ids: HashSet<String>,
    pub queries: Vec<QueryLoweringInfo>,
    pub constant_strings: HashMap<String, String>,
    pub tag_registry: Option<ComponentTagRegistry>,
    pub has_slot_partitioning: bool,
    pub declared_properties: HashSet<String>,
    pub this_rewriting: ThisRewritingTarget,
    pub is_host_method: bool,
}

impl Default for JsxEmitOptions {
    fn default() -> Self {
        Self {
            is_tier0: true,
            preserve_whitespace: true,
            custom_element_suffix: None,
            static_ids: HashSet::new(),
            queries: Vec::new(),
            constant_strings: HashMap::new(),
            tag_registry: None,
            has_slot_partitioning: false,
            declared_properties: HashSet::new(),
            this_rewriting: ThisRewritingTarget::Props,
            is_host_method: false,
        }
    }
}

/// Collects static IDs declared across elements in the template that have matching IDREF attributes.
pub fn collect_static_ids(template: &TemplateIR) -> std::collections::HashSet<String> {
    let mut declared_ids = std::collections::HashSet::new();
    let mut referenced_ids = std::collections::HashSet::new();
    for root in &template.roots {
        scan_ids_from_node(root, &mut declared_ids, &mut referenced_ids);
    }
    declared_ids.retain(|id| referenced_ids.contains(id));
    declared_ids
}

fn scan_ids_from_node(
    node: &TemplateNode,
    declared: &mut std::collections::HashSet<String>,
    referenced: &mut std::collections::HashSet<String>,
) {
    match node {
        TemplateNode::Element(el) => {
            for attr in &el.attributes {
                if attr.name.eq_ignore_ascii_case("id") {
                    if let AttributeValue::Static(s) = &attr.value {
                        declared.insert(s.clone());
                    }
                } else if is_idref_attribute(&attr.name) {
                    if let AttributeValue::Static(s) = &attr.value {
                        for token in s.split_whitespace() {
                            referenced.insert(token.to_string());
                        }
                    }
                }
            }
            for child in &el.children {
                scan_ids_from_node(child, declared, referenced);
            }
        }
        TemplateNode::Slot(slot) => {
            for child in &slot.fallback {
                scan_ids_from_node(child, declared, referenced);
            }
        }
        _ => {}
    }
}

/// Collects top-level string constants from preceding statements.
pub fn collect_constant_strings<'a>(
    statements: &[Statement<'a>],
) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for stmt in statements {
        if let Statement::VariableDeclaration(decl) = stmt {
            for d in &decl.declarations {
                if let BindingPattern::BindingIdentifier(id) = &d.id {
                    if let Some(Expression::StringLiteral(s)) = &d.init {
                        map.insert(id.name.to_string(), s.value.to_string());
                    }
                }
            }
        }
    }
    map
}

/// Returns true if the attribute is an HTML or ARIA IDREF attribute.
pub fn is_idref_attribute(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "for"
            | "htmlfor"
            | "aria-labelledby"
            | "aria-describedby"
            | "aria-controls"
            | "aria-owns"
            | "aria-errormessage"
            | "aria-details"
            | "aria-flowto"
            | "aria-activedescendant"
            | "list"
            | "headers"
    )
}

/// Matches a CSS selector against a template element.
pub fn matches_query(el: &TemplateElement, selector: &str) -> bool {
    let sel = selector.trim();
    if let Some(id) = sel.strip_prefix('#') {
        el.attributes.iter().any(|attr| {
            attr.name.eq_ignore_ascii_case("id")
                && match &attr.value {
                    AttributeValue::Static(s) => s == id,
                    _ => false,
                }
        })
    } else if let Some(class) = sel.strip_prefix('.') {
        el.attributes.iter().any(|attr| {
            (attr.name.eq_ignore_ascii_case("class") || attr.name == "className")
                && match &attr.value {
                    AttributeValue::Static(s) => s.split_whitespace().any(|c| c == class),
                    _ => false,
                }
        })
    } else {
        el.tag_name.eq_ignore_ascii_case(sel)
    }
}

/// Standard HTML attribute mappings to React JSX camelCase property names.
pub fn map_html_attribute(name: &str) -> Option<&'static str> {
    match name.to_ascii_lowercase().as_str() {
        "class" => Some("className"),
        "for" => Some("htmlFor"),
        "tabindex" => Some("tabIndex"),
        "readonly" => Some("readOnly"),
        "autocomplete" => Some("autoComplete"),
        "autofocus" => Some("autoFocus"),
        "maxlength" => Some("maxLength"),
        "minlength" => Some("minLength"),
        "crossorigin" => Some("crossOrigin"),
        "novalidate" => Some("noValidate"),
        "formnovalidate" => Some("formNoValidate"),
        "formaction" => Some("formAction"),
        "formenctype" => Some("formEncType"),
        "formmethod" => Some("formMethod"),
        "formtarget" => Some("formTarget"),
        "srcset" => Some("srcSet"),
        "spellcheck" => Some("spellCheck"),
        "contenteditable" => Some("contentEditable"),
        "enctype" => Some("encType"),
        "hreflang" => Some("hrefLang"),
        "rowspan" => Some("rowSpan"),
        "colspan" => Some("colSpan"),
        "usemap" => Some("useMap"),
        "popovertarget" => Some("popoverTarget"),
        "popovertargetaction" => Some("popoverTargetAction"),
        "allowfullscreen" => Some("allowFullScreen"),
        "autoplay" => Some("autoPlay"),
        "disablepictureinpicture" => Some("disablePictureInPicture"),
        "disableremoteplayback" => Some("disableRemotePlayback"),
        "itemscope" => Some("itemScope"),
        "nomodule" => Some("noModule"),
        "playsinline" => Some("playsInline"),
        _ => None,
    }
}

/// Returns true if the attribute is a standard HTML boolean attribute in React.
pub fn is_standard_html_boolean_attribute(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "allowfullscreen"
            | "async"
            | "autofocus"
            | "autoplay"
            | "checked"
            | "controls"
            | "credentialless"
            | "default"
            | "defer"
            | "disabled"
            | "disablepictureinpicture"
            | "disableremoteplayback"
            | "formnovalidate"
            | "hidden"
            | "inert"
            | "ismap"
            | "itemscope"
            | "loop"
            | "multiple"
            | "muted"
            | "nomodule"
            | "novalidate"
            | "open"
            | "playsinline"
            | "readonly"
            | "required"
            | "reversed"
            | "scoped"
            | "seamless"
            | "selected"
            | "shadowrootclonable"
            | "shadowrootdelegatesfocus"
            | "shadowrootserializable"
            | "truespeed"
    )
}

/// SVG attribute casing lookup table according to React SVG specification.
pub fn map_svg_attribute(name: &str) -> Option<&'static str> {
    match name.to_ascii_lowercase().as_str() {
        "viewbox" => Some("viewBox"),
        "preserveaspectratio" => Some("preserveAspectRatio"),
        "stroke-width" => Some("strokeWidth"),
        "stroke-linecap" => Some("strokeLinecap"),
        "stroke-linejoin" => Some("strokeLinejoin"),
        "stroke-miterlimit" => Some("strokeMiterlimit"),
        "stroke-dasharray" => Some("strokeDasharray"),
        "stroke-dashoffset" => Some("strokeDashoffset"),
        "stroke-opacity" => Some("strokeOpacity"),
        "fill-rule" => Some("fillRule"),
        "fill-opacity" => Some("fillOpacity"),
        "clip-rule" => Some("clipRule"),
        "clip-path" => Some("clipPath"),
        "stop-color" => Some("stopColor"),
        "stop-opacity" => Some("stopOpacity"),
        "gradientunits" => Some("gradientUnits"),
        "gradienttransform" => Some("gradientTransform"),
        "spreadmethod" => Some("spreadMethod"),
        "patternunits" => Some("patternUnits"),
        "patterntransform" => Some("patternTransform"),
        "markerwidth" => Some("markerWidth"),
        "markerheight" => Some("markerHeight"),
        "markerunits" => Some("markerUnits"),
        "refx" => Some("refX"),
        "refy" => Some("refY"),
        "text-anchor" => Some("textAnchor"),
        "dominant-baseline" => Some("dominantBaseline"),
        "alignment-baseline" => Some("alignmentBaseline"),
        "baseline-shift" => Some("baselineShift"),
        "font-size" => Some("fontSize"),
        "font-family" => Some("fontFamily"),
        "font-weight" => Some("fontWeight"),
        "font-style" => Some("fontStyle"),
        "letter-spacing" => Some("letterSpacing"),
        "word-spacing" => Some("wordSpacing"),
        "text-decoration" => Some("textDecoration"),
        "xlink:href" => Some("xlinkHref"),
        "xlink:title" => Some("xlinkTitle"),
        "xml:base" => Some("xmlBase"),
        "xml:lang" => Some("xmlLang"),
        "xml:space" => Some("xmlSpace"),
        "color-interpolation" => Some("colorInterpolation"),
        "color-interpolation-filters" => Some("colorInterpolationFilters"),
        "basefrequency" => Some("baseFrequency"),
        "numoctaves" => Some("numOctaves"),
        "edgemode" => Some("edgeMode"),
        "stddeviation" => Some("stdDeviation"),
        "targetx" => Some("targetX"),
        "targety" => Some("targetY"),
        "tablevalues" => Some("tableValues"),
        _ => None,
    }
}

/// Converts a CSS kebab-case property name to React style camelCase name.
pub fn css_prop_to_camel_case(prop: &str) -> String {
    if prop.starts_with("--") {
        return prop.to_string();
    }

    let (prefix, rest) = if let Some(rest) = prop.strip_prefix("-ms-") {
        ("ms", rest)
    } else if let Some(rest) = prop.strip_prefix("ms-") {
        ("ms", rest)
    } else if let Some(rest) = prop.strip_prefix("-webkit-") {
        ("Webkit", rest)
    } else if let Some(rest) = prop.strip_prefix("webkit-") {
        ("Webkit", rest)
    } else if let Some(rest) = prop.strip_prefix("-moz-") {
        ("Moz", rest)
    } else if let Some(rest) = prop.strip_prefix("moz-") {
        ("Moz", rest)
    } else if let Some(rest) = prop.strip_prefix("-o-") {
        ("O", rest)
    } else if let Some(rest) = prop.strip_prefix("o-") {
        ("O", rest)
    } else {
        ("", prop)
    };

    let mut out = String::from(prefix);
    let mut cap_next = !prefix.is_empty();

    for c in rest.chars() {
        if c == '-' {
            cap_next = true;
        } else if cap_next {
            for uc in c.to_uppercase() {
                out.push(uc);
            }
            cap_next = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// Checks if a string is a valid JavaScript identifier name.
pub fn is_valid_identifier_name(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$' => {
            chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
        }
        _ => false,
    }
}

pub struct JsxEmitter<'a, 'b> {
    pub ast: &'b AstBuilder<'a>,
    pub allocator: &'a Allocator,
    pub expressions: &'b [Expression<'a>],
    pub options: JsxEmitOptions,
    pub style_element: Option<JSXElement<'a>>,
    pub required_runtime_imports: RefCell<BTreeSet<String>>,
    pub required_component_imports: RefCell<BTreeMap<String, String>>,
    pub seen_slots: RefCell<HashSet<Option<String>>>,
    pub symbol_ctx: Option<&'b lit_analysis::SymbolProofContext<'a>>,
}

impl<'a, 'b> JsxEmitter<'a, 'b> {
    pub fn new(
        ast: &'b AstBuilder<'a>,
        allocator: &'a Allocator,
        expressions: &'b [Expression<'a>],
        options: JsxEmitOptions,
        style_element: Option<JSXElement<'a>>,
    ) -> Self {
        Self {
            ast,
            allocator,
            expressions,
            options,
            style_element,
            required_runtime_imports: RefCell::new(BTreeSet::new()),
            required_component_imports: RefCell::new(BTreeMap::new()),
            seen_slots: RefCell::new(HashSet::new()),
            symbol_ctx: None,
        }
    }

    /// Lowers a TemplateIR into a root JSX expression.
    pub fn lower_template(&mut self, template: &TemplateIR) -> Expression<'a> {
        if template.roots.is_empty() {
            return self.build_empty_fragment();
        }

        if template.roots.len() == 1 {
            match &template.roots[0] {
                TemplateNode::Element(el) => {
                    let mut jsx_elem = self.lower_element(el);
                    if let Some(style_elem) = self.style_element.take() {
                        let is_void = lit_analysis::template_ir::is_void_element(&el.tag_name);
                        if !is_void {
                            jsx_elem.children.insert(
                                0,
                                JSXChild::Element(JSXElement::boxed(
                                    style_elem.span,
                                    style_elem.opening_element,
                                    style_elem.children,
                                    style_elem.closing_element,
                                    self.ast,
                                )),
                            );
                            Expression::JSXElement(jsx_elem)
                        } else {
                            let mut children = ArenaVec::new_in(self.ast);
                            children.push(JSXChild::Element(JSXElement::boxed(
                                style_elem.span,
                                style_elem.opening_element,
                                style_elem.children,
                                style_elem.closing_element,
                                self.ast,
                            )));
                            children.push(JSXChild::Element(jsx_elem));
                            self.wrap_in_fragment(children)
                        }
                    } else {
                        Expression::JSXElement(jsx_elem)
                    }
                }
                TemplateNode::Text(t) => {
                    let mut children = ArenaVec::new_in(self.ast);
                    if let Some(style_elem) = self.style_element.take() {
                        children.push(JSXChild::Element(JSXElement::boxed(
                            style_elem.span,
                            style_elem.opening_element,
                            style_elem.children,
                            style_elem.closing_element,
                            self.ast,
                        )));
                    }
                    self.append_text_nodes(t, &mut children);
                    self.wrap_in_fragment(children)
                }
                TemplateNode::Expression(idx) => {
                    let mut children = ArenaVec::new_in(self.ast);
                    if let Some(style_elem) = self.style_element.take() {
                        children.push(JSXChild::Element(JSXElement::boxed(
                            style_elem.span,
                            style_elem.opening_element,
                            style_elem.children,
                            style_elem.closing_element,
                            self.ast,
                        )));
                    }
                    children.push(self.lower_child_expression(*idx));
                    self.wrap_in_fragment(children)
                }
                _ => self.build_empty_fragment(),
            }
        } else {
            let mut children = ArenaVec::new_in(self.ast);
            if let Some(style_elem) = self.style_element.take() {
                children.push(JSXChild::Element(JSXElement::boxed(
                    style_elem.span,
                    style_elem.opening_element,
                    style_elem.children,
                    style_elem.closing_element,
                    self.ast,
                )));
            }
            for root in &template.roots {
                self.lower_node_into(root, &mut children);
            }
            self.wrap_in_fragment(children)
        }
    }

    fn build_empty_fragment(&self) -> Expression<'a> {
        let opening = JSXOpeningFragment::new(SPAN, self.ast);
        let closing = JSXClosingFragment::new(SPAN, self.ast);
        let children = ArenaVec::new_in(self.ast);
        Expression::JSXFragment(JSXFragment::boxed(
            SPAN, opening, children, closing, self.ast,
        ))
    }

    fn wrap_in_fragment(&self, children: ArenaVec<'a, JSXChild<'a>>) -> Expression<'a> {
        let opening = JSXOpeningFragment::new(SPAN, self.ast);
        let closing = JSXClosingFragment::new(SPAN, self.ast);
        Expression::JSXFragment(JSXFragment::boxed(
            SPAN, opening, children, closing, self.ast,
        ))
    }

    fn lower_element(
        &mut self,
        el: &TemplateElement,
    ) -> oxc_allocator::ArenaBox<'a, JSXElement<'a>> {
        let tag_resolution = self
            .options
            .tag_registry
            .as_ref()
            .and_then(|reg| reg.resolve(&el.tag_name))
            .cloned();
        let is_compiled_component = tag_resolution.is_some();
        let is_custom_element = !is_compiled_component && el.tag_name.contains('-');

        let elem_identifier = if let Some(ref res) = tag_resolution {
            if !res.is_local {
                let import_path = res.import_path.clone().unwrap_or_else(|| {
                    let mut s = String::from("./");
                    s.push_str(&el.tag_name);
                    s.push_str(".js");
                    s
                });
                self.required_component_imports
                    .borrow_mut()
                    .insert(res.component_name.clone(), import_path);
            }
            self.allocator.alloc_str(&res.component_name)
        } else {
            self.allocator.alloc_str(&el.tag_name)
        };

        let elem_name =
            JSXElementName::Identifier(JSXIdentifier::boxed(SPAN, elem_identifier, self.ast));

        let mut attrs = ArenaVec::new_in(self.ast);

        // Query lowering: if element matches any @query selector, attach ref={queryRef}
        for q in &self.options.queries {
            if !q.is_all && matches_query(el, &q.selector) {
                let ref_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
                    SPAN,
                    self.allocator.alloc_str("ref"),
                    self.ast,
                ));
                let ref_val = Some(JSXAttributeValue::ExpressionContainer(
                    JSXExpressionContainer::boxed(
                        SPAN,
                        JSXExpression::from(Expression::new_identifier(
                            SPAN,
                            self.allocator.alloc_str(&q.ref_var_name),
                            self.ast,
                        )),
                        self.ast,
                    ),
                ));
                attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                    SPAN, ref_name, ref_val, self.ast,
                )));
                break;
            }
        }

        // Lower attributes
        for attr in &el.attributes {
            if is_compiled_component {
                let res = tag_resolution.as_ref().unwrap();
                if let Some(attr_item) = self.lower_compiled_component_attribute(attr, res) {
                    attrs.push(attr_item);
                }
            } else if is_custom_element {
                if let Some(attr_item) = self.lower_uncompiled_custom_element_attribute(attr) {
                    attrs.push(attr_item);
                }
            } else if let Some(attr_item) = self.lower_attribute(attr, el.namespace) {
                attrs.push(attr_item);
            }
        }

        // Check for unsafeHTML / unsafeSVG on sole-child
        let mut sole_child_unsafe_html = None;
        if el.children.len() == 1 {
            if let TemplateNode::Expression(idx) = &el.children[0] {
                if let Some(expr) = self.expressions.get(*idx) {
                    if let Some(raw) = get_unsafe_html_arg(expr) {
                        sole_child_unsafe_html = Some(raw);
                    }
                }
            }
        }

        if let Some(raw_expr) = sole_child_unsafe_html {
            let key = PropertyKey::new_static_identifier(SPAN, "__html", self.ast);
            let mut lowered_raw = raw_expr.clone_in(self.allocator);
            if self.options.is_tier0 {
                rewrite_this_to_props(&mut lowered_raw, self.ast);
            } else {
                rewrite_this_to_host(&mut lowered_raw, self.ast);
            }
            let prop = ObjectPropertyKind::new_object_property(
                SPAN,
                PropertyKind::Init,
                key,
                lowered_raw,
                false,
                false,
                false,
                self.ast,
            );
            let mut obj_props = ArenaVec::new_in(self.ast);
            obj_props.push(prop);
            let obj_expr = Expression::new_object_expression(SPAN, obj_props, self.ast);

            let attr_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
                SPAN,
                self.allocator.alloc_str("dangerouslySetInnerHTML"),
                self.ast,
            ));
            let attr_val = JSXAttributeValue::ExpressionContainer(JSXExpressionContainer::boxed(
                SPAN,
                JSXExpression::from(obj_expr),
                self.ast,
            ));
            attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                SPAN,
                attr_name,
                Some(attr_val),
                self.ast,
            )));
        }

        let is_void =
            lit_analysis::template_ir::is_void_element(&el.tag_name) && el.children.is_empty();
        let opening = JSXOpeningElement::boxed(SPAN, elem_name, None, attrs, self.ast);

        let closing = if is_void {
            None
        } else {
            let close_name =
                JSXElementName::Identifier(JSXIdentifier::boxed(SPAN, elem_identifier, self.ast));
            Some(JSXClosingElement::boxed(SPAN, close_name, self.ast))
        };

        let mut children = ArenaVec::new_in(self.ast);
        if sole_child_unsafe_html.is_none() {
            for child in &el.children {
                self.lower_node_into(child, &mut children);
            }
        }

        JSXElement::boxed(SPAN, opening, children, closing, self.ast)
    }

    pub fn lower_node_into(&mut self, node: &TemplateNode, out: &mut ArenaVec<'a, JSXChild<'a>>) {
        match node {
            TemplateNode::Element(el) => {
                let elem = self.lower_element(el);
                out.push(JSXChild::Element(elem));
            }
            TemplateNode::Text(text) => {
                self.append_text_nodes(text, out);
            }
            TemplateNode::Expression(idx) => {
                out.push(self.lower_child_expression(*idx));
            }
            TemplateNode::Slot(slot) => {
                self.lower_slot(slot, out);
            }

            TemplateNode::Comment(_) => {
                // Comments in templates can be ignored in JSX
            }
        }
    }

    fn build_slot_boundary_element(
        &self,
        slot: &TemplateSlot,
        children: ArenaVec<'a, JSXChild<'a>>,
    ) -> oxc_allocator::ArenaBox<'a, JSXElement<'a>> {
        self.required_runtime_imports
            .borrow_mut()
            .insert("SlotBoundary".to_string());
        let elem_name = JSXElementName::Identifier(JSXIdentifier::boxed(
            SPAN,
            self.allocator.alloc_str("SlotBoundary"),
            self.ast,
        ));

        let mut attrs = ArenaVec::new_in(self.ast);

        // 1. style={{ display: 'contents' }}
        {
            let mut style_props = ArenaVec::new_in(self.ast);
            let key = PropertyKey::new_static_identifier(
                SPAN,
                self.allocator.alloc_str("display"),
                self.ast,
            );
            let val = Expression::new_string_literal(
                SPAN,
                self.allocator.alloc_str("contents"),
                None,
                self.ast,
            );
            style_props.push(ObjectPropertyKind::ObjectProperty(ObjectProperty::boxed(
                SPAN,
                PropertyKind::Init,
                key,
                val,
                false,
                false,
                false,
                self.ast,
            )));
            let style_obj = Expression::new_object_expression(SPAN, style_props, self.ast);
            let container = JSXAttributeValue::ExpressionContainer(JSXExpressionContainer::boxed(
                SPAN,
                JSXExpression::from(style_obj),
                self.ast,
            ));
            let attr_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
                SPAN,
                self.allocator.alloc_str("style"),
                self.ast,
            ));
            attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                SPAN,
                attr_name,
                Some(container),
                self.ast,
            )));
        }

        // 2. data-slot-boundary=""
        {
            let attr_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
                SPAN,
                self.allocator.alloc_str("data-slot-boundary"),
                self.ast,
            ));
            let attr_val = JSXAttributeValue::StringLiteral(StringLiteral::boxed(
                SPAN,
                self.allocator.alloc_str(""),
                None,
                self.ast,
            ));
            attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                SPAN,
                attr_name,
                Some(attr_val),
                self.ast,
            )));
        }

        // 3. data-slot="name" (if named slot)
        if let Some(name) = &slot.name {
            let attr_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
                SPAN,
                self.allocator.alloc_str("data-slot"),
                self.ast,
            ));
            let attr_val = JSXAttributeValue::StringLiteral(StringLiteral::boxed(
                SPAN,
                self.allocator.alloc_str(name),
                None,
                self.ast,
            ));
            attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                SPAN,
                attr_name,
                Some(attr_val),
                self.ast,
            )));
        }

        // 4. Any event attributes on the slot (e.g. @slotchange)
        for attr in &slot.attributes {
            if attr.prefix == AttributePrefix::Event {
                let event_prop = lit_analysis::ManifestScanner::derive_event_prop_name(&attr.name);
                let prop_id = self.allocator.alloc_str(&event_prop);
                let attr_name =
                    JSXAttributeName::Identifier(JSXIdentifier::boxed(SPAN, prop_id, self.ast));
                if let AttributeValue::Dynamic(expr_idx) = &attr.value {
                    let expr = self.clone_expression(*expr_idx);
                    let container =
                        JSXExpressionContainer::boxed(SPAN, JSXExpression::from(expr), self.ast);
                    attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                        SPAN,
                        attr_name,
                        Some(JSXAttributeValue::ExpressionContainer(container)),
                        self.ast,
                    )));
                }
            }
        }

        let opening = JSXOpeningElement::boxed(SPAN, elem_name, None, attrs, self.ast);
        let closing_elem_name = JSXElementName::Identifier(JSXIdentifier::boxed(
            SPAN,
            self.allocator.alloc_str("SlotBoundary"),
            self.ast,
        ));
        let closing = Some(JSXClosingElement::boxed(SPAN, closing_elem_name, self.ast));

        JSXElement::boxed(SPAN, opening, children, closing, self.ast)
    }

    pub fn save_slot_scope(&self) -> HashSet<Option<String>> {
        self.seen_slots.borrow().clone()
    }

    pub fn restore_slot_scope(&self, snapshot: HashSet<Option<String>>) {
        *self.seen_slots.borrow_mut() = snapshot;
    }

    pub fn merge_conditional_slot_branches(
        &self,
        snapshot: HashSet<Option<String>>,
        branch_sets: &[HashSet<Option<String>>],
        is_exhaustive: bool,
    ) {
        if is_exhaustive && !branch_sets.is_empty() {
            let mut common = branch_sets[0].clone();
            for set in &branch_sets[1..] {
                common.retain(|s| set.contains(s));
            }
            *self.seen_slots.borrow_mut() = snapshot;
            self.seen_slots.borrow_mut().extend(common);
        } else {
            *self.seen_slots.borrow_mut() = snapshot;
        }
    }

    fn lower_slot(&mut self, slot: &TemplateSlot, out: &mut ArenaVec<'a, JSXChild<'a>>) {
        let slot_key = slot.name.clone();
        let is_duplicate = !self.seen_slots.borrow_mut().insert(slot_key);

        if is_duplicate {
            if slot.fallback.is_empty() {
                if slot.inspected {
                    let boundary =
                        self.build_slot_boundary_element(slot, ArenaVec::new_in(self.ast));
                    out.push(JSXChild::Element(boundary));
                }
            } else {
                let mut fallback_children = ArenaVec::new_in(self.ast);
                for f in &slot.fallback {
                    self.lower_node_into(f, &mut fallback_children);
                }
                if slot.inspected {
                    let boundary = self.build_slot_boundary_element(slot, fallback_children);
                    out.push(JSXChild::Element(boundary));
                } else {
                    for child in fallback_children {
                        out.push(child);
                    }
                }
            }
            return;
        }

        let fallback_frag = if !slot.fallback.is_empty() {
            let mut fallback_children = ArenaVec::new_in(self.ast);
            for f in &slot.fallback {
                self.lower_node_into(f, &mut fallback_children);
            }
            Some(self.wrap_in_fragment(fallback_children))
        } else {
            None
        };

        let projected_expr = match &slot.name {
            None => {
                if self.options.has_slot_partitioning {
                    let slots_ident = if self.options.is_host_method {
                        Expression::new_static_member_expression(
                            SPAN,
                            Expression::new_this_expression(SPAN, self.ast),
                            IdentifierName::new(SPAN, self.allocator.alloc_str("_slots"), self.ast),
                            false,
                            self.ast,
                        )
                    } else {
                        Expression::new_identifier(
                            SPAN,
                            self.allocator.alloc_str("_slots"),
                            self.ast,
                        )
                    };
                    let default_children_expr = Expression::new_static_member_expression(
                        SPAN,
                        slots_ident,
                        IdentifierName::new(
                            SPAN,
                            self.allocator.alloc_str("defaultChildren"),
                            self.ast,
                        ),
                        false,
                        self.ast,
                    );
                    if let Some(fallback) = fallback_frag {
                        let len_expr = Expression::new_static_member_expression(
                            SPAN,
                            default_children_expr.clone_in(self.allocator),
                            IdentifierName::new(SPAN, self.allocator.alloc_str("length"), self.ast),
                            false,
                            self.ast,
                        );
                        let test_expr = Expression::new_binary_expression(
                            SPAN,
                            len_expr,
                            BinaryOperator::GreaterThan,
                            Expression::new_numeric_literal(
                                SPAN,
                                0.0,
                                None,
                                oxc_syntax::number::NumberBase::Decimal,
                                self.ast,
                            ),
                            self.ast,
                        );
                        Expression::new_conditional_expression(
                            SPAN,
                            test_expr,
                            default_children_expr,
                            fallback,
                            self.ast,
                        )
                    } else {
                        default_children_expr
                    }
                } else {
                    let props_ident = if self.options.is_host_method {
                        Expression::new_static_member_expression(
                            SPAN,
                            Expression::new_this_expression(SPAN, self.ast),
                            IdentifierName::new(SPAN, self.allocator.alloc_str("_props"), self.ast),
                            false,
                            self.ast,
                        )
                    } else {
                        Expression::new_identifier(
                            SPAN,
                            self.allocator.alloc_str("props"),
                            self.ast,
                        )
                    };
                    let children_expr = Expression::new_static_member_expression(
                        SPAN,
                        props_ident,
                        IdentifierName::new(SPAN, self.allocator.alloc_str("children"), self.ast),
                        false,
                        self.ast,
                    );
                    if let Some(fallback) = fallback_frag {
                        Expression::new_logical_expression(
                            SPAN,
                            children_expr,
                            LogicalOperator::Coalesce,
                            fallback,
                            self.ast,
                        )
                    } else {
                        children_expr
                    }
                }
            }
            Some(name) => {
                let slots_ident = if self.options.is_host_method {
                    Expression::new_static_member_expression(
                        SPAN,
                        Expression::new_this_expression(SPAN, self.ast),
                        IdentifierName::new(SPAN, self.allocator.alloc_str("_slots"), self.ast),
                        false,
                        self.ast,
                    )
                } else {
                    Expression::new_identifier(SPAN, self.allocator.alloc_str("_slots"), self.ast)
                };
                let named_slots_member = Expression::new_static_member_expression(
                    SPAN,
                    slots_ident,
                    IdentifierName::new(SPAN, self.allocator.alloc_str("namedSlots"), self.ast),
                    false,
                    self.ast,
                );
                let slot_key_lit = Expression::new_string_literal(
                    SPAN,
                    self.allocator.alloc_str(name),
                    None,
                    self.ast,
                );
                let named_slot_access = Expression::new_computed_member_expression(
                    SPAN,
                    named_slots_member,
                    slot_key_lit,
                    false,
                    self.ast,
                );

                let len_member = StaticMemberExpression::boxed(
                    SPAN,
                    named_slot_access.clone_in(self.allocator),
                    IdentifierName::new(SPAN, self.allocator.alloc_str("length"), self.ast),
                    true,
                    self.ast,
                );
                let chain_expr = Expression::new_chain_expression(
                    SPAN,
                    ChainElement::StaticMemberExpression(len_member),
                    self.ast,
                );
                let slotted_test = Expression::new_binary_expression(
                    SPAN,
                    chain_expr,
                    BinaryOperator::GreaterThan,
                    Expression::new_numeric_literal(
                        SPAN,
                        0.0,
                        None,
                        oxc_syntax::number::NumberBase::Decimal,
                        self.ast,
                    ),
                    self.ast,
                );

                let props_ident = if self.options.is_host_method {
                    Expression::new_static_member_expression(
                        SPAN,
                        Expression::new_this_expression(SPAN, self.ast),
                        IdentifierName::new(SPAN, self.allocator.alloc_str("_props"), self.ast),
                        false,
                        self.ast,
                    )
                } else {
                    Expression::new_identifier(SPAN, self.allocator.alloc_str("props"), self.ast)
                };
                let prop_access = if is_valid_identifier_name(name) {
                    Expression::new_static_member_expression(
                        SPAN,
                        props_ident,
                        IdentifierName::new(SPAN, self.allocator.alloc_str(name), self.ast),
                        false,
                        self.ast,
                    )
                } else {
                    Expression::new_computed_member_expression(
                        SPAN,
                        props_ident,
                        Expression::new_string_literal(
                            SPAN,
                            self.allocator.alloc_str(name),
                            None,
                            self.ast,
                        ),
                        false,
                        self.ast,
                    )
                };

                let fallback =
                    fallback_frag.unwrap_or_else(|| Expression::new_null_literal(SPAN, self.ast));

                let is_declared_prop = self.options.declared_properties.contains(name);

                if is_declared_prop {
                    self.required_runtime_imports
                        .borrow_mut()
                        .insert("isValidElement".to_string());
                    let is_valid_ident = Expression::new_identifier(
                        SPAN,
                        self.allocator.alloc_str("isValidElement"),
                        self.ast,
                    );
                    let mut is_valid_args = ArenaVec::new_in(self.ast);
                    is_valid_args.push(Argument::from(prop_access.clone_in(self.allocator)));
                    let is_valid_call = Expression::new_call_expression(
                        SPAN,
                        is_valid_ident,
                        None,
                        is_valid_args,
                        false,
                        self.ast,
                    );
                    let non_slotted_branch = Expression::new_conditional_expression(
                        SPAN,
                        is_valid_call,
                        prop_access,
                        fallback,
                        self.ast,
                    );

                    Expression::new_conditional_expression(
                        SPAN,
                        slotted_test,
                        named_slot_access,
                        non_slotted_branch,
                        self.ast,
                    )
                } else {
                    let undef_expr = Expression::new_identifier(
                        SPAN,
                        self.allocator.alloc_str("undefined"),
                        self.ast,
                    );
                    let outer_test = Expression::new_binary_expression(
                        SPAN,
                        prop_access.clone_in(self.allocator),
                        BinaryOperator::StrictInequality,
                        undef_expr,
                        self.ast,
                    );
                    let inner_conditional = Expression::new_conditional_expression(
                        SPAN,
                        slotted_test,
                        named_slot_access,
                        fallback,
                        self.ast,
                    );
                    Expression::new_conditional_expression(
                        SPAN,
                        outer_test,
                        prop_access,
                        inner_conditional,
                        self.ast,
                    )
                }
            }
        };

        if slot.inspected {
            let mut boundary_children = ArenaVec::new_in(self.ast);
            boundary_children.push(JSXChild::ExpressionContainer(
                JSXExpressionContainer::boxed(SPAN, JSXExpression::from(projected_expr), self.ast),
            ));
            let boundary = self.build_slot_boundary_element(slot, boundary_children);
            out.push(JSXChild::Element(boundary));
        } else {
            let container =
                JSXExpressionContainer::boxed(SPAN, JSXExpression::from(projected_expr), self.ast);
            out.push(JSXChild::ExpressionContainer(container));
        }
    }

    fn append_text_nodes(&self, text: &str, out: &mut ArenaVec<'a, JSXChild<'a>>) {
        if text.is_empty() {
            return;
        }

        // Pure whitespace check
        if text.chars().all(|c| c.is_whitespace()) {
            if self.options.preserve_whitespace && text.contains(' ') {
                let space_expr = Expression::new_string_literal(SPAN, " ", None, self.ast);
                let container =
                    JSXExpressionContainer::boxed(SPAN, JSXExpression::from(space_expr), self.ast);
                out.push(JSXChild::ExpressionContainer(container));
            }
            return;
        }

        let starts_with_space = text.starts_with(' ');
        let ends_with_space = text.ends_with(' ');
        let trimmed = text.trim();

        if starts_with_space && self.options.preserve_whitespace {
            let space_expr = Expression::new_string_literal(SPAN, " ", None, self.ast);
            let container =
                JSXExpressionContainer::boxed(SPAN, JSXExpression::from(space_expr), self.ast);
            out.push(JSXChild::ExpressionContainer(container));
        }

        if !trimmed.is_empty() {
            let jsx_text = JSXText::boxed(SPAN, self.allocator.alloc_str(trimmed), None, self.ast);
            out.push(JSXChild::Text(jsx_text));
        }

        if ends_with_space && self.options.preserve_whitespace {
            let space_expr = Expression::new_string_literal(SPAN, " ", None, self.ast);
            let container =
                JSXExpressionContainer::boxed(SPAN, JSXExpression::from(space_expr), self.ast);
            out.push(JSXChild::ExpressionContainer(container));
        }
    }

    fn lower_compiled_component_attribute(
        &self,
        attr: &TemplateAttribute,
        res: &ResolvedComponent,
    ) -> Option<JSXAttributeItem<'a>> {
        match attr.prefix {
            AttributePrefix::Property => {
                let camel_prop = lit_analysis::ManifestScanner::to_camel_case(&attr.name);
                let prop_id = self.allocator.alloc_str(&camel_prop);
                let attr_name =
                    JSXAttributeName::Identifier(JSXIdentifier::boxed(SPAN, prop_id, self.ast));

                match &attr.value {
                    AttributeValue::Dynamic(expr_idx) => {
                        let expr = self.clone_expression(*expr_idx);
                        let container = JSXExpressionContainer::boxed(
                            SPAN,
                            JSXExpression::from(expr),
                            self.ast,
                        );
                        Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                            SPAN,
                            attr_name,
                            Some(JSXAttributeValue::ExpressionContainer(container)),
                            self.ast,
                        )))
                    }
                    AttributeValue::Static(s) => {
                        let val_lit =
                            StringLiteral::boxed(SPAN, self.allocator.alloc_str(s), None, self.ast);
                        Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                            SPAN,
                            attr_name,
                            Some(JSXAttributeValue::StringLiteral(val_lit)),
                            self.ast,
                        )))
                    }
                    _ => None,
                }
            }
            AttributePrefix::Boolean => {
                let camel_prop = lit_analysis::ManifestScanner::to_camel_case(&attr.name);
                let prop_id = self.allocator.alloc_str(&camel_prop);
                let attr_name =
                    JSXAttributeName::Identifier(JSXIdentifier::boxed(SPAN, prop_id, self.ast));

                match &attr.value {
                    AttributeValue::Dynamic(expr_idx) => {
                        let expr = self.clone_expression(*expr_idx);
                        let container = JSXExpressionContainer::boxed(
                            SPAN,
                            JSXExpression::from(expr),
                            self.ast,
                        );
                        Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                            SPAN,
                            attr_name,
                            Some(JSXAttributeValue::ExpressionContainer(container)),
                            self.ast,
                        )))
                    }
                    AttributeValue::Static(_) => Some(JSXAttributeItem::Attribute(
                        JSXAttribute::boxed(SPAN, attr_name, None, self.ast),
                    )),
                    _ => None,
                }
            }
            AttributePrefix::Event => {
                let event_prop = lit_analysis::ManifestScanner::derive_event_prop_name(&attr.name);
                let prop_id = self.allocator.alloc_str(&event_prop);
                let attr_name =
                    JSXAttributeName::Identifier(JSXIdentifier::boxed(SPAN, prop_id, self.ast));

                match &attr.value {
                    AttributeValue::Dynamic(expr_idx) => {
                        let expr = self.clone_expression(*expr_idx);
                        let container = JSXExpressionContainer::boxed(
                            SPAN,
                            JSXExpression::from(expr),
                            self.ast,
                        );
                        Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                            SPAN,
                            attr_name,
                            Some(JSXAttributeValue::ExpressionContainer(container)),
                            self.ast,
                        )))
                    }
                    _ => None,
                }
            }
            AttributePrefix::Plain => {
                if let Some(PropertyType::Number) = res.property_types.get(&attr.name) {
                    if let AttributeValue::Static(s) = &attr.value {
                        if let Ok(num) = s.parse::<f64>() {
                            let prop_id = self.allocator.alloc_str(&attr.name);
                            let attr_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
                                SPAN, prop_id, self.ast,
                            ));
                            let num_lit = Expression::new_numeric_literal(
                                SPAN,
                                num,
                                None,
                                oxc_syntax::number::NumberBase::Decimal,
                                self.ast,
                            );
                            let container = JSXExpressionContainer::boxed(
                                SPAN,
                                JSXExpression::from(num_lit),
                                self.ast,
                            );
                            return Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                                SPAN,
                                attr_name,
                                Some(JSXAttributeValue::ExpressionContainer(container)),
                                self.ast,
                            )));
                        }
                    }
                }
                self.lower_attribute(attr, ElementNamespace::Html)
            }
        }
    }

    fn lower_uncompiled_custom_element_attribute(
        &self,
        attr: &TemplateAttribute,
    ) -> Option<JSXAttributeItem<'a>> {
        match attr.prefix {
            AttributePrefix::Property => {
                let prop_id = self.allocator.alloc_str(&attr.name);
                let attr_name =
                    JSXAttributeName::Identifier(JSXIdentifier::boxed(SPAN, prop_id, self.ast));
                match &attr.value {
                    AttributeValue::Dynamic(expr_idx) => {
                        let expr = self.clone_expression(*expr_idx);
                        let container = JSXExpressionContainer::boxed(
                            SPAN,
                            JSXExpression::from(expr),
                            self.ast,
                        );
                        Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                            SPAN,
                            attr_name,
                            Some(JSXAttributeValue::ExpressionContainer(container)),
                            self.ast,
                        )))
                    }
                    AttributeValue::Static(s) => {
                        let val_lit =
                            StringLiteral::boxed(SPAN, self.allocator.alloc_str(s), None, self.ast);
                        Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                            SPAN,
                            attr_name,
                            Some(JSXAttributeValue::StringLiteral(val_lit)),
                            self.ast,
                        )))
                    }
                    _ => None,
                }
            }
            AttributePrefix::Boolean => {
                let prop_id = self.allocator.alloc_str(&attr.name);
                let attr_name =
                    JSXAttributeName::Identifier(JSXIdentifier::boxed(SPAN, prop_id, self.ast));
                match &attr.value {
                    AttributeValue::Dynamic(expr_idx) => {
                        let test_expr = self.clone_expression(*expr_idx);
                        let consequent = Expression::new_string_literal(SPAN, "", None, self.ast);
                        let alternate = Expression::new_identifier(SPAN, "undefined", self.ast);
                        let cond = Expression::new_conditional_expression(
                            SPAN, test_expr, consequent, alternate, self.ast,
                        );
                        let container = JSXExpressionContainer::boxed(
                            SPAN,
                            JSXExpression::from(cond),
                            self.ast,
                        );
                        Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                            SPAN,
                            attr_name,
                            Some(JSXAttributeValue::ExpressionContainer(container)),
                            self.ast,
                        )))
                    }
                    AttributeValue::Static(_) => Some(JSXAttributeItem::Attribute(
                        JSXAttribute::boxed(SPAN, attr_name, None, self.ast),
                    )),
                    _ => None,
                }
            }
            AttributePrefix::Event => {
                let event_prop = lit_analysis::ManifestScanner::derive_event_prop_name(&attr.name);
                let prop_id = self.allocator.alloc_str(&event_prop);
                let attr_name =
                    JSXAttributeName::Identifier(JSXIdentifier::boxed(SPAN, prop_id, self.ast));
                match &attr.value {
                    AttributeValue::Dynamic(expr_idx) => {
                        let expr = self.clone_expression(*expr_idx);
                        let container = JSXExpressionContainer::boxed(
                            SPAN,
                            JSXExpression::from(expr),
                            self.ast,
                        );
                        Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                            SPAN,
                            attr_name,
                            Some(JSXAttributeValue::ExpressionContainer(container)),
                            self.ast,
                        )))
                    }
                    _ => None,
                }
            }
            AttributePrefix::Plain => self.lower_attribute(attr, ElementNamespace::Html),
        }
    }

    fn lower_attribute(
        &self,
        attr: &TemplateAttribute,
        ns: ElementNamespace,
    ) -> Option<JSXAttributeItem<'a>> {
        if attr.prefix == AttributePrefix::Event {
            let event_prop = lit_analysis::ManifestScanner::derive_event_prop_name(&attr.name);
            let prop_id = self.allocator.alloc_str(&event_prop);
            let attr_name =
                JSXAttributeName::Identifier(JSXIdentifier::boxed(SPAN, prop_id, self.ast));
            match &attr.value {
                AttributeValue::Dynamic(expr_idx) => {
                    let expr = self.clone_expression(*expr_idx);
                    let container =
                        JSXExpressionContainer::boxed(SPAN, JSXExpression::from(expr), self.ast);
                    return Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                        SPAN,
                        attr_name,
                        Some(JSXAttributeValue::ExpressionContainer(container)),
                        self.ast,
                    )));
                }
                _ => return None,
            }
        }

        // Map attribute name
        let attr_name_str = if ns == ElementNamespace::Svg {
            map_svg_attribute(&attr.name).unwrap_or(&attr.name)
        } else {
            map_html_attribute(&attr.name).unwrap_or(&attr.name)
        };

        let attr_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
            SPAN,
            self.allocator.alloc_str(attr_name_str),
            self.ast,
        ));

        // 1. Boolean attribute lowering:
        // - Standard boolean attributes: ?attr=${b} -> attr={b ? true : undefined}
        // - Custom / data attributes: ?data-attr=${b} -> data-attr={b ? "" : undefined}
        if attr.prefix == AttributePrefix::Boolean {
            match &attr.value {
                AttributeValue::Dynamic(expr_idx) => {
                    let test_expr = self.clone_expression(*expr_idx);
                    let is_standard_bool = is_standard_html_boolean_attribute(attr_name_str);
                    let consequent = if is_standard_bool {
                        Expression::new_boolean_literal(SPAN, true, self.ast)
                    } else {
                        Expression::new_string_literal(SPAN, "", None, self.ast)
                    };
                    let alternate = Expression::new_identifier(SPAN, "undefined", self.ast);
                    let cond = Expression::new_conditional_expression(
                        SPAN, test_expr, consequent, alternate, self.ast,
                    );
                    let container =
                        JSXExpressionContainer::boxed(SPAN, JSXExpression::from(cond), self.ast);
                    return Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                        SPAN,
                        attr_name,
                        Some(JSXAttributeValue::ExpressionContainer(container)),
                        self.ast,
                    )));
                }
                AttributeValue::Static(_) => {
                    // Boolean attribute presence
                    return Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                        SPAN, attr_name, None, self.ast,
                    )));
                }
                _ => {}
            }
        }

        // 2. Style attribute lowering
        if attr_name_str == "style" {
            if let Some(style_obj) = self.lower_style_attribute(&attr.value) {
                let container =
                    JSXExpressionContainer::boxed(SPAN, JSXExpression::from(style_obj), self.ast);
                return Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                    SPAN,
                    attr_name,
                    Some(JSXAttributeValue::ExpressionContainer(container)),
                    self.ast,
                )));
            }
        }

        // 3. Regular attributes
        match &attr.value {
            AttributeValue::Static(val) => {
                let is_id = attr_name_str.eq_ignore_ascii_case("id");
                let is_for =
                    attr_name_str == "htmlFor" || attr_name_str.eq_ignore_ascii_case("for");
                let is_idref = is_idref_attribute(attr_name_str);

                if (is_id || is_for || is_idref) && self.options.static_ids.contains(val) {
                    let left = Expression::new_identifier(SPAN, "_id", self.ast);
                    let suff_str = ["-", val].concat();
                    let suffix = self.allocator.alloc_str(&suff_str);
                    let right = Expression::new_string_literal(SPAN, suffix, None, self.ast);
                    let bin = Expression::new_binary_expression(
                        SPAN,
                        left,
                        BinaryOperator::Addition,
                        right,
                        self.ast,
                    );
                    let container =
                        JSXExpressionContainer::boxed(SPAN, JSXExpression::from(bin), self.ast);
                    return Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                        SPAN,
                        attr_name,
                        Some(JSXAttributeValue::ExpressionContainer(container)),
                        self.ast,
                    )));
                }

                let val_lit =
                    StringLiteral::boxed(SPAN, self.allocator.alloc_str(val), None, self.ast);
                Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                    SPAN,
                    attr_name,
                    Some(JSXAttributeValue::StringLiteral(val_lit)),
                    self.ast,
                )))
            }
            AttributeValue::Dynamic(expr_idx) | AttributeValue::Directive(expr_idx) => {
                if let Some(orig_expr) = self.expressions.get(*expr_idx) {
                    // Check if whole-attribute or ref directive: ${ref(myRef)}
                    if let Some(ref_arg) = is_ref_directive_call(orig_expr) {
                        let mut lowered = ref_arg.clone_in(self.allocator);
                        if self.options.is_tier0 {
                            rewrite_this_to_props(&mut lowered, self.ast);
                        } else {
                            rewrite_this_to_host(&mut lowered, self.ast);
                        }
                        let ref_attr_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
                            SPAN,
                            self.allocator.alloc_str("ref"),
                            self.ast,
                        ));
                        let container = JSXExpressionContainer::boxed(
                            SPAN,
                            JSXExpression::from(lowered),
                            self.ast,
                        );
                        return Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                            SPAN,
                            ref_attr_name,
                            Some(JSXAttributeValue::ExpressionContainer(container)),
                            self.ast,
                        )));
                    }

                    // Check live(v) on property binding: .value=${live(v)}
                    if attr.prefix == AttributePrefix::Property {
                        if let Some(live_arg) = is_live_directive_call(orig_expr) {
                            return Some(self.lower_live_property_attribute(&attr.name, live_arg));
                        }
                    }

                    // Check classMap
                    if attr_name_str == "className" || attr_name_str == "class" {
                        if let Some(class_arg) = is_class_map_call(orig_expr) {
                            return Some(self.lower_class_map_attribute(attr_name, class_arg));
                        }
                    }

                    // Check styleMap
                    if attr_name_str == "style" {
                        if let Some(style_arg) = is_style_map_call(orig_expr) {
                            return Some(self.lower_style_map_attribute(attr_name, style_arg));
                        }
                    }

                    // Check ifDefined
                    if let Some(if_def_arg) = is_if_defined_call(orig_expr) {
                        return Some(self.lower_if_defined_attribute(attr_name, if_def_arg));
                    }
                }

                let expr = self.clone_expression(*expr_idx);
                let container =
                    JSXExpressionContainer::boxed(SPAN, JSXExpression::from(expr), self.ast);
                Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                    SPAN,
                    attr_name,
                    Some(JSXAttributeValue::ExpressionContainer(container)),
                    self.ast,
                )))
            }
            AttributeValue::Mixed(parts) => {
                // If style attribute, already handled. Otherwise lower to template literal
                let mut quasis = ArenaVec::new_in(self.ast);
                let mut exprs = ArenaVec::new_in(self.ast);
                let mut current_str = String::new();

                for part in parts {
                    match part {
                        AttributePart::Static(s) => current_str.push_str(s),
                        AttributePart::Expression(idx) => {
                            let raw_text = self.allocator.alloc_str(&current_str);
                            let val = TemplateElementValue {
                                raw: raw_text.into(),
                                cooked: Some(raw_text.into()),
                            };
                            quasis.push(oxc_ast::ast::TemplateElement::new(
                                SPAN, val, false, self.ast,
                            ));
                            current_str.clear();
                            exprs.push(self.clone_expression(*idx));
                        }
                    }
                }

                let raw_text = self.allocator.alloc_str(&current_str);
                let final_val = TemplateElementValue {
                    raw: raw_text.into(),
                    cooked: Some(raw_text.into()),
                };
                quasis.push(oxc_ast::ast::TemplateElement::new(
                    SPAN, final_val, true, self.ast,
                ));

                let template_lit = Expression::new_template_literal(SPAN, quasis, exprs, self.ast);
                let container = JSXExpressionContainer::boxed(
                    SPAN,
                    JSXExpression::from(template_lit),
                    self.ast,
                );
                Some(JSXAttributeItem::Attribute(JSXAttribute::boxed(
                    SPAN,
                    attr_name,
                    Some(JSXAttributeValue::ExpressionContainer(container)),
                    self.ast,
                )))
            }
        }
    }

    fn lower_style_attribute(&self, val: &AttributeValue) -> Option<Expression<'a>> {
        match val {
            AttributeValue::Static(s) => Some(self.parse_style_string_to_object(s)),
            AttributeValue::Dynamic(expr_idx) => {
                if let Some(orig_expr) = self.expressions.get(*expr_idx) {
                    if let Some(style_arg) = is_style_map_call(orig_expr) {
                        return Some(self.lower_style_map_expression(style_arg));
                    }
                }
                Some(self.clone_expression(*expr_idx))
            }
            AttributeValue::Mixed(parts) => {
                // Mixed style: e.g. style="background-color: ${bg}; padding: 16px;"
                let mut props = ArenaVec::new_in(self.ast);
                let mut current_prop_name = String::new();
                let mut reading_val = false;

                for part in parts {
                    match part {
                        AttributePart::Static(s) => {
                            // Split declarations by ';'
                            let chunks: Vec<&str> = s.split(';').collect();
                            for (i, chunk) in chunks.iter().enumerate() {
                                if !reading_val {
                                    if let Some(colon) = chunk.find(':') {
                                        let p = chunk[..colon].trim();
                                        let v = chunk[colon + 1..].trim();
                                        if i < chunks.len() - 1 || !v.is_empty() {
                                            if !p.is_empty() && !v.is_empty() {
                                                props.push(self.create_style_object_property(
                                                    p,
                                                    Expression::new_string_literal(
                                                        SPAN,
                                                        self.allocator.alloc_str(v),
                                                        None,
                                                        self.ast,
                                                    ),
                                                ));
                                            }
                                        } else {
                                            current_prop_name = p.to_string();
                                            reading_val = true;
                                        }
                                    }
                                } else {
                                    // Finished dynamic value
                                    let v = chunk.trim();
                                    if !v.is_empty() {
                                        if let Some(colon) = v.find(':') {
                                            let p = v[..colon].trim();
                                            let val_str = v[colon + 1..].trim();
                                            if !p.is_empty() && !val_str.is_empty() {
                                                props.push(self.create_style_object_property(
                                                    p,
                                                    Expression::new_string_literal(
                                                        SPAN,
                                                        self.allocator.alloc_str(val_str),
                                                        None,
                                                        self.ast,
                                                    ),
                                                ));
                                            }
                                        }
                                    }
                                    reading_val = false;
                                }
                            }
                        }
                        AttributePart::Expression(idx) => {
                            if reading_val && !current_prop_name.is_empty() {
                                let expr = self.clone_expression(*idx);
                                props.push(
                                    self.create_style_object_property(&current_prop_name, expr),
                                );
                                current_prop_name.clear();
                                reading_val = false;
                            }
                        }
                    }
                }

                Some(Expression::new_object_expression(SPAN, props, self.ast))
            }
            AttributeValue::Directive(idx) => Some(self.clone_expression(*idx)),
        }
    }

    fn parse_style_string_to_object(&self, style_str: &str) -> Expression<'a> {
        let mut props = ArenaVec::new_in(self.ast);

        for decl in style_str.split(';') {
            let decl = decl.trim();
            if decl.is_empty() {
                continue;
            }
            if let Some(idx) = decl.find(':') {
                let name = decl[..idx].trim();
                let val = decl[idx + 1..].trim();
                if !name.is_empty() && !val.is_empty() {
                    let val_expr = Expression::new_string_literal(
                        SPAN,
                        self.allocator.alloc_str(val),
                        None,
                        self.ast,
                    );
                    props.push(self.create_style_object_property(name, val_expr));
                }
            }
        }

        Expression::new_object_expression(SPAN, props, self.ast)
    }

    fn create_style_object_property(
        &self,
        prop_name: &str,
        val_expr: Expression<'a>,
    ) -> ObjectPropertyKind<'a> {
        let is_css_var = prop_name.starts_with("--");
        let key = if is_css_var {
            PropertyKey::StringLiteral(StringLiteral::boxed(
                SPAN,
                self.allocator.alloc_str(prop_name),
                None,
                self.ast,
            ))
        } else {
            let camel = css_prop_to_camel_case(prop_name);
            PropertyKey::StaticIdentifier(IdentifierName::boxed(
                SPAN,
                self.allocator.alloc_str(&camel),
                self.ast,
            ))
        };

        let obj_prop = ObjectProperty::boxed(
            SPAN,
            PropertyKind::Init,
            key,
            val_expr,
            false,
            false,
            false,
            self.ast,
        );

        ObjectPropertyKind::ObjectProperty(obj_prop)
    }

    pub fn lower_conditional_expr(&self, cond: &ConditionalExpression<'a>) -> Expression<'a> {
        let mut test = cond.test.clone_in(self.allocator);
        self.rewrite_this(&mut test);

        let snapshot = self.save_slot_scope();

        // 1. Lower consequent branch starting from clean snapshot
        let consequent = if self.is_nothing_or_undefined_or_null(&cond.consequent) {
            Expression::new_null_literal(SPAN, self.ast)
        } else {
            self.unwrap_template_fn_or_expr(&cond.consequent, Some("branch-0"))
        };
        let consequent_slots = self.save_slot_scope();

        // 2. Restore seen_slots to snapshot before lowering alternate branch
        self.restore_slot_scope(snapshot.clone());

        let alternate = if self.is_nothing_or_undefined_or_null(&cond.alternate) {
            Expression::new_null_literal(SPAN, self.ast)
        } else {
            self.unwrap_template_fn_or_expr(&cond.alternate, Some("branch-1"))
        };
        let alternate_slots = self.save_slot_scope();

        // 3. Merge branches back to parent scope
        let is_exhaustive = !self.is_nothing_or_undefined_or_null(&cond.consequent)
            && !self.is_nothing_or_undefined_or_null(&cond.alternate);

        self.merge_conditional_slot_branches(
            snapshot,
            &[consequent_slots, alternate_slots],
            is_exhaustive,
        );

        Expression::new_conditional_expression(SPAN, test, consequent, alternate, self.ast)
    }

    pub fn lower_when_directive(
        &self,
        cond: &Expression<'a>,
        true_case: &Expression<'a>,
        false_case: Option<&Expression<'a>>,
    ) -> Expression<'a> {
        let mut lowered_cond = cond.clone_in(self.allocator);
        self.rewrite_this(&mut lowered_cond);

        let snapshot = self.save_slot_scope();

        // 1. Lower true branch
        let true_branch = self.unwrap_template_fn_or_expr(true_case, Some("when-true"));
        let true_slots = self.save_slot_scope();

        // 2. Lower false branch with restored snapshot
        let (false_branch, false_slots, is_exhaustive) = if let Some(f) = false_case {
            self.restore_slot_scope(snapshot.clone());
            let branch = self.unwrap_template_fn_or_expr(f, Some("when-false"));
            let slots = self.save_slot_scope();
            (branch, Some(slots), true)
        } else {
            (Expression::new_null_literal(SPAN, self.ast), None, false)
        };

        let mut branch_sets = vec![true_slots];
        if let Some(fs) = false_slots {
            branch_sets.push(fs);
        }

        self.merge_conditional_slot_branches(snapshot, &branch_sets, is_exhaustive);

        Expression::new_conditional_expression(
            SPAN,
            lowered_cond,
            true_branch,
            false_branch,
            self.ast,
        )
    }

    pub fn lower_choose_directive(
        &self,
        val: &Expression<'a>,
        cases: Vec<(&Expression<'a>, &Expression<'a>)>,
        default_case: Option<&Expression<'a>>,
    ) -> Expression<'a> {
        let mut lowered_val = val.clone_in(self.allocator);
        self.rewrite_this(&mut lowered_val);

        let snapshot = self.save_slot_scope();
        let mut branch_slot_sets = Vec::new();

        // 1. Lower default case
        let (default_branch, has_default) = if let Some(d) = default_case {
            self.restore_slot_scope(snapshot.clone());
            let branch = self.unwrap_template_fn_or_expr(d, None);
            branch_slot_sets.push(self.save_slot_scope());
            (branch, true)
        } else {
            (Expression::new_null_literal(SPAN, self.ast), false)
        };
        let mut acc = default_branch;

        // 2. Lower each case branch starting from clean snapshot
        for (case_val, case_fn) in cases.into_iter().rev() {
            let mut lowered_case_val = case_val.clone_in(self.allocator);
            self.rewrite_this(&mut lowered_case_val);
            let test = Expression::new_binary_expression(
                SPAN,
                lowered_val.clone_in(self.allocator),
                BinaryOperator::StrictEquality,
                lowered_case_val,
                self.ast,
            );

            self.restore_slot_scope(snapshot.clone());
            let branch = self.unwrap_template_fn_or_expr(case_fn, None);
            branch_slot_sets.push(self.save_slot_scope());

            acc = Expression::new_conditional_expression(SPAN, test, branch, acc, self.ast);
        }

        // 3. Merge branches
        self.merge_conditional_slot_branches(snapshot, &branch_slot_sets, has_default);

        acc
    }

    fn lower_child_expression(&self, expr_idx: usize) -> JSXChild<'a> {
        if expr_idx >= self.expressions.len() {
            let null_lit = Expression::new_null_literal(SPAN, self.ast);
            return JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
                SPAN,
                JSXExpression::from(null_lit),
                self.ast,
            ));
        }

        let orig_expr = &self.expressions[expr_idx];
        let peeled_expr = peel_parentheses(orig_expr);

        // 1. Check for `nothing`, `undefined`, `null` -> lower directly to `null`
        if self.is_nothing_or_undefined_or_null(peeled_expr) {
            let null_lit = Expression::new_null_literal(SPAN, self.ast);
            return JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
                SPAN,
                JSXExpression::from(null_lit),
                self.ast,
            ));
        }

        // 2. Check for when directive: when(cond, () => trueCase, () => falseCase)
        if let Some((cond, true_case, false_case)) = is_when_call(peeled_expr) {
            let cond_expr = self.lower_when_directive(cond, true_case, false_case);
            return JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
                SPAN,
                JSXExpression::from(cond_expr),
                self.ast,
            ));
        }

        // 3. Check for choose directive: choose(status, cases, defaultCase)
        if let Some((val, cases, default_case)) = is_choose_call(peeled_expr) {
            let acc = self.lower_choose_directive(val, cases, default_case);
            return JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
                SPAN,
                JSXExpression::from(acc),
                self.ast,
            ));
        }

        // 4. Check for map directive: map(items, (item, index) => html`...`)
        if let Some((items, fn_arg)) = is_map_directive_call(peeled_expr) {
            if let Some(mapped) = self.lower_map_directive(items, fn_arg) {
                return JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
                    SPAN,
                    JSXExpression::from(mapped),
                    self.ast,
                ));
            }
        }

        // 5. Check for repeat directive: repeat(items, keyFn, tmplFn)
        if let Some((items, key_fn, tmpl_fn)) = is_repeat_directive_call(peeled_expr) {
            if let Some(repeated) = self.lower_repeat_directive(items, key_fn, tmpl_fn) {
                return JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
                    SPAN,
                    JSXExpression::from(repeated),
                    self.ast,
                ));
            }
        }

        // 6. Check for join directive: join(items, sep)
        if let Some((items, sep)) = is_join_directive_call(peeled_expr) {
            let mut lowered_items = items.clone_in(self.allocator);
            let mut lowered_sep = sep.clone_in(self.allocator);
            self.rewrite_this(&mut lowered_items);
            self.rewrite_this(&mut lowered_sep);

            let join_member = Expression::new_static_member_expression(
                SPAN,
                lowered_items.clone_in(self.allocator),
                IdentifierName::new(SPAN, self.allocator.alloc_str("join"), self.ast),
                false,
                self.ast,
            );
            let mut args = ArenaVec::new_in(self.ast);
            args.push(Argument::from(lowered_sep));
            let join_call =
                Expression::new_call_expression(SPAN, join_member, None, args, false, self.ast);

            let cond = Expression::new_conditional_expression(
                SPAN,
                lowered_items,
                join_call,
                Expression::new_null_literal(SPAN, self.ast),
                self.ast,
            );
            return JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
                SPAN,
                JSXExpression::from(cond),
                self.ast,
            ));
        }

        // 7. Check for keyed directive: keyed(key, template)
        if let Some((key_expr, tmpl_expr)) = is_keyed_directive_call(peeled_expr) {
            let static_key = match key_expr {
                Expression::StringLiteral(lit) => Some(lit.value.as_str().to_string()),
                Expression::Identifier(id) => {
                    self.options.constant_strings.get(id.name.as_str()).cloned()
                }
                _ => None,
            };

            let mut lowered = self.unwrap_template_fn_or_expr(tmpl_expr, None);
            if let Some(k) = &static_key {
                inject_static_string_key_into_jsx(&mut lowered, k, self.ast);
            } else {
                let mut dynamic_key = key_expr.clone_in(self.allocator);
                self.rewrite_this(&mut dynamic_key);
                inject_expression_key_into_jsx(&mut lowered, dynamic_key, self.ast);
            }
            return JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
                SPAN,
                JSXExpression::from(lowered),
                self.ast,
            ));
        }

        // 8. Check for guard directive: guard(deps, () => template)
        if let Some((_deps, tmpl_fn)) = is_guard_directive_call(peeled_expr) {
            let lowered = self.unwrap_template_fn_or_expr(tmpl_fn, None);
            return JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
                SPAN,
                JSXExpression::from(lowered),
                self.ast,
            ));
        }

        // 9. Check for ifDefined in child position
        if let Some(inner) = is_if_defined_call(peeled_expr) {
            let mut lowered = inner.clone_in(self.allocator);
            self.rewrite_this(&mut lowered);
            let coalesce = Expression::new_logical_expression(
                SPAN,
                lowered,
                LogicalOperator::Coalesce,
                Expression::new_null_literal(SPAN, self.ast),
                self.ast,
            );
            return JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
                SPAN,
                JSXExpression::from(coalesce),
                self.ast,
            ));
        }

        // 10. Check for conditional expression with template branch keying (F54)
        if let Expression::ConditionalExpression(cond) = peeled_expr {
            let new_cond = self.lower_conditional_expr(cond);
            return JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
                SPAN,
                JSXExpression::from(new_cond),
                self.ast,
            ));
        }

        // 11. Check for array mapping: tags.map(t => html`<span>${t}</span>`) -> inject positional key
        if let Some(mapped_call) = self.try_lower_unkeyed_array_map(peeled_expr) {
            return JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
                SPAN,
                JSXExpression::from(mapped_call),
                self.ast,
            ));
        }

        // 12. Check for direct TaggedTemplateExpression in child hole
        if let Expression::TaggedTemplateExpression(_) = peeled_expr {
            let lowered = self.unwrap_template_fn_or_expr(peeled_expr, None);
            return JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
                SPAN,
                JSXExpression::from(lowered),
                self.ast,
            ));
        }

        let mut cloned = peeled_expr.clone_in(self.allocator);
        self.rewrite_this(&mut cloned);
        JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
            SPAN,
            JSXExpression::from(cloned),
            self.ast,
        ))
    }

    fn unwrap_template_fn_or_expr<'e>(
        &self,
        expr: &'e Expression<'a>,
        key_for_branch: Option<&str>,
    ) -> Expression<'a> {
        if let Some(target) = extract_target_expression(expr) {
            let peeled_target = peel_parentheses(target);

            // 1. Check for `nothing`, `undefined`, `null`
            if self.is_nothing_or_undefined_or_null(peeled_target) {
                return Expression::new_null_literal(SPAN, self.ast);
            }

            // 2. Check for `when(...)` directive call
            if let Some((cond, true_case, false_case)) = is_when_call(peeled_target) {
                return self.lower_when_directive(cond, true_case, false_case);
            }

            // 3. Check for `choose(...)` directive call
            if let Some((val, cases, default_case)) = is_choose_call(peeled_target) {
                return self.lower_choose_directive(val, cases, default_case);
            }

            // 4. Check for nested `ConditionalExpression`
            if let Expression::ConditionalExpression(cond) = peeled_target {
                return self.lower_conditional_expr(cond);
            }

            // 5. Check for `TaggedTemplateExpression`
            if let Expression::TaggedTemplateExpression(tagged) = peeled_target {
                let quasis: Vec<&str> = tagged
                    .quasi
                    .quasis
                    .iter()
                    .map(|q| q.value.raw.as_str())
                    .collect();
                let count = tagged.quasi.expressions.len();
                if let Ok(inner_ir) =
                    lit_analysis::TemplateParser::parse_lit_template(&quasis, count)
                {
                    let mut sub_emitter = JsxEmitter::new(
                        self.ast,
                        self.allocator,
                        &tagged.quasi.expressions,
                        self.options.clone(),
                        None,
                    );
                    *sub_emitter.seen_slots.borrow_mut() = self.seen_slots.borrow().clone();
                    let mut lowered = sub_emitter.lower_template(&inner_ir);
                    for helper in sub_emitter.required_runtime_imports.borrow().iter() {
                        self.required_runtime_imports
                            .borrow_mut()
                            .insert(helper.clone());
                    }
                    *self.seen_slots.borrow_mut() = sub_emitter.seen_slots.borrow().clone();
                    if let Expression::JSXFragment(frag) = &mut lowered {
                        let elem_count = frag
                            .children
                            .iter()
                            .filter(|c| matches!(c, JSXChild::Element(_)))
                            .count();
                        let non_ws_count = frag
                            .children
                            .iter()
                            .filter(|c| match c {
                                JSXChild::Text(t) => !t.value.trim().is_empty(),
                                _ => true,
                            })
                            .count();
                        if elem_count == 1 && non_ws_count == 1 {
                            if let Some(pos) = frag
                                .children
                                .iter()
                                .position(|c| matches!(c, JSXChild::Element(_)))
                            {
                                if let JSXChild::Element(el) = frag.children.remove(pos) {
                                    lowered = Expression::JSXElement(el);
                                }
                            }
                        }
                    }
                    if let Some(k) = key_for_branch {
                        inject_static_string_key_into_jsx(&mut lowered, k, self.ast);
                    }
                    return lowered;
                }
            }

            // 6. Fallback: arbitrary expression (e.g. primitive value, identifier, member expression)
            let mut cloned = peeled_target.clone_in(self.allocator);
            self.rewrite_this(&mut cloned);
            if let Some(k) = key_for_branch {
                inject_static_string_key_into_jsx(&mut cloned, k, self.ast);
            }
            cloned
        } else {
            Expression::new_null_literal(SPAN, self.ast)
        }
    }

    fn lower_map_directive(
        &self,
        items: &Expression<'a>,
        fn_arg: &Expression<'a>,
    ) -> Option<Expression<'a>> {
        let mut lowered_items = items.clone_in(self.allocator);
        lower_range_in_expression(
            &mut lowered_items,
            self.ast,
            Some(&self.required_runtime_imports),
        );
        if self.options.is_tier0 {
            rewrite_this_to_props(&mut lowered_items, self.ast);
        } else {
            rewrite_this_to_host(&mut lowered_items, self.ast);
        }

        if let Expression::ArrowFunctionExpression(arrow) = fn_arg {
            let mut new_params = ArenaVec::new_in(self.ast);
            for p in &arrow.params.items {
                new_params.push(p.clone_in(self.allocator));
            }
            let key_name = if new_params.len() >= 2 {
                if let BindingPattern::BindingIdentifier(id) = &new_params[1].pattern {
                    id.name.as_str()
                } else {
                    "index"
                }
            } else {
                let index_binding = BindingPattern::new_binding_identifier(SPAN, "index", self.ast);
                let index_param = FormalParameter::new_plain(SPAN, index_binding, self.ast);
                new_params.push(index_param);
                "index"
            };

            let mut lowered_body = self.unwrap_template_fn_or_expr(fn_arg, None);
            inject_key_into_jsx(&mut lowered_body, key_name, self.ast);

            let new_arrow = Expression::ArrowFunctionExpression(ArrowFunctionExpression::boxed(
                SPAN,
                false,
                None,
                FormalParameters::boxed(
                    SPAN,
                    FormalParameterKind::ArrowFormalParameters,
                    new_params,
                    None,
                    self.ast,
                ),
                None,
                ArrowFunctionBody::from(lowered_body),
                self.ast,
            ));

            let map_member = Expression::new_static_member_expression(
                SPAN,
                lowered_items.clone_in(self.allocator),
                IdentifierName::new(SPAN, self.allocator.alloc_str("map"), self.ast),
                false,
                self.ast,
            );
            let mut map_args = ArenaVec::new_in(self.ast);
            map_args.push(Argument::from(new_arrow));
            let map_call =
                Expression::new_call_expression(SPAN, map_member, None, map_args, false, self.ast);

            let cond_expr = Expression::new_conditional_expression(
                SPAN,
                lowered_items,
                map_call,
                Expression::new_null_literal(SPAN, self.ast),
                self.ast,
            );
            return Some(cond_expr);
        }
        None
    }

    fn lower_repeat_directive(
        &self,
        items: &Expression<'a>,
        key_fn: Option<&Expression<'a>>,
        template_fn: &Expression<'a>,
    ) -> Option<Expression<'a>> {
        let mut lowered_items = items.clone_in(self.allocator);
        lower_range_in_expression(
            &mut lowered_items,
            self.ast,
            Some(&self.required_runtime_imports),
        );
        if self.options.is_tier0 {
            rewrite_this_to_props(&mut lowered_items, self.ast);
        } else {
            rewrite_this_to_host(&mut lowered_items, self.ast);
        }

        if let Expression::ArrowFunctionExpression(arrow) = template_fn {
            let mut new_params = ArenaVec::new_in(self.ast);
            for p in &arrow.params.items {
                new_params.push(p.clone_in(self.allocator));
            }

            let mut lowered_body = self.unwrap_template_fn_or_expr(template_fn, None);

            let key_name = if let Some(Expression::ArrowFunctionExpression(key_arrow)) = key_fn {
                if let Some(key_expr) = key_arrow.body.as_expression() {
                    let mut cloned_key = key_expr.clone_in(self.allocator);
                    if self.options.is_tier0 {
                        rewrite_this_to_props(&mut cloned_key, self.ast);
                    } else {
                        rewrite_this_to_host(&mut cloned_key, self.ast);
                    }
                    inject_expression_key_into_jsx(&mut lowered_body, cloned_key, self.ast);
                    None
                } else {
                    Some("index")
                }
            } else {
                let name = if new_params.len() >= 2 {
                    if let BindingPattern::BindingIdentifier(id) = &new_params[1].pattern {
                        id.name.as_str()
                    } else {
                        "index"
                    }
                } else {
                    let index_binding =
                        BindingPattern::new_binding_identifier(SPAN, "index", self.ast);
                    let index_param = FormalParameter::new_plain(SPAN, index_binding, self.ast);
                    new_params.push(index_param);
                    "index"
                };
                Some(name)
            };

            if let Some(name) = key_name {
                inject_key_into_jsx(&mut lowered_body, name, self.ast);
            }

            let new_arrow = Expression::ArrowFunctionExpression(ArrowFunctionExpression::boxed(
                SPAN,
                false,
                None,
                FormalParameters::boxed(
                    SPAN,
                    FormalParameterKind::ArrowFormalParameters,
                    new_params,
                    None,
                    self.ast,
                ),
                None,
                ArrowFunctionBody::from(lowered_body),
                self.ast,
            ));

            let map_member = Expression::new_static_member_expression(
                SPAN,
                lowered_items.clone_in(self.allocator),
                IdentifierName::new(SPAN, self.allocator.alloc_str("map"), self.ast),
                false,
                self.ast,
            );
            let mut map_args = ArenaVec::new_in(self.ast);
            map_args.push(Argument::from(new_arrow));
            let map_call =
                Expression::new_call_expression(SPAN, map_member, None, map_args, false, self.ast);

            let cond_expr = Expression::new_conditional_expression(
                SPAN,
                lowered_items,
                map_call,
                Expression::new_null_literal(SPAN, self.ast),
                self.ast,
            );
            return Some(cond_expr);
        }
        None
    }

    fn lower_class_map_attribute(
        &self,
        attr_name: JSXAttributeName<'a>,
        arg: &Expression<'a>,
    ) -> JSXAttributeItem<'a> {
        if let Expression::ObjectExpression(obj) = arg {
            let mut static_classes = Vec::new();
            let mut dynamic_classes: Vec<(String, Expression<'a>)> = Vec::new();

            for prop in &obj.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                    let key_str = match &p.key {
                        PropertyKey::StaticIdentifier(id) => Some(id.name.to_string()),
                        PropertyKey::StringLiteral(s) => Some(s.value.to_string()),
                        _ => None,
                    };
                    if let Some(key) = key_str {
                        match &p.value {
                            Expression::BooleanLiteral(b) => {
                                if b.value {
                                    static_classes.push(key);
                                }
                            }
                            Expression::NumericLiteral(n) => {
                                if n.value != 0.0 {
                                    static_classes.push(key);
                                }
                            }
                            _ => {
                                let mut cond = p.value.clone_in(self.allocator);
                                if self.options.is_tier0 {
                                    rewrite_this_to_props(&mut cond, self.ast);
                                } else {
                                    rewrite_this_to_host(&mut cond, self.ast);
                                }
                                dynamic_classes.push((key, cond));
                            }
                        }
                    }
                }
            }

            if dynamic_classes.is_empty() {
                let base_str = self.allocator.alloc_str(&static_classes.join(" "));
                return JSXAttributeItem::Attribute(JSXAttribute::boxed(
                    SPAN,
                    attr_name,
                    Some(JSXAttributeValue::StringLiteral(StringLiteral::boxed(
                        SPAN, base_str, None, self.ast,
                    ))),
                    self.ast,
                ));
            }

            let mut acc: Option<Expression<'a>> = if !static_classes.is_empty() {
                Some(Expression::new_string_literal(
                    SPAN,
                    self.allocator.alloc_str(&static_classes.join(" ")),
                    None,
                    self.ast,
                ))
            } else {
                None
            };

            for (key, cond) in dynamic_classes {
                let spaced_str = [" ", &key].concat();
                let spaced_key = self.allocator.alloc_str(&spaced_str);
                let key_lit = Expression::new_string_literal(SPAN, spaced_key, None, self.ast);
                let empty_lit = Expression::new_string_literal(SPAN, "", None, self.ast);
                let ternary = Expression::new_conditional_expression(
                    SPAN, cond, key_lit, empty_lit, self.ast,
                );
                acc = match acc {
                    Some(cur) => Some(Expression::new_binary_expression(
                        SPAN,
                        cur,
                        BinaryOperator::Addition,
                        ternary,
                        self.ast,
                    )),
                    None => Some(ternary),
                };
            }

            let final_expr =
                acc.unwrap_or_else(|| Expression::new_string_literal(SPAN, "", None, self.ast));
            let container =
                JSXExpressionContainer::boxed(SPAN, JSXExpression::from(final_expr), self.ast);
            JSXAttributeItem::Attribute(JSXAttribute::boxed(
                SPAN,
                attr_name,
                Some(JSXAttributeValue::ExpressionContainer(container)),
                self.ast,
            ))
        } else {
            let mut lowered_arg = arg.clone_in(self.allocator);
            if self.options.is_tier0 {
                rewrite_this_to_props(&mut lowered_arg, self.ast);
            } else {
                rewrite_this_to_host(&mut lowered_arg, self.ast);
            }
            let callee = Expression::new_identifier(SPAN, "_classMap", self.ast);
            self.required_runtime_imports
                .borrow_mut()
                .insert("_classMap".to_string());
            let mut args = ArenaVec::new_in(self.ast);
            args.push(Argument::from(lowered_arg));
            let call = Expression::new_call_expression(SPAN, callee, None, args, false, self.ast);
            let container =
                JSXExpressionContainer::boxed(SPAN, JSXExpression::from(call), self.ast);
            JSXAttributeItem::Attribute(JSXAttribute::boxed(
                SPAN,
                attr_name,
                Some(JSXAttributeValue::ExpressionContainer(container)),
                self.ast,
            ))
        }
    }

    fn lower_style_map_expression(&self, arg: &Expression<'a>) -> Expression<'a> {
        if let Expression::ObjectExpression(obj) = arg {
            let mut obj_props = ArenaVec::new_in(self.ast);
            for prop in &obj.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                    let key_name = match &p.key {
                        PropertyKey::StaticIdentifier(id) => Some(id.name.to_string()),
                        PropertyKey::StringLiteral(s) => Some(s.value.to_string()),
                        _ => None,
                    };
                    if let Some(key) = key_name {
                        let transformed_key = if key.starts_with("--") {
                            PropertyKey::StringLiteral(StringLiteral::boxed(
                                SPAN,
                                self.allocator.alloc_str(&key),
                                None,
                                self.ast,
                            ))
                        } else {
                            let camel = css_prop_to_camel_case(&key);
                            PropertyKey::StaticIdentifier(IdentifierName::boxed(
                                SPAN,
                                self.allocator.alloc_str(&camel),
                                self.ast,
                            ))
                        };
                        let mut val = p.value.clone_in(self.allocator);
                        if self.options.is_tier0 {
                            rewrite_this_to_props(&mut val, self.ast);
                        } else {
                            rewrite_this_to_host(&mut val, self.ast);
                        }
                        obj_props.push(ObjectPropertyKind::new_object_property(
                            SPAN,
                            PropertyKind::Init,
                            transformed_key,
                            val,
                            false,
                            false,
                            false,
                            self.ast,
                        ));
                    }
                }
            }
            Expression::new_object_expression(SPAN, obj_props, self.ast)
        } else {
            let mut lowered_arg = arg.clone_in(self.allocator);
            if self.options.is_tier0 {
                rewrite_this_to_props(&mut lowered_arg, self.ast);
            } else {
                rewrite_this_to_host(&mut lowered_arg, self.ast);
            }
            let callee = Expression::new_identifier(SPAN, "_styleMap", self.ast);
            self.required_runtime_imports
                .borrow_mut()
                .insert("_styleMap".to_string());
            let mut args = ArenaVec::new_in(self.ast);
            args.push(Argument::from(lowered_arg));
            Expression::new_call_expression(SPAN, callee, None, args, false, self.ast)
        }
    }

    fn lower_style_map_attribute(
        &self,
        attr_name: JSXAttributeName<'a>,
        arg: &Expression<'a>,
    ) -> JSXAttributeItem<'a> {
        let style_obj = self.lower_style_map_expression(arg);
        let container =
            JSXExpressionContainer::boxed(SPAN, JSXExpression::from(style_obj), self.ast);
        JSXAttributeItem::Attribute(JSXAttribute::boxed(
            SPAN,
            attr_name,
            Some(JSXAttributeValue::ExpressionContainer(container)),
            self.ast,
        ))
    }

    fn lower_if_defined_attribute(
        &self,
        attr_name: JSXAttributeName<'a>,
        arg: &Expression<'a>,
    ) -> JSXAttributeItem<'a> {
        let mut lowered = arg.clone_in(self.allocator);
        if self.options.is_tier0 {
            rewrite_this_to_props(&mut lowered, self.ast);
        } else {
            rewrite_this_to_host(&mut lowered, self.ast);
        }
        let undefined_ident = Expression::new_identifier(SPAN, "undefined", self.ast);
        let coalesce = Expression::new_logical_expression(
            SPAN,
            lowered,
            LogicalOperator::Coalesce,
            undefined_ident,
            self.ast,
        );
        let container =
            JSXExpressionContainer::boxed(SPAN, JSXExpression::from(coalesce), self.ast);
        JSXAttributeItem::Attribute(JSXAttribute::boxed(
            SPAN,
            attr_name,
            Some(JSXAttributeValue::ExpressionContainer(container)),
            self.ast,
        ))
    }

    fn lower_live_property_attribute(
        &self,
        prop_name: &str,
        arg: &Expression<'a>,
    ) -> JSXAttributeItem<'a> {
        let param_pat = BindingPattern::new_binding_identifier(SPAN, "el", self.ast);
        let param = FormalParameter::new_plain(SPAN, param_pat, self.ast);
        let mut params = ArenaVec::new_in(self.ast);
        params.push(param);
        let formal_params = FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            params,
            None,
            self.ast,
        );

        let mut lowered_val = arg.clone_in(self.allocator);
        if self.options.is_tier0 {
            rewrite_this_to_props(&mut lowered_val, self.ast);
        } else {
            rewrite_this_to_host(&mut lowered_val, self.ast);
        }

        let assign_expr = Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            AssignmentTarget::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "el", self.ast),
                IdentifierName::new(SPAN, self.allocator.alloc_str(prop_name), self.ast),
                false,
                self.ast,
            ),
            lowered_val,
            self.ast,
        );
        let assign_stmt =
            Statement::ExpressionStatement(ExpressionStatement::boxed(SPAN, assign_expr, self.ast));

        let if_stmt = Statement::IfStatement(IfStatement::boxed(
            SPAN,
            Expression::new_identifier(SPAN, "el", self.ast),
            assign_stmt,
            None,
            self.ast,
        ));

        let mut stmts = ArenaVec::new_in(self.ast);
        stmts.push(if_stmt);
        let func_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(self.ast), stmts, self.ast);

        let arrow_fn = Expression::ArrowFunctionExpression(ArrowFunctionExpression::boxed(
            SPAN,
            false,
            None,
            formal_params,
            None,
            ArrowFunctionBody::FunctionBody(func_body),
            self.ast,
        ));

        let ref_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
            SPAN,
            self.allocator.alloc_str("ref"),
            self.ast,
        ));
        let container =
            JSXExpressionContainer::boxed(SPAN, JSXExpression::from(arrow_fn), self.ast);
        JSXAttributeItem::Attribute(JSXAttribute::boxed(
            SPAN,
            ref_name,
            Some(JSXAttributeValue::ExpressionContainer(container)),
            self.ast,
        ))
    }

    fn try_lower_unkeyed_array_map(&self, expr: &Expression<'a>) -> Option<Expression<'a>> {
        if let Expression::CallExpression(call) = expr {
            let is_map = match &call.callee {
                Expression::StaticMemberExpression(m) => m.property.name == "map",
                _ => false,
            };

            if is_map && !call.arguments.is_empty() {
                if let Argument::ArrowFunctionExpression(arrow) = &call.arguments[0] {
                    // If arrow has 1 parameter, add index: (t, index) => ...
                    let mut new_params = ArenaVec::new_in(self.ast);
                    for p in &arrow.params.items {
                        new_params.push(p.clone_in(self.allocator));
                    }
                    if new_params.len() == 1 {
                        let index_binding =
                            BindingPattern::new_binding_identifier(SPAN, "index", self.ast);
                        let index_param = FormalParameter::new_plain(SPAN, index_binding, self.ast);
                        new_params.push(index_param);
                    }

                    // Check return expression for tagged template or JSX
                    let new_body = if let Some(concise_expr) = arrow.body.as_expression() {
                        let mut lowered_body_expr = concise_expr.clone_in(self.allocator);
                        if let Expression::TaggedTemplateExpression(tagged) = &lowered_body_expr {
                            let quasis: Vec<&str> = tagged
                                .quasi
                                .quasis
                                .iter()
                                .map(|q| q.value.raw.as_str())
                                .collect();
                            let count = tagged.quasi.expressions.len();
                            if let Ok(inner_ir) =
                                lit_analysis::TemplateParser::parse_lit_template(&quasis, count)
                            {
                                let mut sub_emitter = JsxEmitter::new(
                                    self.ast,
                                    self.allocator,
                                    &tagged.quasi.expressions,
                                    self.options.clone(),
                                    None,
                                );
                                let mut lowered_jsx = sub_emitter.lower_template(&inner_ir);
                                inject_key_into_jsx(&mut lowered_jsx, "index", self.ast);
                                lowered_body_expr = lowered_jsx;
                            }
                        } else if let Expression::JSXElement(jsx_el) = &mut lowered_body_expr {
                            inject_key_into_jsx_elem(jsx_el, "index", self.ast);
                        } else {
                            rewrite_this_to_props(&mut lowered_body_expr, self.ast);
                        }
                        ArrowFunctionBody::from(lowered_body_expr)
                    } else if let ArrowFunctionBody::FunctionBody(b) = &arrow.body {
                        let mut new_stmts = ArenaVec::new_in(self.ast);
                        for stmt in &b.statements {
                            let mut new_stmt = stmt.clone_in(self.allocator);
                            if let Statement::ReturnStatement(ret) = &mut new_stmt {
                                if let Some(ret_arg) = &mut ret.argument {
                                    if let Expression::TaggedTemplateExpression(tagged) = ret_arg {
                                        let quasis: Vec<&str> = tagged
                                            .quasi
                                            .quasis
                                            .iter()
                                            .map(|q| q.value.raw.as_str())
                                            .collect();
                                        let count = tagged.quasi.expressions.len();
                                        if let Ok(inner_ir) =
                                            lit_analysis::TemplateParser::parse_lit_template(
                                                &quasis, count,
                                            )
                                        {
                                            let mut sub_emitter = JsxEmitter::new(
                                                self.ast,
                                                self.allocator,
                                                &tagged.quasi.expressions,
                                                self.options.clone(),
                                                None,
                                            );
                                            let mut lowered_jsx =
                                                sub_emitter.lower_template(&inner_ir);
                                            inject_key_into_jsx(
                                                &mut lowered_jsx,
                                                "index",
                                                self.ast,
                                            );
                                            *ret_arg = lowered_jsx;
                                        }
                                    } else if let Expression::JSXElement(jsx_el) = ret_arg {
                                        inject_key_into_jsx_elem(jsx_el, "index", self.ast);
                                    } else {
                                        rewrite_this_to_props(ret_arg, self.ast);
                                    }
                                }
                            } else {
                                rewrite_statement_this_to_props(&mut new_stmt, self.ast);
                            }
                            new_stmts.push(new_stmt);
                        }
                        let body_box = FunctionBody::boxed(
                            SPAN,
                            ArenaVec::new_in(self.ast),
                            new_stmts,
                            self.ast,
                        );
                        ArrowFunctionBody::FunctionBody(body_box)
                    } else {
                        let mut body_clone = arrow.body.clone_in(self.allocator);
                        if let Some(e) = body_clone.as_expression_mut() {
                            rewrite_this_to_props(e, self.ast);
                        }
                        body_clone
                    };

                    let formal_params = FormalParameters::boxed(
                        SPAN,
                        FormalParameterKind::ArrowFormalParameters,
                        new_params,
                        None,
                        self.ast,
                    );

                    let new_arrow = Expression::new_arrow_function_expression(
                        arrow.span,
                        arrow.r#async,
                        None,
                        formal_params,
                        None,
                        new_body,
                        self.ast,
                    );

                    let mut new_args = ArenaVec::new_in(self.ast);
                    new_args.push(Argument::from(new_arrow));
                    for arg in call.arguments.iter().skip(1) {
                        let mut cloned_arg = arg.clone_in(self.allocator);
                        rewrite_argument_this_to_props(&mut cloned_arg, self.ast);
                        new_args.push(cloned_arg);
                    }

                    // Callee rewrite: this.items.map -> props.items.map
                    let mut new_callee = call.callee.clone_in(self.allocator);
                    rewrite_this_to_props(&mut new_callee, self.ast);

                    let new_call = Expression::new_call_expression(
                        call.span,
                        new_callee,
                        call.type_arguments.clone_in(self.allocator),
                        new_args,
                        call.optional,
                        self.ast,
                    );

                    return Some(new_call);
                }
            }
        }
        None
    }

    fn is_nothing_or_undefined_or_null(&self, expr: &Expression<'a>) -> bool {
        match peel_parentheses(expr) {
            Expression::Identifier(id) => id.name == "nothing" || id.name == "undefined",
            Expression::NullLiteral(_) => true,
            _ => false,
        }
    }

    pub fn rewrite_this(&self, expr: &mut Expression<'a>) {
        match self.options.this_rewriting {
            ThisRewritingTarget::Props => rewrite_this_to_props(expr, self.ast),
            ThisRewritingTarget::Host => rewrite_this_to_host(expr, self.ast),
            ThisRewritingTarget::Preserve => {}
        }
    }

    fn clone_expression(&self, idx: usize) -> Expression<'a> {
        if idx < self.expressions.len() {
            let mut expr = self.expressions[idx].clone_in(self.allocator);
            if self.options.is_host_method {
                // Preserve this inside host class methods
            } else {
                rewrite_this_to_props(&mut expr, self.ast);
            }
            expr
        } else {
            Expression::new_null_literal(SPAN, self.ast)
        }
    }
}

/// Recursively rewrites `this` and `this.*` accesses to `props` and `props.*`.
pub fn rewrite_this_to_props<'a>(expr: &mut Expression<'a>, ast: &AstBuilder<'a>) {
    // 1. Direct this expression: replace `this` with identifier `props`
    if let Expression::ThisExpression(_) = expr {
        *expr = Expression::new_identifier(SPAN, "props", ast);
        return;
    }

    // 2. Recursive descent across all compound expression types
    match expr {
        // Member access: static & computed
        Expression::StaticMemberExpression(m) => {
            rewrite_this_to_props(&mut m.object, ast);
        }
        Expression::ComputedMemberExpression(m) => {
            rewrite_this_to_props(&mut m.object, ast);
            rewrite_this_to_props(&mut m.expression, ast);
        }

        // Optional chaining: this?.user?.name, this.items?.map(...)
        Expression::ChainExpression(chain) => {
            rewrite_chain_element_this_to_props(&mut chain.expression, ast);
        }

        // Function invocations & constructor calls
        Expression::CallExpression(c) => {
            rewrite_this_to_props(&mut c.callee, ast);
            for arg in &mut c.arguments {
                rewrite_argument_this_to_props(arg, ast);
            }
        }
        Expression::NewExpression(n) => {
            rewrite_this_to_props(&mut n.callee, ast);
            for arg in &mut n.arguments {
                rewrite_argument_this_to_props(arg, ast);
            }
        }

        // Conditionals & branches: cond ? consequent : alternate
        Expression::ConditionalExpression(c) => {
            rewrite_this_to_props(&mut c.test, ast);
            rewrite_this_to_props(&mut c.consequent, ast);
            rewrite_this_to_props(&mut c.alternate, ast);
        }

        // Operators: binary, unary, logical
        Expression::BinaryExpression(b) => {
            rewrite_this_to_props(&mut b.left, ast);
            rewrite_this_to_props(&mut b.right, ast);
        }
        Expression::UnaryExpression(u) => {
            rewrite_this_to_props(&mut u.argument, ast);
        }
        Expression::LogicalExpression(l) => {
            rewrite_this_to_props(&mut l.left, ast);
            rewrite_this_to_props(&mut l.right, ast);
        }

        // Grouping & sequences
        Expression::ParenthesizedExpression(p) => {
            rewrite_this_to_props(&mut p.expression, ast);
        }
        Expression::SequenceExpression(s) => {
            for e in &mut s.expressions {
                rewrite_this_to_props(e, ast);
            }
        }

        // String templates: `Hello ${this.name}` & tag`${this.foo}`
        Expression::TemplateLiteral(t) => {
            for e in &mut t.expressions {
                rewrite_this_to_props(e, ast);
            }
        }
        Expression::TaggedTemplateExpression(tagged) => {
            rewrite_this_to_props(&mut tagged.tag, ast);
            for e in &mut tagged.quasi.expressions {
                rewrite_this_to_props(e, ast);
            }
        }

        // Collection literals: arrays & objects
        Expression::ArrayExpression(arr) => {
            for el in &mut arr.elements {
                match el {
                    ArrayExpressionElement::SpreadElement(s) => {
                        rewrite_this_to_props(&mut s.argument, ast);
                    }
                    _ => {
                        if let Some(e) = el.as_expression_mut() {
                            rewrite_this_to_props(e, ast);
                        }
                    }
                }
            }
        }
        Expression::ObjectExpression(obj) => {
            for prop in &mut obj.properties {
                match prop {
                    ObjectPropertyKind::ObjectProperty(p) => {
                        if let Some(e) = p.key.as_expression_mut() {
                            rewrite_this_to_props(e, ast);
                        }
                        rewrite_this_to_props(&mut p.value, ast);
                    }
                    ObjectPropertyKind::SpreadProperty(s) => {
                        rewrite_this_to_props(&mut s.argument, ast);
                    }
                }
            }
        }

        // Arrow functions & function expressions: (item) => this.format(item)
        Expression::ArrowFunctionExpression(arrow) => match &mut arrow.body {
            ArrowFunctionBody::FunctionBody(b) => {
                for s in &mut b.statements {
                    rewrite_statement_this_to_props(s, ast);
                }
            }
            _ => {
                if let Some(e) = arrow.body.as_expression_mut() {
                    rewrite_this_to_props(e, ast);
                }
            }
        },
        Expression::FunctionExpression(func) => {
            if let Some(b) = &mut func.body {
                for s in &mut b.statements {
                    rewrite_statement_this_to_props(s, ast);
                }
            }
        }

        // Assignments & async expressions
        Expression::AssignmentExpression(a) => {
            rewrite_this_to_props(&mut a.right, ast);
        }
        Expression::AwaitExpression(a) => {
            rewrite_this_to_props(&mut a.argument, ast);
        }

        // TypeScript type cast & assertion wrappers
        Expression::TSAsExpression(a) => {
            rewrite_this_to_props(&mut a.expression, ast);
        }
        Expression::TSTypeAssertion(t) => {
            rewrite_this_to_props(&mut t.expression, ast);
        }
        Expression::TSNonNullExpression(n) => {
            rewrite_this_to_props(&mut n.expression, ast);
        }
        Expression::TSInstantiationExpression(i) => {
            rewrite_this_to_props(&mut i.expression, ast);
        }

        _ => {}
    }
}

fn rewrite_chain_element_this_to_props<'a>(elem: &mut ChainElement<'a>, ast: &AstBuilder<'a>) {
    match elem {
        ChainElement::CallExpression(c) => {
            rewrite_this_to_props(&mut c.callee, ast);
            for arg in &mut c.arguments {
                rewrite_argument_this_to_props(arg, ast);
            }
        }
        ChainElement::StaticMemberExpression(m) => {
            rewrite_this_to_props(&mut m.object, ast);
        }
        ChainElement::ComputedMemberExpression(m) => {
            rewrite_this_to_props(&mut m.object, ast);
            rewrite_this_to_props(&mut m.expression, ast);
        }
        ChainElement::TSNonNullExpression(n) => {
            rewrite_this_to_props(&mut n.expression, ast);
        }
        ChainElement::PrivateFieldExpression(m) => {
            rewrite_this_to_props(&mut m.object, ast);
        }
    }
}

fn rewrite_argument_this_to_props<'a>(arg: &mut Argument<'a>, ast: &AstBuilder<'a>) {
    match arg {
        Argument::SpreadElement(s) => rewrite_this_to_props(&mut s.argument, ast),
        _ => {
            if let Some(e) = arg.as_expression_mut() {
                rewrite_this_to_props(e, ast);
            }
        }
    }
}

fn rewrite_statement_this_to_props<'a>(stmt: &mut Statement<'a>, ast: &AstBuilder<'a>) {
    match stmt {
        Statement::VariableDeclaration(var_decl) => {
            for decl in &mut var_decl.declarations {
                if let Some(init) = &mut decl.init {
                    rewrite_this_to_props(init, ast);
                }
            }
        }
        Statement::ExpressionStatement(s) => {
            rewrite_this_to_props(&mut s.expression, ast);
        }
        Statement::ReturnStatement(ret) => {
            if let Some(arg) = &mut ret.argument {
                rewrite_this_to_props(arg, ast);
            }
        }
        Statement::IfStatement(ifs) => {
            rewrite_this_to_props(&mut ifs.test, ast);
            rewrite_statement_this_to_props(&mut ifs.consequent, ast);
            if let Some(alt) = &mut ifs.alternate {
                rewrite_statement_this_to_props(alt, ast);
            }
        }
        Statement::BlockStatement(b) => {
            for s in &mut b.body {
                rewrite_statement_this_to_props(s, ast);
            }
        }
        _ => {}
    }
}

pub fn inject_key_into_jsx<'a>(expr: &mut Expression<'a>, key_var: &str, ast: &AstBuilder<'a>) {
    match expr {
        Expression::JSXElement(el) => {
            inject_key_into_jsx_elem(el, key_var, ast);
        }
        Expression::JSXFragment(frag) => {
            for child in &mut frag.children {
                if let JSXChild::Element(el) = child {
                    inject_key_into_jsx_elem(el, key_var, ast);
                }
            }
        }
        _ => {}
    }
}

pub fn inject_key_into_jsx_elem<'a>(el: &mut JSXElement<'a>, key_var: &str, ast: &AstBuilder<'a>) {
    for attr in &el.opening_element.attributes {
        if let JSXAttributeItem::Attribute(a) = attr {
            if let JSXAttributeName::Identifier(id) = &a.name {
                if id.name == "key" {
                    return;
                }
            }
        }
    }

    let key_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
        SPAN,
        ast.allocator().alloc_str("key"),
        ast,
    ));
    let key_expr = Expression::new_identifier(SPAN, ast.allocator().alloc_str(key_var), ast);
    let key_val = Some(JSXAttributeValue::ExpressionContainer(
        JSXExpressionContainer::boxed(SPAN, JSXExpression::from(key_expr), ast),
    ));

    let key_attr = JSXAttributeItem::Attribute(JSXAttribute::boxed(SPAN, key_name, key_val, ast));
    el.opening_element.attributes.push(key_attr);
}

pub fn inject_static_string_key_into_jsx<'a>(
    expr: &mut Expression<'a>,
    key_str: &str,
    ast: &AstBuilder<'a>,
) {
    match expr {
        Expression::JSXElement(el) => {
            inject_static_string_key_into_jsx_elem(el, key_str, ast);
        }
        Expression::JSXFragment(frag) => {
            for child in &mut frag.children {
                if let JSXChild::Element(el) = child {
                    inject_static_string_key_into_jsx_elem(el, key_str, ast);
                }
            }
        }
        _ => {}
    }
}

pub fn inject_static_string_key_into_jsx_elem<'a>(
    el: &mut JSXElement<'a>,
    key_str: &str,
    ast: &AstBuilder<'a>,
) {
    for attr in &el.opening_element.attributes {
        if let JSXAttributeItem::Attribute(a) = attr {
            if let JSXAttributeName::Identifier(id) = &a.name {
                if id.name == "key" {
                    return;
                }
            }
        }
    }

    let key_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
        SPAN,
        ast.allocator().alloc_str("key"),
        ast,
    ));
    let key_val = Some(JSXAttributeValue::StringLiteral(StringLiteral::boxed(
        SPAN,
        ast.allocator().alloc_str(key_str),
        None,
        ast,
    )));
    let key_attr = JSXAttributeItem::Attribute(JSXAttribute::boxed(SPAN, key_name, key_val, ast));
    el.opening_element.attributes.push(key_attr);
}

pub fn inject_expression_key_into_jsx<'a>(
    expr: &mut Expression<'a>,
    key_expr: Expression<'a>,
    ast: &AstBuilder<'a>,
) {
    match expr {
        Expression::JSXElement(el) => {
            inject_expression_key_into_jsx_elem(el, key_expr, ast);
        }
        Expression::JSXFragment(frag) => {
            for child in &mut frag.children {
                if let JSXChild::Element(el) = child {
                    inject_expression_key_into_jsx_elem(
                        el,
                        key_expr.clone_in(ast.allocator()),
                        ast,
                    );
                }
            }
        }
        _ => {}
    }
}

pub fn inject_expression_key_into_jsx_elem<'a>(
    el: &mut JSXElement<'a>,
    key_expr: Expression<'a>,
    ast: &AstBuilder<'a>,
) {
    for attr in &el.opening_element.attributes {
        if let JSXAttributeItem::Attribute(a) = attr {
            if let JSXAttributeName::Identifier(id) = &a.name {
                if id.name == "key" {
                    return;
                }
            }
        }
    }

    let key_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
        SPAN,
        ast.allocator().alloc_str("key"),
        ast,
    ));
    let key_val = Some(JSXAttributeValue::ExpressionContainer(
        JSXExpressionContainer::boxed(SPAN, JSXExpression::from(key_expr), ast),
    ));
    let key_attr = JSXAttributeItem::Attribute(JSXAttribute::boxed(SPAN, key_name, key_val, ast));
    el.opening_element.attributes.push(key_attr);
}

/// Recursively rewrites `this` and `this.*` accesses to `host` and `host.*`.
pub fn rewrite_this_to_host<'a>(expr: &mut Expression<'a>, ast: &AstBuilder<'a>) {
    if let Expression::ThisExpression(_) = expr {
        *expr = Expression::new_identifier(SPAN, "host", ast);
        return;
    }

    match expr {
        Expression::StaticMemberExpression(m) => {
            rewrite_this_to_host(&mut m.object, ast);
        }
        Expression::ComputedMemberExpression(m) => {
            rewrite_this_to_host(&mut m.object, ast);
            rewrite_this_to_host(&mut m.expression, ast);
        }
        Expression::ChainExpression(chain) => {
            rewrite_chain_element_this_to_host(&mut chain.expression, ast);
        }
        Expression::CallExpression(c) => {
            rewrite_this_to_host(&mut c.callee, ast);
            for arg in &mut c.arguments {
                if let Some(e) = arg.as_expression_mut() {
                    rewrite_this_to_host(e, ast);
                }
            }
        }
        Expression::NewExpression(n) => {
            rewrite_this_to_host(&mut n.callee, ast);
            for arg in &mut n.arguments {
                if let Some(e) = arg.as_expression_mut() {
                    rewrite_this_to_host(e, ast);
                }
            }
        }
        Expression::ConditionalExpression(c) => {
            rewrite_this_to_host(&mut c.test, ast);
            rewrite_this_to_host(&mut c.consequent, ast);
            rewrite_this_to_host(&mut c.alternate, ast);
        }
        Expression::BinaryExpression(b) => {
            rewrite_this_to_host(&mut b.left, ast);
            rewrite_this_to_host(&mut b.right, ast);
        }
        Expression::UnaryExpression(u) => {
            rewrite_this_to_host(&mut u.argument, ast);
        }
        Expression::LogicalExpression(l) => {
            rewrite_this_to_host(&mut l.left, ast);
            rewrite_this_to_host(&mut l.right, ast);
        }
        Expression::AssignmentExpression(a) => {
            rewrite_this_to_host(&mut a.right, ast);
        }
        Expression::ParenthesizedExpression(p) => {
            rewrite_this_to_host(&mut p.expression, ast);
        }
        Expression::ArrayExpression(a) => {
            for el in &mut a.elements {
                if let Some(e) = el.as_expression_mut() {
                    rewrite_this_to_host(e, ast);
                }
            }
        }
        Expression::ObjectExpression(o) => {
            for prop in &mut o.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                    rewrite_this_to_host(&mut p.value, ast);
                }
            }
        }
        Expression::ArrowFunctionExpression(arrow) => match &mut arrow.body {
            ArrowFunctionBody::FunctionBody(b) => {
                for s in &mut b.statements {
                    rewrite_statement_this_to_host(s, ast);
                }
            }
            _ => {
                if let Some(e) = arrow.body.as_expression_mut() {
                    rewrite_this_to_host(e, ast);
                }
            }
        },
        _ => {}
    }
}

pub fn rewrite_chain_element_this_to_host<'a>(chain: &mut ChainElement<'a>, ast: &AstBuilder<'a>) {
    match chain {
        ChainElement::StaticMemberExpression(m) => {
            rewrite_this_to_host(&mut m.object, ast);
        }
        ChainElement::ComputedMemberExpression(m) => {
            rewrite_this_to_host(&mut m.object, ast);
            rewrite_this_to_host(&mut m.expression, ast);
        }
        ChainElement::CallExpression(c) => {
            rewrite_this_to_host(&mut c.callee, ast);
            for arg in &mut c.arguments {
                if let Some(e) = arg.as_expression_mut() {
                    rewrite_this_to_host(e, ast);
                }
            }
        }
        _ => {}
    }
}

pub fn rewrite_statement_this_to_host<'a>(stmt: &mut Statement<'a>, ast: &AstBuilder<'a>) {
    match stmt {
        Statement::ExpressionStatement(e) => {
            rewrite_this_to_host(&mut e.expression, ast);
        }
        Statement::ReturnStatement(r) => {
            if let Some(arg) = &mut r.argument {
                rewrite_this_to_host(arg, ast);
            }
        }
        Statement::VariableDeclaration(v) => {
            for decl in &mut v.declarations {
                if let Some(init) = &mut decl.init {
                    rewrite_this_to_host(init, ast);
                }
            }
        }
        Statement::BlockStatement(b) => {
            for s in &mut b.body {
                rewrite_statement_this_to_host(s, ast);
            }
        }
        Statement::IfStatement(i) => {
            rewrite_this_to_host(&mut i.test, ast);
            rewrite_statement_this_to_host(&mut i.consequent, ast);
            if let Some(alt) = &mut i.alternate {
                rewrite_statement_this_to_host(alt, ast);
            }
        }
        _ => {}
    }
}

fn extract_numeric_constant(expr: &Expression) -> Option<i64> {
    match expr {
        Expression::NumericLiteral(num) => Some(num.value as i64),
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::UnaryNegation => {
            if let Expression::NumericLiteral(num) = &unary.argument {
                Some(-(num.value as i64))
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn lower_range_in_statement<'a>(
    stmt: &mut Statement<'a>,
    ast: &AstBuilder<'a>,
    required_runtime_imports: Option<&RefCell<BTreeSet<String>>>,
) {
    match stmt {
        Statement::VariableDeclaration(decl) => {
            for d in &mut decl.declarations {
                if let Some(init) = &mut d.init {
                    lower_range_in_expression(init, ast, required_runtime_imports);
                }
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            lower_range_in_expression(&mut expr_stmt.expression, ast, required_runtime_imports);
        }
        Statement::ReturnStatement(ret_stmt) => {
            if let Some(arg) = &mut ret_stmt.argument {
                lower_range_in_expression(arg, ast, required_runtime_imports);
            }
        }
        _ => {}
    }
}

pub fn lower_range_in_expression<'a>(
    expr: &mut Expression<'a>,
    ast: &AstBuilder<'a>,
    required_runtime_imports: Option<&RefCell<BTreeSet<String>>>,
) {
    if let Expression::CallExpression(call) = expr {
        let is_range = match &call.callee {
            Expression::Identifier(id) => id.name == "range",
            Expression::StaticMemberExpression(m) => m.property.name == "range",
            _ => false,
        };
        if !is_range || call.arguments.is_empty() {
            return;
        }

        let arg_nums: Vec<Option<i64>> = call
            .arguments
            .iter()
            .map(|a| a.as_expression().and_then(extract_numeric_constant))
            .collect();

        let all_static = arg_nums.iter().all(|n| n.is_some());

        if all_static && !arg_nums.is_empty() && arg_nums.len() <= 3 {
            let (start, end, step) = match arg_nums.len() {
                1 => (0, arg_nums[0].unwrap(), 1),
                2 => (arg_nums[0].unwrap(), arg_nums[1].unwrap(), 1),
                3 => (
                    arg_nums[0].unwrap(),
                    arg_nums[1].unwrap(),
                    arg_nums[2].unwrap(),
                ),
                _ => (0, 0, 1),
            };

            let mut elements = ArenaVec::new_in(ast);
            if step > 0 {
                let mut i = start;
                while i < end {
                    elements.push(ArrayExpressionElement::from(
                        Expression::new_numeric_literal(
                            SPAN,
                            i as f64,
                            None,
                            NumberBase::Decimal,
                            ast,
                        ),
                    ));
                    i += step;
                }
            } else if step < 0 {
                let mut i = start;
                while i > end {
                    elements.push(ArrayExpressionElement::from(
                        Expression::new_numeric_literal(
                            SPAN,
                            i as f64,
                            None,
                            NumberBase::Decimal,
                            ast,
                        ),
                    ));
                    i += step;
                }
            }

            *expr = Expression::new_array_expression(SPAN, elements, ast);
        } else {
            // Dynamic fallback: rewrite callee to _range and record runtime import requirement
            call.callee = Expression::new_identifier(SPAN, "_range", ast);
            if let Some(imports) = required_runtime_imports {
                imports.borrow_mut().insert("_range".to_string());
            }
        }
    }
}

fn get_unsafe_html_arg<'e, 'a>(expr: &'e Expression<'a>) -> Option<&'e Expression<'a>> {
    if let Expression::CallExpression(call) = peel_parentheses(expr) {
        let is_unsafe = match &call.callee {
            Expression::Identifier(id) => id.name == "unsafeHTML" || id.name == "unsafeSVG",
            Expression::StaticMemberExpression(mem) => {
                mem.property.name == "unsafeHTML" || mem.property.name == "unsafeSVG"
            }
            _ => false,
        };
        if is_unsafe {
            return call.arguments.first().and_then(|arg| arg.as_expression());
        }
    }
    None
}

fn is_ref_directive_call<'e, 'a>(expr: &'e Expression<'a>) -> Option<&'e Expression<'a>> {
    if let Expression::CallExpression(call) = peel_parentheses(expr) {
        let is_ref = match &call.callee {
            Expression::Identifier(id) => id.name == "ref",
            Expression::StaticMemberExpression(m) => m.property.name == "ref",
            _ => false,
        };
        if is_ref {
            return call.arguments.first().and_then(|a| a.as_expression());
        }
    }
    None
}

fn is_live_directive_call<'e, 'a>(expr: &'e Expression<'a>) -> Option<&'e Expression<'a>> {
    if let Expression::CallExpression(call) = peel_parentheses(expr) {
        let is_live = match &call.callee {
            Expression::Identifier(id) => id.name == "live",
            Expression::StaticMemberExpression(m) => m.property.name == "live",
            _ => false,
        };
        if is_live {
            return call.arguments.first().and_then(|a| a.as_expression());
        }
    }
    None
}

fn is_class_map_call<'e, 'a>(expr: &'e Expression<'a>) -> Option<&'e Expression<'a>> {
    if let Expression::CallExpression(call) = peel_parentheses(expr) {
        let is_cm = match &call.callee {
            Expression::Identifier(id) => id.name == "classMap",
            Expression::StaticMemberExpression(m) => m.property.name == "classMap",
            _ => false,
        };
        if is_cm {
            return call.arguments.first().and_then(|a| a.as_expression());
        }
    }
    None
}

fn is_style_map_call<'e, 'a>(expr: &'e Expression<'a>) -> Option<&'e Expression<'a>> {
    if let Expression::CallExpression(call) = peel_parentheses(expr) {
        let is_sm = match &call.callee {
            Expression::Identifier(id) => id.name == "styleMap",
            Expression::StaticMemberExpression(m) => m.property.name == "styleMap",
            _ => false,
        };
        if is_sm {
            return call.arguments.first().and_then(|a| a.as_expression());
        }
    }
    None
}

fn is_if_defined_call<'e, 'a>(expr: &'e Expression<'a>) -> Option<&'e Expression<'a>> {
    if let Expression::CallExpression(call) = peel_parentheses(expr) {
        let is_id = match &call.callee {
            Expression::Identifier(id) => id.name == "ifDefined",
            Expression::StaticMemberExpression(m) => m.property.name == "ifDefined",
            _ => false,
        };
        if is_id {
            return call.arguments.first().and_then(|a| a.as_expression());
        }
    }
    None
}

fn is_when_call<'e, 'a>(
    expr: &'e Expression<'a>,
) -> Option<(
    &'e Expression<'a>,
    &'e Expression<'a>,
    Option<&'e Expression<'a>>,
)> {
    if let Expression::CallExpression(call) = peel_parentheses(expr) {
        let is_when = match &call.callee {
            Expression::Identifier(id) => id.name == "when",
            Expression::StaticMemberExpression(m) => m.property.name == "when",
            _ => false,
        };
        if is_when && call.arguments.len() >= 2 {
            let cond = call.arguments[0].as_expression()?;
            let true_case = call.arguments[1].as_expression()?;
            let false_case = call.arguments.get(2).and_then(|a| a.as_expression());
            return Some((cond, true_case, false_case));
        }
    }
    None
}

#[allow(clippy::type_complexity)]
fn is_choose_call<'e, 'a>(
    expr: &'e Expression<'a>,
) -> Option<(
    &'e Expression<'a>,
    Vec<(&'e Expression<'a>, &'e Expression<'a>)>,
    Option<&'e Expression<'a>>,
)> {
    if let Expression::CallExpression(call) = peel_parentheses(expr) {
        let is_choose = match &call.callee {
            Expression::Identifier(id) => id.name == "choose",
            Expression::StaticMemberExpression(m) => m.property.name == "choose",
            _ => false,
        };
        if is_choose && call.arguments.len() >= 2 {
            let val = call.arguments[0].as_expression()?;
            let cases_expr = call.arguments[1].as_expression()?;
            let default_case = call.arguments.get(2).and_then(|a| a.as_expression());

            if let Expression::ArrayExpression(arr) = cases_expr {
                let mut cases = Vec::new();
                for elem in &arr.elements {
                    if let ArrayExpressionElement::ArrayExpression(pair) = elem {
                        if pair.elements.len() >= 2 {
                            if let (Some(c_val), Some(c_fn)) = (
                                pair.elements.first().and_then(|e| e.as_expression()),
                                pair.elements.get(1).and_then(|e| e.as_expression()),
                            ) {
                                cases.push((c_val, c_fn));
                            }
                        }
                    }
                }
                return Some((val, cases, default_case));
            }
        }
    }
    None
}

fn is_map_directive_call<'e, 'a>(
    expr: &'e Expression<'a>,
) -> Option<(&'e Expression<'a>, &'e Expression<'a>)> {
    if let Expression::CallExpression(call) = peel_parentheses(expr) {
        let is_map = match &call.callee {
            Expression::Identifier(id) => id.name == "map",
            _ => false,
        };
        if is_map && call.arguments.len() >= 2 {
            let items = call.arguments[0].as_expression()?;
            let fn_arg = call.arguments[1].as_expression()?;
            return Some((items, fn_arg));
        }
    }
    None
}

fn is_repeat_directive_call<'e, 'a>(
    expr: &'e Expression<'a>,
) -> Option<(
    &'e Expression<'a>,
    Option<&'e Expression<'a>>,
    &'e Expression<'a>,
)> {
    if let Expression::CallExpression(call) = peel_parentheses(expr) {
        let is_repeat = match &call.callee {
            Expression::Identifier(id) => id.name == "repeat",
            Expression::StaticMemberExpression(m) => m.property.name == "repeat",
            _ => false,
        };
        if is_repeat {
            if call.arguments.len() == 3 {
                let items = call.arguments[0].as_expression()?;
                let key_fn = call.arguments[1].as_expression();
                let tmpl_fn = call.arguments[2].as_expression()?;
                return Some((items, key_fn, tmpl_fn));
            } else if call.arguments.len() == 2 {
                let items = call.arguments[0].as_expression()?;
                let tmpl_fn = call.arguments[1].as_expression()?;
                return Some((items, None, tmpl_fn));
            }
        }
    }
    None
}

fn is_join_directive_call<'e, 'a>(
    expr: &'e Expression<'a>,
) -> Option<(&'e Expression<'a>, &'e Expression<'a>)> {
    if let Expression::CallExpression(call) = peel_parentheses(expr) {
        let is_join = match &call.callee {
            Expression::Identifier(id) => id.name == "join",
            _ => false,
        };
        if is_join && call.arguments.len() >= 2 {
            let items = call.arguments[0].as_expression()?;
            let sep = call.arguments[1].as_expression()?;
            return Some((items, sep));
        }
    }
    None
}

fn is_keyed_directive_call<'e, 'a>(
    expr: &'e Expression<'a>,
) -> Option<(&'e Expression<'a>, &'e Expression<'a>)> {
    if let Expression::CallExpression(call) = peel_parentheses(expr) {
        let is_keyed = match &call.callee {
            Expression::Identifier(id) => id.name == "keyed",
            Expression::StaticMemberExpression(m) => m.property.name == "keyed",
            _ => false,
        };
        if is_keyed && call.arguments.len() >= 2 {
            let key = call.arguments[0].as_expression()?;
            let tmpl = call.arguments[1].as_expression()?;
            return Some((key, tmpl));
        }
    }
    None
}

fn is_guard_directive_call<'e, 'a>(
    expr: &'e Expression<'a>,
) -> Option<(&'e Expression<'a>, &'e Expression<'a>)> {
    if let Expression::CallExpression(call) = peel_parentheses(expr) {
        let is_guard = match &call.callee {
            Expression::Identifier(id) => id.name == "guard",
            Expression::StaticMemberExpression(m) => m.property.name == "guard",
            _ => false,
        };
        if is_guard && call.arguments.len() >= 2 {
            let deps = call.arguments[0].as_expression()?;
            let tmpl_fn = call.arguments[1].as_expression()?;
            return Some((deps, tmpl_fn));
        }
    }
    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TemplateLoweringScope {
    HostClassMethod,
    ComponentFunction,
}

pub fn is_lit_html_or_svg_tag(
    tag: &Expression,
    symbol_ctx: Option<&lit_analysis::SymbolProofContext>,
) -> bool {
    if let Some(ctx) = symbol_ctx {
        ctx.is_lit_html_tag(tag) || ctx.is_lit_svg_tag(tag)
    } else {
        match tag {
            Expression::Identifier(id) => id.name == "html" || id.name == "svg",
            Expression::StaticMemberExpression(mem) => {
                mem.property.name == "html" || mem.property.name == "svg"
            }
            _ => false,
        }
    }
}

pub fn lower_expression_lit_templates<'a>(
    expr: &mut Expression<'a>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    emitter: &mut JsxEmitter<'a, '_>,
    scope: TemplateLoweringScope,
) {
    match expr {
        Expression::TaggedTemplateExpression(tagged) => {
            if is_lit_html_or_svg_tag(&tagged.tag, emitter.symbol_ctx) {
                for e in &mut tagged.quasi.expressions {
                    lower_expression_lit_templates(e, ast, allocator, emitter, scope);
                }

                let quasis: Vec<&str> = tagged
                    .quasi
                    .quasis
                    .iter()
                    .map(|q| q.value.raw.as_str())
                    .collect();
                let expr_count = tagged.quasi.expressions.len();
                if let Ok(inner_ir) =
                    lit_analysis::TemplateParser::parse_lit_template(&quasis, expr_count)
                {
                    let mut sub_options = emitter.options.clone();
                    match scope {
                        TemplateLoweringScope::HostClassMethod => {
                            sub_options.this_rewriting = ThisRewritingTarget::Preserve;
                            sub_options.is_host_method = true;
                        }
                        TemplateLoweringScope::ComponentFunction => {
                            sub_options.this_rewriting = if emitter.options.is_tier0 {
                                ThisRewritingTarget::Props
                            } else {
                                ThisRewritingTarget::Host
                            };
                            sub_options.is_host_method = false;
                        }
                    }

                    let mut sub_emitter = JsxEmitter::new(
                        ast,
                        allocator,
                        &tagged.quasi.expressions,
                        sub_options,
                        None,
                    );
                    sub_emitter.symbol_ctx = emitter.symbol_ctx;
                    *sub_emitter.seen_slots.borrow_mut() = emitter.seen_slots.borrow().clone();

                    let mut lowered_jsx = sub_emitter.lower_template(&inner_ir);

                    for helper in sub_emitter.required_runtime_imports.borrow().iter() {
                        emitter
                            .required_runtime_imports
                            .borrow_mut()
                            .insert(helper.clone());
                    }
                    for (k, v) in sub_emitter.required_component_imports.borrow().iter() {
                        emitter
                            .required_component_imports
                            .borrow_mut()
                            .insert(k.clone(), v.clone());
                    }
                    *emitter.seen_slots.borrow_mut() = sub_emitter.seen_slots.borrow().clone();

                    if let Expression::JSXFragment(frag) = &mut lowered_jsx {
                        let elem_count = frag
                            .children
                            .iter()
                            .filter(|c| matches!(c, JSXChild::Element(_)))
                            .count();
                        let non_ws_count = frag
                            .children
                            .iter()
                            .filter(|c| match c {
                                JSXChild::Text(t) => !t.value.trim().is_empty(),
                                _ => true,
                            })
                            .count();
                        if elem_count == 1 && non_ws_count == 1 {
                            if let Some(pos) = frag
                                .children
                                .iter()
                                .position(|c| matches!(c, JSXChild::Element(_)))
                            {
                                if let JSXChild::Element(el) = frag.children.remove(pos) {
                                    lowered_jsx = Expression::JSXElement(el);
                                }
                            }
                        }
                    }

                    *expr = lowered_jsx;
                }
            } else {
                for e in &mut tagged.quasi.expressions {
                    lower_expression_lit_templates(e, ast, allocator, emitter, scope);
                }
            }
        }
        Expression::ArrowFunctionExpression(arrow) => match &mut arrow.body {
            ArrowFunctionBody::FunctionBody(body) => {
                for s in &mut body.statements {
                    lower_statement_lit_templates(s, ast, allocator, emitter, scope);
                }
            }
            _ => {
                if let Some(body_expr) = arrow.body.as_expression_mut() {
                    lower_expression_lit_templates(body_expr, ast, allocator, emitter, scope);
                }
            }
        },
        Expression::FunctionExpression(func) => {
            if let Some(body) = &mut func.body {
                for s in &mut body.statements {
                    lower_statement_lit_templates(s, ast, allocator, emitter, scope);
                }
            }
        }
        Expression::ConditionalExpression(cond) => {
            lower_expression_lit_templates(&mut cond.test, ast, allocator, emitter, scope);
            lower_expression_lit_templates(&mut cond.consequent, ast, allocator, emitter, scope);
            lower_expression_lit_templates(&mut cond.alternate, ast, allocator, emitter, scope);
        }
        Expression::ParenthesizedExpression(paren) => {
            lower_expression_lit_templates(&mut paren.expression, ast, allocator, emitter, scope);
        }
        Expression::LogicalExpression(logical) => {
            lower_expression_lit_templates(&mut logical.left, ast, allocator, emitter, scope);
            lower_expression_lit_templates(&mut logical.right, ast, allocator, emitter, scope);
        }
        Expression::BinaryExpression(binary) => {
            lower_expression_lit_templates(&mut binary.left, ast, allocator, emitter, scope);
            lower_expression_lit_templates(&mut binary.right, ast, allocator, emitter, scope);
        }
        Expression::UnaryExpression(unary) => {
            lower_expression_lit_templates(&mut unary.argument, ast, allocator, emitter, scope);
        }
        Expression::CallExpression(call) => {
            lower_expression_lit_templates(&mut call.callee, ast, allocator, emitter, scope);
            for arg in &mut call.arguments {
                if let Some(e) = arg.as_expression_mut() {
                    lower_expression_lit_templates(e, ast, allocator, emitter, scope);
                }
            }
        }
        Expression::ArrayExpression(arr) => {
            for el in &mut arr.elements {
                if let Some(e) = el.as_expression_mut() {
                    lower_expression_lit_templates(e, ast, allocator, emitter, scope);
                }
            }
        }
        Expression::ObjectExpression(obj) => {
            for prop in &mut obj.properties {
                match prop {
                    ObjectPropertyKind::ObjectProperty(p) => {
                        lower_expression_lit_templates(
                            &mut p.value,
                            ast,
                            allocator,
                            emitter,
                            scope,
                        );
                    }
                    ObjectPropertyKind::SpreadProperty(s) => {
                        lower_expression_lit_templates(
                            &mut s.argument,
                            ast,
                            allocator,
                            emitter,
                            scope,
                        );
                    }
                }
            }
        }
        Expression::StaticMemberExpression(m) => {
            lower_expression_lit_templates(&mut m.object, ast, allocator, emitter, scope);
        }
        Expression::ComputedMemberExpression(m) => {
            lower_expression_lit_templates(&mut m.object, ast, allocator, emitter, scope);
            lower_expression_lit_templates(&mut m.expression, ast, allocator, emitter, scope);
        }
        Expression::SequenceExpression(seq) => {
            for e in &mut seq.expressions {
                lower_expression_lit_templates(e, ast, allocator, emitter, scope);
            }
        }
        Expression::AssignmentExpression(assign) => {
            lower_expression_lit_templates(&mut assign.right, ast, allocator, emitter, scope);
        }
        Expression::TemplateLiteral(t) => {
            for e in &mut t.expressions {
                lower_expression_lit_templates(e, ast, allocator, emitter, scope);
            }
        }
        _ => {}
    }
}

pub fn lower_statement_lit_templates<'a>(
    stmt: &mut Statement<'a>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    emitter: &mut JsxEmitter<'a, '_>,
    scope: TemplateLoweringScope,
) {
    match stmt {
        Statement::ReturnStatement(ret) => {
            if let Some(arg) = &mut ret.argument {
                lower_expression_lit_templates(arg, ast, allocator, emitter, scope);
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            lower_expression_lit_templates(
                &mut expr_stmt.expression,
                ast,
                allocator,
                emitter,
                scope,
            );
        }
        Statement::VariableDeclaration(decl) => {
            for d in &mut decl.declarations {
                if let Some(init) = &mut d.init {
                    lower_expression_lit_templates(init, ast, allocator, emitter, scope);
                }
            }
        }
        Statement::BlockStatement(block) => {
            for s in &mut block.body {
                lower_statement_lit_templates(s, ast, allocator, emitter, scope);
            }
        }
        Statement::IfStatement(if_stmt) => {
            lower_expression_lit_templates(&mut if_stmt.test, ast, allocator, emitter, scope);
            lower_statement_lit_templates(&mut if_stmt.consequent, ast, allocator, emitter, scope);
            if let Some(alt) = &mut if_stmt.alternate {
                lower_statement_lit_templates(alt, ast, allocator, emitter, scope);
            }
        }
        Statement::SwitchStatement(switch_stmt) => {
            lower_expression_lit_templates(
                &mut switch_stmt.discriminant,
                ast,
                allocator,
                emitter,
                scope,
            );
            for case in &mut switch_stmt.cases {
                if let Some(test) = &mut case.test {
                    lower_expression_lit_templates(test, ast, allocator, emitter, scope);
                }
                for s in &mut case.consequent {
                    lower_statement_lit_templates(s, ast, allocator, emitter, scope);
                }
            }
        }
        Statement::ForStatement(for_stmt) => {
            if let Some(ForStatementInit::VariableDeclaration(v)) = &mut for_stmt.init {
                for d in &mut v.declarations {
                    if let Some(i) = &mut d.init {
                        lower_expression_lit_templates(i, ast, allocator, emitter, scope);
                    }
                }
            }
            if let Some(test) = &mut for_stmt.test {
                lower_expression_lit_templates(test, ast, allocator, emitter, scope);
            }
            if let Some(update) = &mut for_stmt.update {
                lower_expression_lit_templates(update, ast, allocator, emitter, scope);
            }
            lower_statement_lit_templates(&mut for_stmt.body, ast, allocator, emitter, scope);
        }
        Statement::ForInStatement(for_in) => {
            lower_expression_lit_templates(&mut for_in.right, ast, allocator, emitter, scope);
            lower_statement_lit_templates(&mut for_in.body, ast, allocator, emitter, scope);
        }
        Statement::ForOfStatement(for_of) => {
            lower_expression_lit_templates(&mut for_of.right, ast, allocator, emitter, scope);
            lower_statement_lit_templates(&mut for_of.body, ast, allocator, emitter, scope);
        }
        Statement::WhileStatement(while_stmt) => {
            lower_expression_lit_templates(&mut while_stmt.test, ast, allocator, emitter, scope);
            lower_statement_lit_templates(&mut while_stmt.body, ast, allocator, emitter, scope);
        }
        Statement::DoWhileStatement(do_while) => {
            lower_statement_lit_templates(&mut do_while.body, ast, allocator, emitter, scope);
            lower_expression_lit_templates(&mut do_while.test, ast, allocator, emitter, scope);
        }
        Statement::TryStatement(try_stmt) => {
            for s in &mut try_stmt.block.body {
                lower_statement_lit_templates(s, ast, allocator, emitter, scope);
            }
            if let Some(handler) = &mut try_stmt.handler {
                for s in &mut handler.body.body {
                    lower_statement_lit_templates(s, ast, allocator, emitter, scope);
                }
            }
            if let Some(finalizer) = &mut try_stmt.finalizer {
                for s in &mut finalizer.body {
                    lower_statement_lit_templates(s, ast, allocator, emitter, scope);
                }
            }
        }
        Statement::ThrowStatement(throw_stmt) => {
            lower_expression_lit_templates(
                &mut throw_stmt.argument,
                ast,
                allocator,
                emitter,
                scope,
            );
        }
        _ => {}
    }
}

/// Emits a Tier 0 pure functional component module:
/// ```tsx
/// export function ComponentName(props: any) {
///   return (
///     <jsx_tree>
///   );
/// }
/// ```
#[allow(clippy::too_many_arguments)]
pub fn emit_tier0_component<'a>(
    allocator: &'a Allocator,
    component: &LitComponentInfo,
    scoped_css: Option<&str>,
    stylesheet_id: Option<&str>,
    emit_css_file: bool,
    expressions: &[Expression<'a>],
    preceding_statements: &[Statement<'a>],
    tag_registry: Option<ComponentTagRegistry>,
    symbol_ctx: Option<&lit_analysis::SymbolProofContext<'a>>,
) -> Result<Program<'a>, String> {
    let ast = AstBuilder::new(allocator);

    let style_element = if !emit_css_file {
        if let (Some(css), Some(id)) = (scoped_css, stylesheet_id) {
            if !css.is_empty() {
                Some(build_jsx_style_element(id, css, "default", &ast))
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let static_ids = if let Some(tmpl) = &component.template {
        collect_static_ids(tmpl)
    } else {
        std::collections::HashSet::new()
    };
    let has_static_ids = !static_ids.is_empty();

    let has_slots = component
        .template
        .as_ref()
        .map(|t| t.has_slots)
        .unwrap_or(false)
        || !component.slots.is_empty();
    let has_named_slots = component.slots.iter().any(|s| s.name.is_some());
    let has_slot_fallbacks = component.slots.iter().any(|s| s.has_fallback);
    let has_inspected_slots = component.slots.iter().any(|s| s.inspected);
    let needs_slot_partitioning =
        has_slots && (has_named_slots || has_slot_fallbacks || has_inspected_slots);

    let emitter_options = JsxEmitOptions {
        is_tier0: true,
        preserve_whitespace: true,
        custom_element_suffix: None,
        static_ids,
        queries: Vec::new(),
        constant_strings: collect_constant_strings(preceding_statements),
        tag_registry,
        has_slot_partitioning: needs_slot_partitioning,
        declared_properties: component
            .properties
            .iter()
            .map(|p| p.name.clone())
            .collect(),
        this_rewriting: ThisRewritingTarget::Props,
        is_host_method: false,
    };

    let mut emitter = JsxEmitter::new(&ast, allocator, expressions, emitter_options, style_element);
    emitter.symbol_ctx = symbol_ctx;

    let template_ir = component
        .template
        .as_ref()
        .ok_or_else(|| "Component has no template IR in render()".to_string())?;

    let jsx_root = emitter.lower_template(template_ir);

    // Build return statement
    let ret_stmt = Statement::ReturnStatement(ReturnStatement::boxed(SPAN, Some(jsx_root), &ast));
    let needs_slot_partitioning =
        needs_slot_partitioning || !emitter.seen_slots.borrow().is_empty();
    let mut body_stmts = ArenaVec::new_in(&ast);

    if needs_slot_partitioning {
        emitter
            .required_runtime_imports
            .borrow_mut()
            .insert("partitionSlots".to_string());
        let callee = Expression::new_identifier(SPAN, allocator.alloc_str("partitionSlots"), &ast);
        let mut args = ArenaVec::new_in(&ast);
        let props_ident = Expression::new_identifier(SPAN, allocator.alloc_str("props"), &ast);
        let children_prop = Expression::new_static_member_expression(
            SPAN,
            props_ident,
            IdentifierName::new(SPAN, allocator.alloc_str("children"), &ast),
            false,
            &ast,
        );
        args.push(Argument::from(children_prop));
        let call_expr = Expression::new_call_expression(SPAN, callee, None, args, false, &ast);
        let pat = BindingPattern::new_binding_identifier(SPAN, allocator.alloc_str("_slots"), &ast);
        let mut decls = ArenaVec::new_in(&ast);
        decls.push(VariableDeclarator::new(
            SPAN,
            pat,
            None,
            Some(call_expr),
            false,
            &ast,
        ));
        let slots_decl = Statement::VariableDeclaration(VariableDeclaration::boxed(
            SPAN,
            VariableDeclarationKind::Const,
            decls,
            false,
            &ast,
        ));
        body_stmts.push(slots_decl);
    }

    if has_static_ids {
        let use_id_call = {
            let callee = Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "React", &ast),
                IdentifierName::new(SPAN, "useId", &ast),
                false,
                &ast,
            );
            Expression::new_call_expression(SPAN, callee, None, ArenaVec::new_in(&ast), false, &ast)
        };
        let id_decl = {
            let pat = BindingPattern::new_binding_identifier(SPAN, "_id", &ast);
            let mut declarators = ArenaVec::new_in(&ast);
            declarators.push(VariableDeclarator::new(
                SPAN,
                pat,
                None,
                Some(use_id_call),
                false,
                &ast,
            ));
            Statement::VariableDeclaration(VariableDeclaration::boxed(
                SPAN,
                VariableDeclarationKind::Const,
                declarators,
                false,
                &ast,
            ))
        };
        body_stmts.push(id_decl);
    }

    for stmt in preceding_statements {
        let mut cloned = stmt.clone_in(allocator);
        lower_statement_lit_templates(
            &mut cloned,
            &ast,
            allocator,
            &mut emitter,
            TemplateLoweringScope::ComponentFunction,
        );
        lower_range_in_statement(&mut cloned, &ast, Some(&emitter.required_runtime_imports));
        rewrite_statement_this_to_props(&mut cloned, &ast);
        body_stmts.push(cloned);
    }
    body_stmts.push(ret_stmt);

    let func_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(&ast), body_stmts, &ast);
    let fn_name = allocator.alloc_str(&component.component_name);
    let fn_id = Some(BindingIdentifier::new(SPAN, fn_name, &ast));

    // Optional props parameter: props: any
    let props_binding = BindingPattern::new_binding_identifier(SPAN, "props", &ast);
    let props_param = FormalParameter::new_plain(SPAN, props_binding, &ast);
    let mut params_vec = ArenaVec::new_in(&ast);
    params_vec.push(props_param);
    let formal_params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        params_vec,
        None,
        &ast,
    );

    let func = Function::boxed(
        SPAN,
        FunctionType::FunctionDeclaration,
        fn_id,
        false,
        false,
        false,
        None,
        None,
        formal_params,
        None,
        Some(func_body),
        &ast,
    );

    let export_decl = Statement::ExportDeclaration(ExportDeclaration::boxed(
        SPAN,
        Declaration::FunctionDeclaration(func),
        &ast,
    ));

    let mut prog_stmts = ArenaVec::new_in(&ast);
    if !emitter.required_runtime_imports.borrow().is_empty() {
        let mut runtime_specs = ArenaVec::new_in(&ast);
        for name in emitter.required_runtime_imports.borrow().iter() {
            let imported =
                ModuleExportName::new_identifier_name(SPAN, allocator.alloc_str(name), &ast);
            let local = BindingIdentifier::new(SPAN, allocator.alloc_str(name), &ast);
            runtime_specs.push(ImportDeclarationSpecifier::new_import_specifier(
                SPAN,
                imported,
                local,
                ImportOrExportKind::Value,
                &ast,
            ));
        }
        let runtime_source = StringLiteral::new(
            SPAN,
            allocator.alloc_str("@lit-core/morph-to-react/runtime"),
            None,
            &ast,
        );
        let runtime_import = Statement::new_import_declaration(
            SPAN,
            Some(runtime_specs),
            runtime_source,
            None,
            None,
            ImportOrExportKind::Value,
            &ast,
        );
        prog_stmts.push(runtime_import);
    }
    for (comp_name, import_path) in emitter.required_component_imports.borrow().iter() {
        let mut specs = ArenaVec::new_in(&ast);
        let imported =
            ModuleExportName::new_identifier_name(SPAN, allocator.alloc_str(comp_name), &ast);
        let local = BindingIdentifier::new(SPAN, allocator.alloc_str(comp_name), &ast);
        specs.push(ImportDeclarationSpecifier::new_import_specifier(
            SPAN,
            imported,
            local,
            ImportOrExportKind::Value,
            &ast,
        ));
        let source = StringLiteral::new(SPAN, allocator.alloc_str(import_path), None, &ast);
        let comp_import = Statement::new_import_declaration(
            SPAN,
            Some(specs),
            source,
            None,
            None,
            ImportOrExportKind::Value,
            &ast,
        );
        prog_stmts.push(comp_import);
    }
    prog_stmts.push(export_decl);

    let program = Program::new(
        SPAN,
        SourceType::jsx(),
        "",
        ArenaVec::new_in(&ast),
        None,
        ArenaVec::new_in(&ast),
        prog_stmts,
        &ast,
    );

    Ok(program)
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_codegen::Codegen;

    #[test]
    fn test_attribute_mappings() {
        assert_eq!(map_html_attribute("class"), Some("className"));
        assert_eq!(map_html_attribute("for"), Some("htmlFor"));
        assert_eq!(map_html_attribute("tabindex"), Some("tabIndex"));
        assert_eq!(map_html_attribute("readonly"), Some("readOnly"));
        assert_eq!(map_html_attribute("aria-label"), None); // preserved
        assert_eq!(map_html_attribute("data-active"), None); // preserved
    }

    #[test]
    fn test_svg_attribute_mappings() {
        assert_eq!(map_svg_attribute("viewbox"), Some("viewBox"));
        assert_eq!(map_svg_attribute("stroke-width"), Some("strokeWidth"));
        assert_eq!(map_svg_attribute("stroke-linecap"), Some("strokeLinecap"));
        assert_eq!(map_svg_attribute("fill-rule"), Some("fillRule"));
    }

    #[test]
    fn test_css_prop_to_camel_case() {
        assert_eq!(css_prop_to_camel_case("color"), "color");
        assert_eq!(css_prop_to_camel_case("margin-top"), "marginTop");
        assert_eq!(css_prop_to_camel_case("font-weight"), "fontWeight");
        assert_eq!(css_prop_to_camel_case("--bg-color"), "--bg-color");
    }

    #[test]
    fn test_lower_tier0_nested_elements_and_attributes() {
        let allocator = Allocator::default();
        let quasis = vec![
            r#"<div class="badge-wrapper" ?data-active="#,
            r#" style="color: red; margin-top: 8px;"><span class="badge">Active</span></div>"#,
        ];
        let ir = lit_analysis::TemplateParser::parse_lit_template(&quasis, 1).unwrap();

        let comp = LitComponentInfo {
            tag_name: Some("leaf-badge".to_string()),
            class_name: "LeafBadge".to_string(),
            component_name: "LeafBadge".to_string(),
            tier: lit_analysis::ClassificationTier::Tier0Pure,
            properties: Vec::new(),
            events: Vec::new(),
            slots: Vec::new(),
            styles: Vec::new(),
            shadow_root_options: None,
            template: Some(ir),
            super_class: None,
            mixins: Vec::new(),
        };

        let ast = AstBuilder::new(&allocator);
        let expr = Expression::new_identifier(SPAN, "isActive", &ast);
        let expressions = vec![expr];

        let program = emit_tier0_component(
            &allocator,
            &comp,
            None,
            None,
            false,
            &expressions,
            &[],
            None,
            None,
        )
        .unwrap();
        let code = Codegen::new().build(&program).code;
        println!("Emitted code:\n{}", code);

        assert!(code.contains("export function LeafBadge("));
        assert!(code.contains(r#"className="badge-wrapper""#));
        assert!(code.contains(r#"className="badge""#));
        assert!(code.contains(r#"color: "red""#));
        assert!(code.contains(r#"marginTop: "8px""#));
        assert!(code.contains(r#"data-active={isActive ? "" : undefined}"#));
    }

    #[test]
    fn test_lower_tier0_svg_attributes() {
        let allocator = Allocator::default();
        let quasis = vec![
            r#"<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" fill-rule="evenodd"><circle cx="12" cy="12" r="10" /></svg>"#,
        ];
        let ir = lit_analysis::TemplateParser::parse_lit_template(&quasis, 0).unwrap();

        let comp = LitComponentInfo {
            tag_name: Some("svg-glyph".to_string()),
            class_name: "SvgGlyph".to_string(),
            component_name: "SvgGlyph".to_string(),
            tier: lit_analysis::ClassificationTier::Tier0Pure,
            properties: Vec::new(),
            events: Vec::new(),
            slots: Vec::new(),
            styles: Vec::new(),
            shadow_root_options: None,
            template: Some(ir),
            super_class: None,
            mixins: Vec::new(),
        };

        let program =
            emit_tier0_component(&allocator, &comp, None, None, false, &[], &[], None, None)
                .unwrap();
        let code = Codegen::new().build(&program).code;
        println!("Emitted SVG code:\n{}", code);

        assert!(code.contains(r#"viewBox="0 0 24 24""#));
        assert!(code.contains(r#"strokeWidth="2""#));
        assert!(code.contains(r#"strokeLinecap="round""#));
        assert!(code.contains(r#"fillRule="evenodd""#));
    }

    #[test]
    fn test_lower_tier0_child_expressions_and_sentinels() {
        let allocator = Allocator::default();
        let quasis = vec!["<div>", "", "", "</div>"];
        let ir = lit_analysis::TemplateParser::parse_lit_template(&quasis, 3).unwrap();

        let comp = LitComponentInfo {
            tag_name: Some("optional-content".to_string()),
            class_name: "OptionalContent".to_string(),
            component_name: "OptionalContent".to_string(),
            tier: lit_analysis::ClassificationTier::Tier0Pure,
            properties: Vec::new(),
            events: Vec::new(),
            slots: Vec::new(),
            styles: Vec::new(),
            shadow_root_options: None,
            template: Some(ir),
            super_class: None,
            mixins: Vec::new(),
        };

        let ast = AstBuilder::new(&allocator);
        let nothing_id = Expression::new_identifier(SPAN, "nothing", &ast);
        let undef_id = Expression::new_identifier(SPAN, "undefined", &ast);
        let null_lit = Expression::new_null_literal(SPAN, &ast);
        let expressions = vec![nothing_id, undef_id, null_lit];

        let program = emit_tier0_component(
            &allocator,
            &comp,
            None,
            None,
            false,
            &expressions,
            &[],
            None,
            None,
        )
        .unwrap();
        let code = Codegen::new().build(&program).code;
        println!("Emitted sentinels code:\n{}", code);

        assert!(code.contains("{null}"));
        assert!(!code.contains("nothing"));
    }

    #[test]
    fn test_lower_tier0_hoisted_style_element() {
        let allocator = Allocator::default();
        let quasis = vec![r#"<p class="text">Styled</p>"#];
        let ir = lit_analysis::TemplateParser::parse_lit_template(&quasis, 0).unwrap();

        let comp = LitComponentInfo {
            tag_name: Some("inlined-style-comp".to_string()),
            class_name: "InlinedStyleComp".to_string(),
            component_name: "InlinedStyleComp".to_string(),
            tier: lit_analysis::ClassificationTier::Tier0Pure,
            properties: Vec::new(),
            events: Vec::new(),
            slots: Vec::new(),
            styles: Vec::new(),
            shadow_root_options: None,
            template: Some(ir),
            super_class: None,
            mixins: Vec::new(),
        };

        let scoped_css = "@scope(inlined-style-comp){.text{color:green}}";
        let stylesheet_id = "style-inlined-style-comp-1234567890ab";

        let program = emit_tier0_component(
            &allocator,
            &comp,
            Some(scoped_css),
            Some(stylesheet_id),
            false,
            &[],
            &[],
            None,
            None,
        )
        .unwrap();
        let code = Codegen::new().build(&program).code;
        println!("Emitted hoisted style code:\n{}", code);

        assert!(code.contains("<style"));
        assert!(code.contains(r#"href="style-inlined-style-comp-1234567890ab""#));
        assert!(code.contains(r#"precedence="default""#));
        assert!(code.contains(scoped_css));
    }

    #[test]
    fn test_standard_html_boolean_attributes() {
        assert!(is_standard_html_boolean_attribute("disabled"));
        assert!(is_standard_html_boolean_attribute("required"));
        assert!(is_standard_html_boolean_attribute("readOnly"));
        assert!(is_standard_html_boolean_attribute("readonly"));
        assert!(is_standard_html_boolean_attribute("hidden"));
        assert!(is_standard_html_boolean_attribute("inert"));
        assert!(is_standard_html_boolean_attribute("open"));
        assert!(!is_standard_html_boolean_attribute("data-active"));
        assert!(!is_standard_html_boolean_attribute("aria-checked"));
        assert!(!is_standard_html_boolean_attribute("custom-flag"));
    }

    #[test]
    fn test_css_prop_to_camel_case_vendor_prefixes() {
        assert_eq!(
            css_prop_to_camel_case("-webkit-overflow-scrolling"),
            "WebkitOverflowScrolling"
        );
        assert_eq!(
            css_prop_to_camel_case("webkit-overflow-scrolling"),
            "WebkitOverflowScrolling"
        );
        assert_eq!(css_prop_to_camel_case("-ms-user-select"), "msUserSelect");
        assert_eq!(css_prop_to_camel_case("ms-user-select"), "msUserSelect");
        assert_eq!(css_prop_to_camel_case("-moz-appearance"), "MozAppearance");
        assert_eq!(css_prop_to_camel_case("-o-transition"), "OTransition");
        assert_eq!(css_prop_to_camel_case("--custom-var"), "--custom-var");
        assert_eq!(css_prop_to_camel_case("margin-top"), "marginTop");
    }

    #[test]
    fn test_lower_tier0_child_expression_this_rewriting() {
        let allocator = Allocator::default();
        let quasis = vec!["<div><span>", "</span></div>"];
        let ir = lit_analysis::TemplateParser::parse_lit_template(&quasis, 1).unwrap();

        let comp = LitComponentInfo {
            tag_name: Some("user-view".to_string()),
            class_name: "UserView".to_string(),
            component_name: "UserView".to_string(),
            tier: lit_analysis::ClassificationTier::Tier0Pure,
            properties: Vec::new(),
            events: Vec::new(),
            slots: Vec::new(),
            styles: Vec::new(),
            shadow_root_options: None,
            template: Some(ir),
            super_class: None,
            mixins: Vec::new(),
        };

        let ast = AstBuilder::new(&allocator);
        let this_expr = Expression::new_this_expression(SPAN, &ast);
        let user_id = IdentifierName::new(SPAN, "user", &ast);
        let user_member =
            Expression::new_static_member_expression(SPAN, this_expr, user_id, false, &ast);
        let name_id = IdentifierName::new(SPAN, "name", &ast);
        let full_member =
            Expression::new_static_member_expression(SPAN, user_member, name_id, false, &ast);

        let expressions = vec![full_member];
        let program = emit_tier0_component(
            &allocator,
            &comp,
            None,
            None,
            false,
            &expressions,
            &[],
            None,
            None,
        )
        .unwrap();
        let code = Codegen::new().build(&program).code;

        assert!(code.contains("props.user.name"));
        assert!(!code.contains("this.user.name"));
    }

    #[test]
    fn test_lower_tier0_standard_boolean_attributes() {
        let allocator = Allocator::default();
        let quasis = vec![
            r#"<button ?disabled="#,
            r#" ?data-active="#,
            r#">Click</button>"#,
        ];
        let ir = lit_analysis::TemplateParser::parse_lit_template(&quasis, 2).unwrap();

        let comp = LitComponentInfo {
            tag_name: Some("bool-btn".to_string()),
            class_name: "BoolBtn".to_string(),
            component_name: "BoolBtn".to_string(),
            tier: lit_analysis::ClassificationTier::Tier0Pure,
            properties: Vec::new(),
            events: Vec::new(),
            slots: Vec::new(),
            styles: Vec::new(),
            shadow_root_options: None,
            template: Some(ir),
            super_class: None,
            mixins: Vec::new(),
        };

        let ast = AstBuilder::new(&allocator);
        let is_disabled = Expression::new_identifier(SPAN, "isDisabled", &ast);
        let is_active = Expression::new_identifier(SPAN, "isActive", &ast);
        let expressions = vec![is_disabled, is_active];

        let program = emit_tier0_component(
            &allocator,
            &comp,
            None,
            None,
            false,
            &expressions,
            &[],
            None,
            None,
        )
        .unwrap();
        let code = Codegen::new().build(&program).code;

        assert!(code.contains("disabled={isDisabled ? true : undefined}"));
        assert!(code.contains(r#"data-active={isActive ? "" : undefined}"#));
    }
}
