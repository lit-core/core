use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

pub const LIFECYCLE_STUBS: &str = r#"class __D {
  connectedCallback() {
    super.connectedCallback?.();
    this.__initLitEventHoist();
  }
  firstUpdated(changedProperties) {
    super.firstUpdated?.(changedProperties);
    this.__initLitEventHoist();
  }
  willUpdate(changedProperties) {
    this.__lhActions = [];
    super.willUpdate?.(changedProperties);
  }
}"#;

pub const STATIC_HELPERS: &str = r#"class __D {
  __lhActions = [];
  __lhInitialized = false;

  __initLitEventHoist() {
    if (this.__lhInitialized) return;
    this.__lhInitialized = true;
    const root = this.shadowRoot || this;
  }

  __lhDispatch(eventName, event) {
    const attr = `data-lh-${eventName}`;
    const root = this.shadowRoot || this;
    let stopped = false;
    const origStop = event.stopPropagation;
    if (origStop) {
      event.stopPropagation = function() {
        stopped = true;
        return origStop.apply(this, arguments);
      };
    }
    const path = event.composedPath ? event.composedPath() : [];
    if (path.length > 0) {
      for (const node of path) {
        if (node === root) break;
        if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute(attr)) {
          if (node.getRootNode && node.getRootNode() !== root) {
            continue;
          }
          const actionId = Number(node.getAttribute(attr));
          const handler = this.__lhActions && this.__lhActions[actionId];
          if (typeof handler === 'function') {
            handler.call(this, event);
          }
          if (event.cancelBubble || stopped) break;
        }
      }
    } else {
      let target = event.target;
      while (target && target !== root && target.nodeType === 1) {
        if (target.hasAttribute(attr)) {
          if (!target.getRootNode || target.getRootNode() === root) {
            const actionId = Number(target.getAttribute(attr));
            const handler = this.__lhActions && this.__lhActions[actionId];
            if (typeof handler === 'function') {
              handler.call(this, event);
            }
            if (event.cancelBubble || stopped) break;
          }
        }
        target = target.parentElement;
      }
    }
  }

  __lhAction(handler) {
    if (!this.__lhActions) this.__lhActions = [];
    const id = this.__lhActions.length;
    this.__lhActions.push(handler);
    return id;
  }
}"#;

pub fn build_reset_lh_actions<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    let this_expr = Expression::new_this_expression(SPAN, ast);
    let target = AssignmentTarget::new_static_member_expression(
        SPAN,
        this_expr,
        IdentifierName::new(SPAN, "__lhActions", ast),
        false,
        ast,
    );
    let empty_arr = Expression::new_array_expression(SPAN, ArenaVec::new_in(ast), ast);
    let assign = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        target,
        empty_arr,
        ast,
    );
    Statement::new_expression_statement(SPAN, assign, ast)
}

pub fn build_call_init_event_hoist<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    let this_expr = Expression::new_this_expression(SPAN, ast);
    let callee = Expression::new_static_member_expression(
        SPAN,
        this_expr,
        IdentifierName::new(SPAN, "__initLitEventHoist", ast),
        false,
        ast,
    );
    let call =
        Expression::new_call_expression(SPAN, callee, None, ArenaVec::new_in(ast), false, ast);
    Statement::new_expression_statement(SPAN, call, ast)
}

pub fn build_add_listener_statement<'a>(evt: &str, ast: &AstBuilder<'a>) -> Statement<'a> {
    let root_ident = Expression::new_identifier(SPAN, "root", ast);
    let add_event_listener = IdentifierName::new(SPAN, "addEventListener", ast);
    let callee =
        Expression::new_static_member_expression(SPAN, root_ident, add_event_listener, false, ast);

    let mut args = ArenaVec::new_in(ast);
    let evt_str = ast.allocator().alloc_str(evt);
    args.push(Argument::from(Expression::new_string_literal(
        SPAN, evt_str, None, ast,
    )));

    let e_binding = BindingPattern::new_binding_identifier(SPAN, "e", ast);
    let param = FormalParameter::new_plain(SPAN, e_binding, ast);
    let mut params_vec = ArenaVec::new_in(ast);
    params_vec.push(param);
    let formal_params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::ArrowFormalParameters,
        params_vec,
        None,
        ast,
    );

    let this_expr = Expression::new_this_expression(SPAN, ast);
    let dispatch_prop = IdentifierName::new(SPAN, "__lhDispatch", ast);
    let dispatch_callee =
        Expression::new_static_member_expression(SPAN, this_expr, dispatch_prop, false, ast);

    let mut dispatch_args = ArenaVec::new_in(ast);
    dispatch_args.push(Argument::from(Expression::new_string_literal(
        SPAN, evt_str, None, ast,
    )));
    dispatch_args.push(Argument::from(Expression::new_identifier(SPAN, "e", ast)));

    let dispatch_call =
        Expression::new_call_expression(SPAN, dispatch_callee, None, dispatch_args, false, ast);
    let arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        formal_params,
        None,
        ArrowFunctionBody::from(dispatch_call),
        ast,
    );
    args.push(Argument::from(arrow));

    let call = Expression::new_call_expression(SPAN, callee, None, args, false, ast);
    Statement::new_expression_statement(SPAN, call, ast)
}
