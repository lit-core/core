use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

pub struct ReactiveProp<'a> {
  pub name: String,
  pub options: Option<Expression<'a>>,
}

pub fn inject_or_merge_static_properties<'a>(
  class: &mut Class<'a>,
  reactive_props: Vec<ReactiveProp<'a>>,
  ast: &AstBuilder<'a>,
) {
  if reactive_props.is_empty() {
    return;
  }

  // 1. Check if static properties already exists
  for element in &mut class.body.body {
    match element {
      ClassElement::PropertyDefinition(prop_def) => {
        if prop_def.r#static && prop_def.key.is_specific_static_name("properties") {
          if let Some(Expression::ObjectExpression(ref mut obj)) = prop_def.value {
            append_props_to_object(obj, reactive_props, ast);
            return;
          }
        }
      }
      ClassElement::MethodDefinition(method_def) => {
        if method_def.r#static
          && method_def.kind == MethodDefinitionKind::Get
          && method_def.key.is_specific_static_name("properties")
        {
          if let Some(ref mut body) = method_def.value.body {
            if let Some(Statement::ReturnStatement(ret_stmt)) = body.statements.first_mut() {
              if let Some(Expression::ObjectExpression(ref mut obj)) = ret_stmt.argument {
                append_props_to_object(obj, reactive_props, ast);
                return;
              }
            }
          }
        }
      }
      _ => {}
    }
  }

  // 2. Not found, create new `static properties = { ... };` and insert at index 0
  let mut obj_props = ArenaVec::new_in(ast);
  for prop in reactive_props {
    let key = PropertyKey::new_static_identifier(SPAN, ast.allocator().alloc_str(&prop.name), ast);
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
}

fn append_props_to_object<'a>(
  obj: &mut ObjectExpression<'a>,
  reactive_props: Vec<ReactiveProp<'a>>,
  ast: &AstBuilder<'a>,
) {
  for prop in reactive_props {
    let key = PropertyKey::new_static_identifier(SPAN, ast.allocator().alloc_str(&prop.name), ast);
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
