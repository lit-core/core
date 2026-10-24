use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;
use oxc_syntax::identifier::is_identifier_name;

pub struct ReactiveProp<'a> {
    pub name: String,
    pub options: Option<Expression<'a>>,
}

/// Safely constructs a PropertyKey: static identifier if name is valid identifier, otherwise string literal.
pub fn create_property_key<'a>(name: &str, ast: &AstBuilder<'a>) -> PropertyKey<'a> {
    if is_identifier_name(name) {
        PropertyKey::new_static_identifier(SPAN, ast.allocator().alloc_str(name), ast)
    } else {
        PropertyKey::new_string_literal(SPAN, ast.allocator().alloc_str(name), None, ast)
    }
}

/// Checks if static properties can be safely merged into this class.
/// Returns true if static properties does not exist or exists as an object expression (property or getter return).
/// Returns false if static properties exists in an unmergeable form (non-object or complex expression).
pub fn can_merge_static_properties(class: &Class<'_>) -> bool {
    for element in &class.body.body {
        match element {
            ClassElement::PropertyDefinition(prop_def) => {
                if prop_def.r#static && prop_def.key.is_specific_static_name("properties") {
                    return matches!(prop_def.value, Some(Expression::ObjectExpression(_)));
                }
            }
            ClassElement::MethodDefinition(method_def)
                if method_def.r#static
                    && method_def.kind == MethodDefinitionKind::Get
                    && method_def.key.is_specific_static_name("properties") =>
            {
                if let Some(ref body) = method_def.value.body
                    && let Some(Statement::ReturnStatement(ret_stmt)) = body.statements.first()
                {
                    return matches!(ret_stmt.argument, Some(Expression::ObjectExpression(_)));
                }
                return false;
            }
            _ => {}
        }
    }
    true
}

/// Checks if a class has reactive property decorators (@property or @state).
pub fn class_has_reactive_properties(
    class: &Class<'_>,
    symbol_ctx: &lit_analysis::symbol::SymbolProofContext<'_>,
) -> bool {
    for element in &class.body.body {
        if let ClassElement::PropertyDefinition(prop_def) = element {
            if !prop_def.r#static {
                for dec in &prop_def.decorators {
                    if matches!(
                        symbol_ctx.resolve_decorator(dec),
                        Some(
                            lit_analysis::symbol::CanonicalLitSymbol::PropertyDecorator
                                | lit_analysis::symbol::CanonicalLitSymbol::StateDecorator
                        )
                    ) {
                        return true;
                    }
                }
            }
        } else if let ClassElement::MethodDefinition(method_def) = element
            && method_def.kind == MethodDefinitionKind::Get
            && !method_def.r#static
        {
            for dec in &method_def.decorators {
                if symbol_ctx.resolve_decorator(dec)
                    == Some(lit_analysis::symbol::CanonicalLitSymbol::PropertyDecorator)
                {
                    return true;
                }
            }
        }
    }
    false
}

/// Injects or merges reactive properties into static properties.
/// Returns true if successfully injected or merged, false if static properties exists in an unmergeable form.
pub fn inject_or_merge_static_properties<'a>(
    class: &mut Class<'a>,
    reactive_props: Vec<ReactiveProp<'a>>,
    ast: &AstBuilder<'a>,
) -> bool {
    if reactive_props.is_empty() {
        return true;
    }

    // 1. Check if static properties already exists
    for element in &mut class.body.body {
        match element {
            ClassElement::PropertyDefinition(prop_def) => {
                if prop_def.r#static && prop_def.key.is_specific_static_name("properties") {
                    if let Some(Expression::ObjectExpression(ref mut obj)) = prop_def.value {
                        append_props_to_object(obj, reactive_props, ast);
                        return true;
                    }
                    // Non-object expression static properties cannot be safely merged
                    return false;
                }
            }
            ClassElement::MethodDefinition(method_def)
                if method_def.r#static
                    && method_def.kind == MethodDefinitionKind::Get
                    && method_def.key.is_specific_static_name("properties") =>
            {
                if let Some(ref mut body) = method_def.value.body
                    && let Some(Statement::ReturnStatement(ret_stmt)) = body.statements.first_mut()
                    && let Some(Expression::ObjectExpression(ref mut obj)) = ret_stmt.argument
                {
                    append_props_to_object(obj, reactive_props, ast);
                    return true;
                }
                // Complex or non-object return getter cannot be safely merged
                return false;
            }
            _ => {}
        }
    }

    // 2. Not found, create new `static properties = { ... };` and insert at index 0
    let mut obj_props = ArenaVec::new_in(ast);
    for prop in reactive_props {
        let key = create_property_key(&prop.name, ast);
        let val = prop
            .options
            .unwrap_or_else(|| Expression::new_object_expression(SPAN, ArenaVec::new_in(ast), ast));

        let obj_prop = ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key,
            val,
            false,
            false,
            false,
            ast,
        );
        obj_props.push(obj_prop);
    }

    let obj_expr = Expression::new_object_expression(SPAN, obj_props, ast);
    let static_prop_key = PropertyKey::new_static_identifier(SPAN, "properties", ast);

    let static_prop_element = ClassElement::new_property_definition(
        SPAN,
        PropertyDefinitionType::PropertyDefinition,
        ArenaVec::new_in(ast),
        static_prop_key,
        None,
        Some(obj_expr),
        false,
        true, // static = true
        false,
        false,
        false,
        false,
        false,
        None,
        ast,
    );

    class.body.body.insert(0, static_prop_element);
    true
}

fn append_props_to_object<'a>(
    obj: &mut ObjectExpression<'a>,
    reactive_props: Vec<ReactiveProp<'a>>,
    ast: &AstBuilder<'a>,
) {
    for prop in reactive_props {
        let key = create_property_key(&prop.name, ast);
        let val = prop
            .options
            .unwrap_or_else(|| Expression::new_object_expression(SPAN, ArenaVec::new_in(ast), ast));

        let obj_prop = ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key,
            val,
            false,
            false,
            false,
            ast,
        );
        obj.properties.push(obj_prop);
    }
}
