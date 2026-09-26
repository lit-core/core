use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::ast_helpers::AstHelper;
use crate::decorators::property::{extract_options, get_lit_decorator_kind};
use crate::lit_import_scanner::{ImportContext, LitDecoratorKind};

pub fn try_transform_event_options<'a>(
  element: &mut ClassElement<'a>,
  class_name: &str,
  import_ctx: &ImportContext,
  ast: &AstBuilder<'a>,
) -> Option<Statement<'a>> {
  let ClassElement::MethodDefinition(method_def) = element else {
    return None;
  };

  let mut decorator_idx = None;
  let mut options = None;

  for (i, dec) in method_def.decorators.iter().enumerate() {
    if let Some(kind) = get_lit_decorator_kind(&dec.expression, import_ctx) {
      if kind == LitDecoratorKind::EventOptions {
        decorator_idx = Some(i);
        options = extract_options(&dec.expression, ast);
        break;
      }
    }
  }

  let idx = decorator_idx?;
  method_def.decorators.remove(idx);

  // If method has accessibility private, do not emit Object.assign (handled via template rewrite or skipped)
  if method_def.accessibility == Some(TSAccessibility::Private) {
    return None;
  }

  let method_name = method_def.key.static_name()?.to_string();
  let opts = options?;

  let helper = AstHelper::new(ast);

  // Object.assign(ClassName.prototype.methodName, options);
  let object_ident = helper.ident_ref("Object");
  let assign_member = helper.static_member(object_ident, "assign", false);

  let class_ident = helper.ident_ref(ast.allocator().alloc_str(class_name));
  let proto_member = helper.static_member(class_ident, "prototype", false);
  let target_method_member = helper.static_member(proto_member, ast.allocator().alloc_str(&method_name), false);

  let mut args = ArenaVec::new_in(ast);
  args.push(Argument::from(target_method_member));
  args.push(Argument::from(opts));

  let call = helper.call_expr(assign_member, args, false);
  Some(Statement::new_expression_statement(SPAN, call, ast))
}
