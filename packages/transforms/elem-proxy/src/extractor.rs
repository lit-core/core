use lit_analysis::{
    CanonicalLitSymbol, DecoratorExtractor, PropertyModelExtractor, SymbolProofContext,
};
use oxc_ast::ast::*;
use std::collections::{HashMap, HashSet};

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
    ctx: &SymbolProofContext<'a>,
) -> Option<String> {
    if let Expression::CallExpression(call) = &dec.expression
        && (ctx.is_proven_decorator(&call.callee)
            == Some(CanonicalLitSymbol::CustomElementDecorator)
            || ctx.resolve_decorator_call(call) == Some(CanonicalLitSymbol::CustomElementDecorator))
        && let Some(first_arg) = call.arguments.first().and_then(|a| a.as_expression())
    {
        match first_arg.without_parentheses() {
            Expression::StringLiteral(str_lit) => {
                return Some(str_lit.value.as_str().to_string());
            }
            Expression::TemplateLiteral(t) if t.expressions.is_empty() && !t.quasis.is_empty() => {
                return Some(t.quasis[0].value.raw.to_string());
            }
            _ => {}
        }
    }
    None
}

/// Extract observed attributes explicitly returned by static get observedAttributes()
pub fn extract_observed_attributes<'a>(class: &'a Class<'a>, out_attributes: &mut HashSet<String>) {
    for elem in &class.body.body {
        if let ClassElement::MethodDefinition(method) = elem
            && method.r#static
            && method.kind == MethodDefinitionKind::Get
        {
            let name = match &method.key {
                PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
                PropertyKey::StringLiteral(lit) => Some(lit.value.as_str()),
                _ => None,
            };
            if name == Some("observedAttributes")
                && let Some(body) = &method.value.body
            {
                for stmt in &body.statements {
                    if let Statement::ReturnStatement(ret) = stmt
                        && let Some(Expression::ArrayExpression(arr)) = &ret.argument
                    {
                        for elem in &arr.elements {
                            if let Some(Expression::StringLiteral(str_lit)) = elem.as_expression() {
                                out_attributes.insert(str_lit.value.as_str().to_string());
                            }
                        }
                    }
                }
            }
        }
    }
}

pub fn extract_class_properties<'a>(
    program: &'a Program<'a>,
    class: &'a Class<'a>,
    class_name: &str,
    ctx: &SymbolProofContext<'a>,
    out_properties: &mut Vec<String>,
    out_attributes: &mut Vec<String>,
) {
    let member_decorators = DecoratorExtractor::extract_member_decorators(class, ctx);
    let properties = PropertyModelExtractor::extract_all(
        program,
        class,
        class_name,
        &member_decorators,
        Some(ctx.source_text),
    );

    let mut prop_set = HashSet::new();
    let mut attr_set = HashSet::new();

    for p in properties {
        prop_set.insert(p.name);
        if let Some(attr) = p.attribute {
            attr_set.insert(attr);
        }
    }

    extract_observed_attributes(class, &mut attr_set);

    let mut props: Vec<String> = prop_set.into_iter().collect();
    props.sort();
    let mut attrs: Vec<String> = attr_set.into_iter().collect();
    attrs.sort();

    *out_properties = props;
    *out_attributes = attrs;
}

pub fn get_ce_define_call<'a>(
    stmt: &Statement<'a>,
    ctx: &SymbolProofContext<'a>,
) -> Option<(String, String)> {
    if let Statement::ExpressionStatement(expr_stmt) = stmt
        && let Expression::CallExpression(call) = &expr_stmt.expression
        && let Some(reg) = ctx.is_custom_elements_define(call)
        && let (Some(tag), Expression::Identifier(id)) =
            (reg.tag, reg.class_expr.without_parentheses())
    {
        return Some((tag, id.name.as_str().to_string()));
    }
    None
}

pub fn check_and_extract_target<'a>(
    program: &'a Program<'a>,
    class: &'a Class<'a>,
    is_export: bool,
    is_default_export: bool,
    define_calls: &HashMap<String, String>,
    ctx: &SymbolProofContext<'a>,
) -> Option<CustomElementTarget> {
    let class_name = class.id.as_ref().map(|id| id.name.as_str().to_string())?;

    let mut tag_name: Option<String> = None;

    for dec in &class.decorators {
        if let Some(tag) = extract_decorator_tag(dec, ctx) {
            tag_name = Some(tag);
            break;
        }
    }

    if tag_name.is_none()
        && let Some(tag) = define_calls.get(&class_name)
    {
        tag_name = Some(tag.clone());
    }

    let tag = tag_name?;

    let mut properties = Vec::new();
    let mut observed_attributes = Vec::new();
    extract_class_properties(
        program,
        class,
        &class_name,
        ctx,
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
        let ctx = SymbolProofContext::scan(&parsed.program, &scoping, code);

        let define_calls = HashMap::new();
        let mut target = None;
        for stmt in &parsed.program.body {
            if let Statement::ClassDeclaration(class) = stmt {
                target = check_and_extract_target(
                    &parsed.program,
                    class,
                    false,
                    false,
                    &define_calls,
                    &ctx,
                );
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
