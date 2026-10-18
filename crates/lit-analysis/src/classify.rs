use crate::decorator::{ExtractedDecorator, LitDecoratorKind};
use crate::manifest::{EventInfo, ShadowRootOptions, SlotInfo};
use crate::property::PropertyInfo;
use crate::symbol::{CanonicalLitSymbol, SymbolProofContext};
use crate::template_ir::TemplateIR;
use oxc_ast::ast::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum BailoutReason {
    UnsupportedDirective {
        name: String,
        span: (u32, u32),
    },
    UnresolvableThisEscape {
        expression: String,
        span: (u32, u32),
    },
    DynamicTagName {
        span: (u32, u32),
    },
    UnresolvableInheritance {
        base_class: String,
        span: (u32, u32),
    },
    DirectShadowRootAccess {
        operation: String,
        span: (u32, u32),
    },
    ConflictingEventNames {
        event_name: String,
        camel_name: String,
        span: (u32, u32),
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClassificationTier {
    Tier0Pure,
    Tier1Hosted,
    Tier2HostedWithFacade,
    Bailout { reasons: Vec<BailoutReason> },
}

pub struct ComponentClassifier;

impl ComponentClassifier {
    const UNSUPPORTED_DIRECTIVES: &'static [&'static str] =
        &["until", "asyncAppend", "asyncReplace"];

    const LIFECYCLE_METHODS: &'static [&'static str] = &[
        "connectedCallback",
        "disconnectedCallback",
        "willUpdate",
        "update",
        "updated",
        "firstUpdated",
        "shouldUpdate",
    ];

    const FORM_CALLBACKS: &'static [&'static str] = &[
        "formResetCallback",
        "formDisabledCallback",
        "formStateRestoreCallback",
        "formAssociatedCallback",
    ];

    #[allow(clippy::too_many_arguments)]
    pub fn classify<'a>(
        class: &'a Class<'a>,
        properties: &[PropertyInfo],
        events: &[EventInfo],
        slots: &[SlotInfo],
        shadow_root_options: Option<&ShadowRootOptions>,
        _template: Option<&TemplateIR>,
        decorators: &[ExtractedDecorator],
        ctx: &SymbolProofContext<'a>,
    ) -> ClassificationTier {
        // 1. Check for bailout reasons
        let mut bailout_reasons = Vec::new();

        // Check unsupported directives in render method
        for element in &class.body.body {
            if let ClassElement::MethodDefinition(method) = element {
                if method.key.is_specific_static_name("render") {
                    if let Some(body) = &method.value.body {
                        for stmt in &body.statements {
                            Self::check_stmt_for_directives(stmt, ctx, &mut bailout_reasons);
                        }
                    }
                }
            }
        }

        // Check methods for escaping `this` or direct `shadowRoot` mutation
        for element in &class.body.body {
            if let ClassElement::MethodDefinition(method) = element {
                if let Some(body) = &method.value.body {
                    for stmt in &body.statements {
                        Self::check_stmt_for_bailout(stmt, &mut bailout_reasons);
                    }
                }
            }
        }

        if !bailout_reasons.is_empty() {
            return ClassificationTier::Bailout {
                reasons: bailout_reasons,
            };
        }

        // 2. Check for Tier 2: Slot inspection, ElementInternals, delegatesFocus
        if Self::qualifies_tier2(class, slots, shadow_root_options, decorators) {
            return ClassificationTier::Tier2HostedWithFacade;
        }

        // 3. Check for Tier 0: Pure stateless leaf component
        if Self::qualifies_tier0(class, properties, events, slots, ctx) {
            return ClassificationTier::Tier0Pure;
        }

        // 4. Default stateful component: Tier 1 Hosted
        ClassificationTier::Tier1Hosted
    }

    fn check_call_for_directives<'a>(
        call: &'a CallExpression<'a>,
        ctx: &SymbolProofContext<'a>,
        reasons: &mut Vec<BailoutReason>,
    ) {
        if let Some(canonical) = ctx.resolve_directive_call(&call.callee) {
            let name = match canonical {
                CanonicalLitSymbol::DirectiveUntil => "until",
                CanonicalLitSymbol::DirectiveAsyncAppend => "asyncAppend",
                CanonicalLitSymbol::DirectiveAsyncReplace => "asyncReplace",
                _ => "unsupportedDirective",
            };
            reasons.push(BailoutReason::UnsupportedDirective {
                name: name.to_string(),
                span: (call.span.start, call.span.end),
            });
        } else {
            let callee_name = match &call.callee {
                Expression::Identifier(id) => Some(id.name.as_str()),
                Expression::StaticMemberExpression(mem) => Some(mem.property.name.as_str()),
                _ => None,
            };
            if let Some(name) = callee_name {
                if Self::UNSUPPORTED_DIRECTIVES.contains(&name) {
                    reasons.push(BailoutReason::UnsupportedDirective {
                        name: name.to_string(),
                        span: (call.span.start, call.span.end),
                    });
                }
            }
        }
        Self::check_expr_for_directives(&call.callee, ctx, reasons);
        for arg in &call.arguments {
            if let Some(e) = arg.as_expression() {
                Self::check_expr_for_directives(e, ctx, reasons);
            }
        }
    }

    fn check_stmt_for_directives<'a>(
        stmt: &'a Statement<'a>,
        ctx: &SymbolProofContext<'a>,
        reasons: &mut Vec<BailoutReason>,
    ) {
        match stmt {
            Statement::ReturnStatement(ret) => {
                if let Some(arg) = &ret.argument {
                    Self::check_expr_for_directives(arg, ctx, reasons);
                }
            }
            Statement::ExpressionStatement(expr_stmt) => {
                Self::check_expr_for_directives(&expr_stmt.expression, ctx, reasons);
            }
            Statement::BlockStatement(blk) => {
                for s in &blk.body {
                    Self::check_stmt_for_directives(s, ctx, reasons);
                }
            }
            Statement::IfStatement(if_stmt) => {
                Self::check_expr_for_directives(&if_stmt.test, ctx, reasons);
                Self::check_stmt_for_directives(&if_stmt.consequent, ctx, reasons);
                if let Some(alt) = &if_stmt.alternate {
                    Self::check_stmt_for_directives(alt, ctx, reasons);
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &var_decl.declarations {
                    if let Some(init) = &decl.init {
                        Self::check_expr_for_directives(init, ctx, reasons);
                    }
                }
            }
            Statement::ForStatement(for_stmt) => {
                if let Some(init) = &for_stmt.init {
                    match init {
                        ForStatementInit::VariableDeclaration(v) => {
                            for d in &v.declarations {
                                if let Some(i) = &d.init {
                                    Self::check_expr_for_directives(i, ctx, reasons);
                                }
                            }
                        }
                        _ => {
                            if let Some(e) = init.as_expression() {
                                Self::check_expr_for_directives(e, ctx, reasons);
                            }
                        }
                    }
                }
                if let Some(test) = &for_stmt.test {
                    Self::check_expr_for_directives(test, ctx, reasons);
                }
                if let Some(update) = &for_stmt.update {
                    Self::check_expr_for_directives(update, ctx, reasons);
                }
                Self::check_stmt_for_directives(&for_stmt.body, ctx, reasons);
            }
            Statement::ForInStatement(for_in) => {
                Self::check_expr_for_directives(&for_in.right, ctx, reasons);
                Self::check_stmt_for_directives(&for_in.body, ctx, reasons);
            }
            Statement::ForOfStatement(for_of) => {
                Self::check_expr_for_directives(&for_of.right, ctx, reasons);
                Self::check_stmt_for_directives(&for_of.body, ctx, reasons);
            }
            Statement::WhileStatement(while_stmt) => {
                Self::check_expr_for_directives(&while_stmt.test, ctx, reasons);
                Self::check_stmt_for_directives(&while_stmt.body, ctx, reasons);
            }
            Statement::DoWhileStatement(do_while) => {
                Self::check_expr_for_directives(&do_while.test, ctx, reasons);
                Self::check_stmt_for_directives(&do_while.body, ctx, reasons);
            }
            Statement::SwitchStatement(switch_stmt) => {
                Self::check_expr_for_directives(&switch_stmt.discriminant, ctx, reasons);
                for case in &switch_stmt.cases {
                    if let Some(test) = &case.test {
                        Self::check_expr_for_directives(test, ctx, reasons);
                    }
                    for s in &case.consequent {
                        Self::check_stmt_for_directives(s, ctx, reasons);
                    }
                }
            }
            Statement::TryStatement(try_stmt) => {
                for s in &try_stmt.block.body {
                    Self::check_stmt_for_directives(s, ctx, reasons);
                }
                if let Some(handler) = &try_stmt.handler {
                    for s in &handler.body.body {
                        Self::check_stmt_for_directives(s, ctx, reasons);
                    }
                }
                if let Some(finalizer) = &try_stmt.finalizer {
                    for s in &finalizer.body {
                        Self::check_stmt_for_directives(s, ctx, reasons);
                    }
                }
            }
            _ => {}
        }
    }

    fn check_expr_for_directives<'a>(
        expr: &'a Expression<'a>,
        ctx: &SymbolProofContext<'a>,
        reasons: &mut Vec<BailoutReason>,
    ) {
        match expr {
            Expression::TaggedTemplateExpression(tagged) => {
                Self::check_expr_for_directives(&tagged.tag, ctx, reasons);
                for e in &tagged.quasi.expressions {
                    Self::check_expr_for_directives(e, ctx, reasons);
                }
            }
            Expression::CallExpression(call) => {
                Self::check_call_for_directives(call, ctx, reasons);
            }
            Expression::ConditionalExpression(c) => {
                Self::check_expr_for_directives(&c.test, ctx, reasons);
                Self::check_expr_for_directives(&c.consequent, ctx, reasons);
                Self::check_expr_for_directives(&c.alternate, ctx, reasons);
            }
            Expression::LogicalExpression(l) => {
                Self::check_expr_for_directives(&l.left, ctx, reasons);
                Self::check_expr_for_directives(&l.right, ctx, reasons);
            }
            Expression::ArrayExpression(a) => {
                for el in &a.elements {
                    if let Some(e) = el.as_expression() {
                        Self::check_expr_for_directives(e, ctx, reasons);
                    }
                }
            }
            Expression::ParenthesizedExpression(p) => {
                Self::check_expr_for_directives(&p.expression, ctx, reasons);
            }
            Expression::SequenceExpression(s) => {
                for e in &s.expressions {
                    Self::check_expr_for_directives(e, ctx, reasons);
                }
            }
            Expression::BinaryExpression(b) => {
                Self::check_expr_for_directives(&b.left, ctx, reasons);
                Self::check_expr_for_directives(&b.right, ctx, reasons);
            }
            Expression::UnaryExpression(u) => {
                Self::check_expr_for_directives(&u.argument, ctx, reasons);
            }
            Expression::TemplateLiteral(t) => {
                for e in &t.expressions {
                    Self::check_expr_for_directives(e, ctx, reasons);
                }
            }
            Expression::AwaitExpression(a) => {
                Self::check_expr_for_directives(&a.argument, ctx, reasons);
            }
            Expression::ChainExpression(c) => match &c.expression {
                ChainElement::CallExpression(call) => {
                    Self::check_call_for_directives(call, ctx, reasons);
                }
                ChainElement::StaticMemberExpression(m) => {
                    Self::check_expr_for_directives(&m.object, ctx, reasons);
                }
                ChainElement::ComputedMemberExpression(m) => {
                    Self::check_expr_for_directives(&m.object, ctx, reasons);
                    Self::check_expr_for_directives(&m.expression, ctx, reasons);
                }
                ChainElement::PrivateFieldExpression(m) => {
                    Self::check_expr_for_directives(&m.object, ctx, reasons);
                }
                ChainElement::TSNonNullExpression(n) => {
                    Self::check_expr_for_directives(&n.expression, ctx, reasons);
                }
            },
            Expression::ObjectExpression(o) => {
                for prop in &o.properties {
                    match prop {
                        ObjectPropertyKind::ObjectProperty(p) => {
                            Self::check_expr_for_directives(&p.value, ctx, reasons);
                        }
                        ObjectPropertyKind::SpreadProperty(s) => {
                            Self::check_expr_for_directives(&s.argument, ctx, reasons);
                        }
                    }
                }
            }
            Expression::ArrowFunctionExpression(arrow) => match &arrow.body {
                ArrowFunctionBody::FunctionBody(b) => {
                    for stmt in &b.statements {
                        Self::check_stmt_for_directives(stmt, ctx, reasons);
                    }
                }
                _ => {
                    if let Some(expr) = arrow.body.as_expression() {
                        Self::check_expr_for_directives(expr, ctx, reasons);
                    }
                }
            },
            Expression::FunctionExpression(func) => {
                if let Some(body) = &func.body {
                    for stmt in &body.statements {
                        Self::check_stmt_for_directives(stmt, ctx, reasons);
                    }
                }
            }
            Expression::AssignmentExpression(assign) => {
                Self::check_expr_for_directives(&assign.right, ctx, reasons);
            }
            Expression::StaticMemberExpression(m) => {
                Self::check_expr_for_directives(&m.object, ctx, reasons);
            }
            Expression::ComputedMemberExpression(m) => {
                Self::check_expr_for_directives(&m.object, ctx, reasons);
                Self::check_expr_for_directives(&m.expression, ctx, reasons);
            }
            _ => {}
        }
    }

    fn check_stmt_for_bailout<'a>(stmt: &'a Statement<'a>, reasons: &mut Vec<BailoutReason>) {
        match stmt {
            Statement::ReturnStatement(ret) => {
                if let Some(arg) = &ret.argument {
                    Self::check_expr_for_bailout(arg, reasons);
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &var_decl.declarations {
                    if let Some(init) = &decl.init {
                        Self::check_expr_for_bailout(init, reasons);
                    }
                }
            }
            Statement::ExpressionStatement(expr_stmt) => {
                Self::check_expr_for_bailout(&expr_stmt.expression, reasons);
            }
            Statement::BlockStatement(blk) => {
                for s in &blk.body {
                    Self::check_stmt_for_bailout(s, reasons);
                }
            }
            Statement::IfStatement(if_stmt) => {
                Self::check_expr_for_bailout(&if_stmt.test, reasons);
                Self::check_stmt_for_bailout(&if_stmt.consequent, reasons);
                if let Some(alt) = &if_stmt.alternate {
                    Self::check_stmt_for_bailout(alt, reasons);
                }
            }
            Statement::ForStatement(for_stmt) => {
                if let Some(init) = &for_stmt.init {
                    match init {
                        ForStatementInit::VariableDeclaration(v) => {
                            for d in &v.declarations {
                                if let Some(i) = &d.init {
                                    Self::check_expr_for_bailout(i, reasons);
                                }
                            }
                        }
                        _ => {
                            if let Some(e) = init.as_expression() {
                                Self::check_expr_for_bailout(e, reasons);
                            }
                        }
                    }
                }
                if let Some(test) = &for_stmt.test {
                    Self::check_expr_for_bailout(test, reasons);
                }
                if let Some(update) = &for_stmt.update {
                    Self::check_expr_for_bailout(update, reasons);
                }
                Self::check_stmt_for_bailout(&for_stmt.body, reasons);
            }
            Statement::ForInStatement(for_in) => {
                Self::check_expr_for_bailout(&for_in.right, reasons);
                Self::check_stmt_for_bailout(&for_in.body, reasons);
            }
            Statement::ForOfStatement(for_of) => {
                Self::check_expr_for_bailout(&for_of.right, reasons);
                Self::check_stmt_for_bailout(&for_of.body, reasons);
            }
            Statement::WhileStatement(while_stmt) => {
                Self::check_expr_for_bailout(&while_stmt.test, reasons);
                Self::check_stmt_for_bailout(&while_stmt.body, reasons);
            }
            Statement::DoWhileStatement(do_while) => {
                Self::check_expr_for_bailout(&do_while.test, reasons);
                Self::check_stmt_for_bailout(&do_while.body, reasons);
            }
            Statement::SwitchStatement(switch_stmt) => {
                Self::check_expr_for_bailout(&switch_stmt.discriminant, reasons);
                for case in &switch_stmt.cases {
                    if let Some(test) = &case.test {
                        Self::check_expr_for_bailout(test, reasons);
                    }
                    for s in &case.consequent {
                        Self::check_stmt_for_bailout(s, reasons);
                    }
                }
            }
            Statement::TryStatement(try_stmt) => {
                for s in &try_stmt.block.body {
                    Self::check_stmt_for_bailout(s, reasons);
                }
                if let Some(handler) = &try_stmt.handler {
                    for s in &handler.body.body {
                        Self::check_stmt_for_bailout(s, reasons);
                    }
                }
                if let Some(finalizer) = &try_stmt.finalizer {
                    for s in &finalizer.body {
                        Self::check_stmt_for_bailout(s, reasons);
                    }
                }
            }
            _ => {}
        }
    }

    fn check_call_for_bailout<'a>(call: &'a CallExpression<'a>, reasons: &mut Vec<BailoutReason>) {
        for arg in &call.arguments {
            if let Some(Expression::ThisExpression(_)) = arg.as_expression() {
                let is_allowed_call = match &call.callee {
                    Expression::StaticMemberExpression(mem) => {
                        if let Expression::ThisExpression(_) = &mem.object {
                            true
                        } else {
                            matches!(
                                mem.property.name.as_str(),
                                "observe"
                                    | "unobserve"
                                    | "contains"
                                    | "getComputedStyle"
                                    | "setValidity"
                                    | "setFormValue"
                            )
                        }
                    }
                    _ => false,
                };

                if !is_allowed_call {
                    let callee_str = match &call.callee {
                        Expression::Identifier(id) => id.name.as_str().to_string(),
                        Expression::StaticMemberExpression(m) => {
                            m.property.name.as_str().to_string()
                        }
                        _ => "externalCall".to_string(),
                    };
                    reasons.push(BailoutReason::UnresolvableThisEscape {
                        expression: callee_str,
                        span: (call.span.start, call.span.end),
                    });
                }
            }
        }

        if let Expression::StaticMemberExpression(mem) = &call.callee {
            if mem.property.name == "adoptedStyleSheets" {
                if let Expression::StaticMemberExpression(inner_mem) = &mem.object {
                    if inner_mem.property.name == "shadowRoot" {
                        reasons.push(BailoutReason::DirectShadowRootAccess {
                            operation: "adoptedStyleSheets mutation".to_string(),
                            span: (call.span.start, call.span.end),
                        });
                    }
                }
            }
        }

        Self::check_expr_for_bailout(&call.callee, reasons);
        for arg in &call.arguments {
            if let Some(e) = arg.as_expression() {
                Self::check_expr_for_bailout(e, reasons);
            }
        }
    }

    fn check_expr_for_bailout<'a>(expr: &'a Expression<'a>, reasons: &mut Vec<BailoutReason>) {
        match expr {
            Expression::CallExpression(call) => {
                Self::check_call_for_bailout(call, reasons);
            }
            Expression::AssignmentExpression(assign) => {
                if let AssignmentTarget::StaticMemberExpression(mem) = &assign.left {
                    if let Expression::StaticMemberExpression(inner_mem) = &mem.object {
                        if inner_mem.property.name == "shadowRoot" {
                            reasons.push(BailoutReason::DirectShadowRootAccess {
                                operation: format!("mutation of shadowRoot.{}", mem.property.name),
                                span: (assign.span.start, assign.span.end),
                            });
                        }
                    }
                }
                Self::check_expr_for_bailout(&assign.right, reasons);
            }
            Expression::ConditionalExpression(c) => {
                Self::check_expr_for_bailout(&c.test, reasons);
                Self::check_expr_for_bailout(&c.consequent, reasons);
                Self::check_expr_for_bailout(&c.alternate, reasons);
            }
            Expression::LogicalExpression(l) => {
                Self::check_expr_for_bailout(&l.left, reasons);
                Self::check_expr_for_bailout(&l.right, reasons);
            }
            Expression::ArrayExpression(a) => {
                for el in &a.elements {
                    if let Some(e) = el.as_expression() {
                        Self::check_expr_for_bailout(e, reasons);
                    }
                }
            }
            Expression::ParenthesizedExpression(p) => {
                Self::check_expr_for_bailout(&p.expression, reasons);
            }
            Expression::SequenceExpression(s) => {
                for e in &s.expressions {
                    Self::check_expr_for_bailout(e, reasons);
                }
            }
            Expression::UnaryExpression(u) => {
                Self::check_expr_for_bailout(&u.argument, reasons);
            }
            Expression::BinaryExpression(b) => {
                Self::check_expr_for_bailout(&b.left, reasons);
                Self::check_expr_for_bailout(&b.right, reasons);
            }
            Expression::AwaitExpression(a) => {
                Self::check_expr_for_bailout(&a.argument, reasons);
            }
            Expression::ChainExpression(c) => match &c.expression {
                ChainElement::CallExpression(call) => {
                    Self::check_call_for_bailout(call, reasons);
                }
                ChainElement::StaticMemberExpression(m) => {
                    Self::check_expr_for_bailout(&m.object, reasons);
                }
                ChainElement::ComputedMemberExpression(m) => {
                    Self::check_expr_for_bailout(&m.object, reasons);
                    Self::check_expr_for_bailout(&m.expression, reasons);
                }
                ChainElement::PrivateFieldExpression(m) => {
                    Self::check_expr_for_bailout(&m.object, reasons);
                }
                ChainElement::TSNonNullExpression(n) => {
                    Self::check_expr_for_bailout(&n.expression, reasons);
                }
            },
            Expression::ObjectExpression(o) => {
                for prop in &o.properties {
                    match prop {
                        ObjectPropertyKind::ObjectProperty(p) => {
                            Self::check_expr_for_bailout(&p.value, reasons);
                        }
                        ObjectPropertyKind::SpreadProperty(s) => {
                            Self::check_expr_for_bailout(&s.argument, reasons);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    fn qualifies_tier2<'a>(
        class: &'a Class<'a>,
        slots: &[SlotInfo],
        shadow_root_options: Option<&ShadowRootOptions>,
        decorators: &[ExtractedDecorator],
    ) -> bool {
        // 1. Delegated focus: static shadowRootOptions = { delegatesFocus: true }
        if let Some(sro) = shadow_root_options {
            if sro.delegates_focus {
                return true;
            }
        }

        // 2. Inspected slot: <slot @slotchange=...>
        if slots.iter().any(|s| s.inspected) {
            return true;
        }

        // 3. QueryAssignedElements or QueryAssignedNodes decorators
        if decorators.iter().any(|d| {
            matches!(
                d.kind,
                LitDecoratorKind::QueryAssignedElements { .. }
                    | LitDecoratorKind::QueryAssignedNodes { .. }
            )
        }) {
            return true;
        }

        // 4. Form participation / ElementInternals
        for element in &class.body.body {
            match element {
                // static formAssociated = true
                ClassElement::PropertyDefinition(prop) => {
                    if prop.r#static && prop.key.is_specific_static_name("formAssociated") {
                        if let Some(val) = &prop.value {
                            if crate::property::PropertyModelExtractor::evaluate_boolean(val)
                                .unwrap_or(false)
                            {
                                return true;
                            }
                        }
                    }
                }
                ClassElement::MethodDefinition(method) => {
                    // static get formAssociated() { return true; }
                    if method.r#static
                        && method.kind == MethodDefinitionKind::Get
                        && method.key.is_specific_static_name("formAssociated")
                    {
                        if let Some(body) = &method.value.body {
                            for stmt in &body.statements {
                                if let Statement::ReturnStatement(ret) = stmt {
                                    if let Some(arg) = &ret.argument {
                                        if crate::property::PropertyModelExtractor::evaluate_boolean(arg)
                                            .unwrap_or(false)
                                        {
                                            return true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if let Some(name) = method.key.static_name() {
                        if Self::FORM_CALLBACKS.contains(&name.as_ref()) {
                            return true;
                        }
                    }
                    // check method body for attachInternals() or assignedElements()
                    if let Some(body) = &method.value.body {
                        for stmt in &body.statements {
                            if Self::stmt_has_tier2_call(stmt) {
                                return true;
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        false
    }

    fn stmt_has_tier2_call<'a>(stmt: &'a Statement<'a>) -> bool {
        if let Statement::ExpressionStatement(expr_stmt) = stmt {
            Self::expr_has_tier2_call(&expr_stmt.expression)
        } else if let Statement::VariableDeclaration(var_decl) = stmt {
            var_decl.declarations.iter().any(|d| {
                d.init
                    .as_ref()
                    .is_some_and(|init| Self::expr_has_tier2_call(init))
            })
        } else {
            false
        }
    }

    fn expr_has_tier2_call<'a>(expr: &'a Expression<'a>) -> bool {
        match expr {
            Expression::CallExpression(call) => {
                if let Expression::StaticMemberExpression(mem) = &call.callee {
                    let name = mem.property.name.as_str();
                    if matches!(
                        name,
                        "attachInternals"
                            | "assignedElements"
                            | "assignedNodes"
                            | "setFormValue"
                            | "setValidity"
                    ) {
                        return true;
                    }
                }
                false
            }
            _ => false,
        }
    }

    fn qualifies_tier0<'a>(
        class: &'a Class<'a>,
        properties: &[PropertyInfo],
        events: &[EventInfo],
        slots: &[SlotInfo],
        ctx: &SymbolProofContext<'a>,
    ) -> bool {
        // Subclasses and mixin consumers must enter Tier 1 Hosted or higher
        match ctx.prove_heritage(class) {
            crate::symbol::HeritageProof::ProvenLitElement { mixins, .. }
            | crate::symbol::HeritageProof::ProvenReactiveElement { mixins, .. }
            | crate::symbol::HeritageProof::ContractualLitElement { mixins, .. } => {
                if !mixins.is_empty() {
                    return false;
                }
            }
            _ => return false,
        }

        // Must have no properties
        if !properties.is_empty() {
            return false;
        }

        // Must have no events
        if !events.is_empty() {
            return false;
        }

        // Must have no slots
        if !slots.is_empty() {
            return false;
        }

        // Must not implement lifecycle methods or mutate `this`
        for element in &class.body.body {
            match element {
                ClassElement::MethodDefinition(method) => {
                    if let Some(name) = method.key.static_name() {
                        if Self::LIFECYCLE_METHODS.contains(&name.as_ref()) {
                            return false;
                        }
                        if !method.r#static && name != "render" {
                            // Any non-render instance method means potential state or logic
                            return false;
                        }
                    }
                }
                ClassElement::PropertyDefinition(prop) if !prop.r#static => {
                    return false;
                }
                _ => {}
            }
        }

        true
    }
}
