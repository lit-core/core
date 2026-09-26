use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::ast_helpers::AstHelper;
use crate::decorators::property::{extract_options, get_lit_decorator_kind, PropertyTransformResult};
use crate::lit_import_scanner::{ImportContext, LitDecoratorKind};
use crate::static_properties::ReactiveProp;

pub fn try_transform_state<'a>(
  element: &mut ClassElement<'a>,
  import_ctx: &ImportContext,
  ast: &AstBuilder<'a>,
) -> Option<PropertyTransformResult<'a>> {
  match element {
    ClassElement::PropertyDefinition(prop_def) => {
      let mut decorator_idx = None;
      let mut options = None;

      for (i, dec) in prop_def.decorators.iter().enumerate() {
        if let Some(kind) = get_lit_decorator_kind(&dec.expression, import_ctx) {
          if kind == LitDecoratorKind::State {
            decorator_idx = Some(i);
            options = extract_options(&dec.expression, ast);
            break;
          }
        }
      }

      let idx = decorator_idx?;
      prop_def.decorators.remove(idx);

      let prop_name = prop_def.key.static_name()?.to_string();

      // Ensure { state: true } is in options
      let state_options = inject_state_true(options, ast);

      let helper = AstHelper::new(ast);
      let constructor_init = prop_def.value.take().map(|val| {
        let name_str = ast.allocator().alloc_str(&prop_name);
        helper.this_prop_assign(name_str, val)
      });

      Some(PropertyTransformResult {
        reactive_prop: ReactiveProp {
          name: prop_name,
          options: Some(state_options),
        },
        constructor_init,
        remove_member: true,
      })
    }
    _ => None,
  }
}

fn inject_state_true<'a>(options: Option<Expression<'a>>, ast: &AstBuilder<'a>) -> Expression<'a> {
  let state_key = PropertyKey::new_static_identifier(SPAN, "state", ast);
  let state_val = Expression::new_boolean_literal(SPAN, true, ast);
  let state_prop = ObjectPropertyKind::new_object_property(
    SPAN,
    PropertyKind::Init,
    state_key,
    state_val,
    false,
    false,
    false,
    ast,
  );

  match options {
    Some(Expression::ObjectExpression(mut obj)) => {
      // Remove any existing `state` property
      obj.properties.retain(|prop| match prop {
        ObjectPropertyKind::ObjectProperty(p) => !p.key.is_specific_static_name("state"),
        _ => true,
      });
      obj.properties.push(state_prop);
      Expression::ObjectExpression(obj)
    }
    _ => {
      let mut props = ArenaVec::new_in(ast);
      props.push(state_prop);
      Expression::new_object_expression(SPAN, props, ast)
    }
  }
}
