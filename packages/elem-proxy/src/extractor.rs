use oxc_ast::ast::*;
use oxc_semantic::{Scoping, SymbolId};
use std::collections::{HashMap, HashSet};

pub fn is_canonical_lit_decorator_source(source: &str) -> bool {
    source == "lit"
        || source == "lit/decorators.js"
        || source == "lit/decorators"
        || source.starts_with("lit/decorators/")
        || source == "lit-element"
        || source == "lit-element/decorators.js"
        || source == "lit-element/decorators"
        || source.starts_with("lit-element/decorators/")
        || source == "@lit/reactive-element"
        || source.starts_with("@lit/reactive-element/decorators")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecoratorKind {
    CustomElement,
    Property,
    State,
}

#[derive(Debug, Default)]
pub struct LitDecoratorContext {
    pub has_imports: bool,
    pub decorator_symbols: HashMap<SymbolId, DecoratorKind>,
    pub decorator_namespaces: HashSet<SymbolId>,
    pub local_name_to_kind: HashMap<String, DecoratorKind>,
    pub namespace_names: HashSet<String>,
}

impl LitDecoratorContext {
    pub fn scan<'a>(program: &Program<'a>, scoping: &Scoping) -> Self {
        let mut ctx = Self::default();
        let root = scoping.root_scope_id();

        for stmt in &program.body {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                let source = import_decl.source.value.as_str();
                if is_canonical_lit_decorator_source(source) {
                    ctx.has_imports = true;
                    if let Some(specifiers) = &import_decl.specifiers {
                        for spec in specifiers {
                            match spec {
                                ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                    let imported = named.imported.name();
                                    let kind = match imported.as_str() {
                                        "customElement" => Some(DecoratorKind::CustomElement),
                                        "property" => Some(DecoratorKind::Property),
                                        "state" => Some(DecoratorKind::State),
                                        _ => None,
                                    };
                                    if let Some(k) = kind {
                                        let sym = named.local.symbol_id.get().or_else(|| {
                                            scoping
                                                .get_binding(root, named.local.name.as_str().into())
                                        });
                                        if let Some(s) = sym {
                                            ctx.decorator_symbols.insert(s, k);
                                        }
                                        ctx.local_name_to_kind
                                            .insert(named.local.name.as_str().to_string(), k);
                                    }
                                }
                                ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                    let sym = ns.local.symbol_id.get().or_else(|| {
                                        scoping.get_binding(root, ns.local.name.as_str().into())
                                    });
                                    if let Some(s) = sym {
                                        ctx.decorator_namespaces.insert(s);
                                    }
                                    ctx.namespace_names
                                        .insert(ns.local.name.as_str().to_string());
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }

        ctx
    }

    pub fn resolve_decorator_kind(
        &self,
        expr: &Expression,
        scoping: &Scoping,
    ) -> Option<DecoratorKind> {
        match expr {
            Expression::Identifier(ident) => {
                let sym_id = if let Some(ref_id) = ident.reference_id.get() {
                    scoping.get_reference(ref_id).symbol_id()
                } else {
                    let root = scoping.root_scope_id();
                    scoping.get_binding(root, ident.name.as_str().into())
                };

                if let Some(sym) = sym_id {
                    self.decorator_symbols.get(&sym).copied()
                } else {
                    None
                }
            }
            Expression::StaticMemberExpression(mem) => {
                let prop_kind = match mem.property.name.as_str() {
                    "customElement" => Some(DecoratorKind::CustomElement),
                    "property" => Some(DecoratorKind::Property),
                    "state" => Some(DecoratorKind::State),
                    _ => None,
                }?;

                if let Expression::Identifier(obj) = &mem.object {
                    let obj_sym = if let Some(ref_id) = obj.reference_id.get() {
                        scoping.get_reference(ref_id).symbol_id()
                    } else {
                        let root = scoping.root_scope_id();
                        scoping.get_binding(root, obj.name.as_str().into())
                    };

                    if let Some(sym) = obj_sym {
                        if self.decorator_namespaces.contains(&sym) {
                            return Some(prop_kind);
                        }
                    }
                }
                None
            }
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CustomElementTarget {
    pub tag_name: String,
    pub class_name: String,
    pub is_export: bool,
    pub is_default_export: bool,
    pub properties: Vec<String>,
    pub observed_attributes: Vec<String>,
}

pub fn extract_decorator_tag<'a>(
    dec: &Decorator<'a>,
    ctx: &LitDecoratorContext,
    scoping: &Scoping,
) -> Option<String> {
    if let Expression::CallExpression(call) = &dec.expression {
        if ctx.resolve_decorator_kind(&call.callee, scoping) == Some(DecoratorKind::CustomElement) {
            if let Some(first_arg) = call.arguments.first() {
                if let Some(Expression::StringLiteral(str_lit)) = first_arg.as_expression() {
                    return Some(str_lit.value.as_str().to_string());
                }
            }
        }
    }
    None
}

pub fn extract_class_properties<'a>(
    class: &Class<'a>,
    ctx: &LitDecoratorContext,
    scoping: &Scoping,
    out_properties: &mut Vec<String>,
    out_attributes: &mut Vec<String>,
) {
    let mut prop_set = HashSet::new();
    let mut attr_set = HashSet::new();

    for elem in &class.body.body {
        if let ClassElement::PropertyDefinition(prop) = elem {
            let prop_name = match &prop.key {
                PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str().to_string()),
                PropertyKey::StringLiteral(lit) => Some(lit.value.as_str().to_string()),
                _ => None,
            };

            if let Some(name) = prop_name {
                let mut is_lit_prop = false;
                let mut observes_attr = true;
                let mut custom_attr_name: Option<String> = None;

                for dec in &prop.decorators {
                    if let Expression::CallExpression(call) = &dec.expression {
                        let dec_kind = ctx.resolve_decorator_kind(&call.callee, scoping);

                        if dec_kind == Some(DecoratorKind::Property) {
                            is_lit_prop = true;
                            if let Some(arg) = call.arguments.first() {
                                if let Some(Expression::ObjectExpression(obj)) = arg.as_expression()
                                {
                                    for p in &obj.properties {
                                        if let ObjectPropertyKind::ObjectProperty(prop_kv) = p {
                                            let k_name = match &prop_kv.key {
                                                PropertyKey::StaticIdentifier(id) => {
                                                    Some(id.name.as_str())
                                                }
                                                PropertyKey::StringLiteral(lit) => {
                                                    Some(lit.value.as_str())
                                                }
                                                _ => None,
                                            };

                                            if k_name == Some("attribute") {
                                                match &prop_kv.value {
                                                    Expression::BooleanLiteral(b) => {
                                                        if !b.value {
                                                            observes_attr = false;
                                                        }
                                                    }
                                                    Expression::StringLiteral(s) => {
                                                        custom_attr_name =
                                                            Some(s.value.as_str().to_string());
                                                    }
                                                    _ => {}
                                                }
                                            } else if k_name == Some("state") {
                                                if let Expression::BooleanLiteral(b) =
                                                    &prop_kv.value
                                                {
                                                    if b.value {
                                                        observes_attr = false;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        } else if dec_kind == Some(DecoratorKind::State) {
                            is_lit_prop = true;
                            observes_attr = false;
                        }
                    }
                }

                if is_lit_prop {
                    prop_set.insert(name.clone());
                    if observes_attr {
                        let attr = custom_attr_name.unwrap_or_else(|| name.to_ascii_lowercase());
                        attr_set.insert(attr);
                    }
                }
            }
        }

        // Also check static properties definition: static properties = { ... }
        if let ClassElement::PropertyDefinition(prop) = elem {
            if prop.r#static {
                let key_name = match &prop.key {
                    PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                    PropertyKey::StringLiteral(lit) => Some(lit.value.as_str()),
                    _ => None,
                };
                if key_name == Some("properties") {
                    if let Some(Expression::ObjectExpression(obj)) = &prop.value {
                        inspect_properties_object(obj, &mut prop_set, &mut attr_set);
                    }
                }
            }
        }

        // Also check static get properties() { return { ... }; }
        if let ClassElement::MethodDefinition(method) = elem {
            if method.r#static && method.kind == MethodDefinitionKind::Get {
                let name = match &method.key {
                    PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
                    PropertyKey::StringLiteral(lit) => Some(lit.value.as_str()),
                    _ => None,
                };
                if name == Some("properties") {
                    if let Some(body) = &method.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt {
                                if let Some(Expression::ObjectExpression(obj)) = &ret.argument {
                                    inspect_properties_object(obj, &mut prop_set, &mut attr_set);
                                }
                            }
                        }
                    }
                } else if name == Some("observedAttributes") {
                    if let Some(body) = &method.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt {
                                if let Some(Expression::ArrayExpression(arr)) = &ret.argument {
                                    for elem in &arr.elements {
                                        if let Some(Expression::StringLiteral(str_lit)) =
                                            elem.as_expression()
                                        {
                                            attr_set.insert(str_lit.value.as_str().to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut props: Vec<String> = prop_set.into_iter().collect();
    props.sort();
    let mut attrs: Vec<String> = attr_set.into_iter().collect();
    attrs.sort();

    *out_properties = props;
    *out_attributes = attrs;
}

pub fn inspect_properties_object<'a>(
    obj: &ObjectExpression<'a>,
    prop_set: &mut HashSet<String>,
    attr_set: &mut HashSet<String>,
) {
    for prop in &obj.properties {
        if let ObjectPropertyKind::ObjectProperty(prop_kv) = prop {
            let p_name = match &prop_kv.key {
                PropertyKey::StaticIdentifier(id) => Some(id.name.as_str().to_string()),
                PropertyKey::StringLiteral(lit) => Some(lit.value.as_str().to_string()),
                _ => None,
            };
            if let Some(name) = p_name {
                prop_set.insert(name.clone());
                let mut observes_attr = true;
                let mut custom_attr: Option<String> = None;

                if let Expression::ObjectExpression(inner_obj) = &prop_kv.value {
                    for inner_prop in &inner_obj.properties {
                        if let ObjectPropertyKind::ObjectProperty(inner_kv) = inner_prop {
                            let k = match &inner_kv.key {
                                PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
                                PropertyKey::StringLiteral(lit) => Some(lit.value.as_str()),
                                _ => None,
                            };
                            if k == Some("attribute") {
                                match &inner_kv.value {
                                    Expression::BooleanLiteral(b) => {
                                        if !b.value {
                                            observes_attr = false;
                                        }
                                    }
                                    Expression::StringLiteral(s) => {
                                        custom_attr = Some(s.value.as_str().to_string());
                                    }
                                    _ => {}
                                }
                            } else if k == Some("state") {
                                if let Expression::BooleanLiteral(b) = &inner_kv.value {
                                    if b.value {
                                        observes_attr = false;
                                    }
                                }
                            }
                        }
                    }
                }

                if observes_attr {
                    let attr = custom_attr.unwrap_or_else(|| name.to_ascii_lowercase());
                    attr_set.insert(attr);
                }
            }
        }
    }
}

pub fn get_ce_define_call<'a>(stmt: &Statement<'a>) -> Option<(String, String)> {
    if let Statement::ExpressionStatement(expr_stmt) = stmt {
        if let Expression::CallExpression(call) = &expr_stmt.expression {
            let is_ce_define = match &call.callee {
                Expression::StaticMemberExpression(mem) => {
                    mem.property.name == "define"
                        && match &mem.object {
                            Expression::Identifier(id) => id.name == "customElements",
                            Expression::StaticMemberExpression(inner) => {
                                inner.property.name == "customElements"
                            }
                            _ => false,
                        }
                }
                _ => false,
            };
            if is_ce_define && call.arguments.len() >= 2 {
                let tag_str = match call.arguments[0].as_expression() {
                    Some(Expression::StringLiteral(s)) => Some(s.value.as_str().to_string()),
                    Some(Expression::TemplateLiteral(t))
                        if t.expressions.is_empty() && !t.quasis.is_empty() =>
                    {
                        Some(t.quasis[0].value.raw.as_str().to_string())
                    }
                    _ => None,
                };
                let class_str = match call.arguments[1].as_expression() {
                    Some(Expression::Identifier(id)) => Some(id.name.as_str().to_string()),
                    _ => None,
                };
                if let (Some(tag), Some(cls)) = (tag_str, class_str) {
                    return Some((tag, cls));
                }
            }
        }
    }
    None
}

pub fn check_and_extract_target<'a>(
    class: &Class<'a>,
    is_export: bool,
    is_default_export: bool,
    define_calls: &HashMap<String, String>,
    ctx: &LitDecoratorContext,
    scoping: &Scoping,
) -> Option<CustomElementTarget> {
    let class_name = class.id.as_ref().map(|id| id.name.as_str().to_string())?;

    let mut tag_name: Option<String> = None;

    for dec in &class.decorators {
        if let Some(tag) = extract_decorator_tag(dec, ctx, scoping) {
            tag_name = Some(tag);
            break;
        }
    }

    if tag_name.is_none() {
        if let Some(tag) = define_calls.get(&class_name) {
            tag_name = Some(tag.clone());
        }
    }

    let tag = tag_name?;

    let mut properties = Vec::new();
    let mut observed_attributes = Vec::new();
    extract_class_properties(
        class,
        ctx,
        scoping,
        &mut properties,
        &mut observed_attributes,
    );

    Some(CustomElementTarget {
        tag_name: tag,
        class_name,
        is_export,
        is_default_export,
        properties,
        observed_attributes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_semantic::SemanticBuilder;
    use oxc_span::SourceType;

    #[test]
    fn test_aliased_lit_decorators() {
        let code = r#"
            import { customElement as ce, property as p, state as s } from 'lit/decorators.js';
            @ce('aliased-elem')
            class AliasedElem {
                @p({ type: String, attribute: 'my-attr' })
                title = 'hello';

                @s()
                internal = 42;
            }
        "#;
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, code, SourceType::ts()).parse();
        assert!(parsed.diagnostics.is_empty());
        let semantic_ret = SemanticBuilder::new().build(&parsed.program);
        let scoping = semantic_ret.semantic.into_scoping();
        let ctx = LitDecoratorContext::scan(&parsed.program, &scoping);

        let define_calls = HashMap::new();
        let mut target = None;
        for stmt in &parsed.program.body {
            if let Statement::ClassDeclaration(class) = stmt {
                target =
                    check_and_extract_target(class, false, false, &define_calls, &ctx, &scoping);
            }
        }

        let target = target.expect("target should be found");
        assert_eq!(target.tag_name, "aliased-elem");
        assert_eq!(target.class_name, "AliasedElem");
        assert!(target.properties.contains(&"title".to_string()));
        assert!(target.properties.contains(&"internal".to_string()));
        assert!(target.observed_attributes.contains(&"my-attr".to_string()));
        assert!(!target.observed_attributes.contains(&"internal".to_string()));
    }
}
