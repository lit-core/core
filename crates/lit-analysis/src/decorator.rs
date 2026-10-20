use crate::symbol::{CanonicalHelperSymbol, CanonicalLitSymbol, SymbolProofContext};
use oxc_ast::ast::*;
use oxc_semantic::SymbolId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LitDecoratorKind {
    CustomElement {
        tag: String,
    },
    Property {
        options_json: Option<String>,
        prop_type: Option<String>,
        reflect: bool,
        attribute: Option<String>,
        has_changed: Option<String>,
        no_accessor: bool,
    },
    State {
        options_json: Option<String>,
        has_changed: Option<String>,
    },
    Query {
        selector: String,
    },
    QueryAll {
        selector: String,
    },
    QueryAsync {
        selector: String,
    },
    QueryAssignedElements {
        selector: Option<String>,
        slot: Option<String>,
    },
    QueryAssignedNodes {
        slot: Option<String>,
    },
    EventOptions {
        capture: bool,
        passive: bool,
        once: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedDecorator {
    pub kind: LitDecoratorKind,
    pub target_member: Option<String>,
    pub span: (u32, u32),
}

pub struct DecoratorExtractor;

impl DecoratorExtractor {
    pub fn extract_class_decorators<'a>(
        class: &'a Class<'a>,
        ctx: &SymbolProofContext<'a>,
    ) -> Vec<ExtractedDecorator> {
        let mut extracted = Vec::new();

        for dec in &class.decorators {
            if let Some(kind) = Self::parse_decorator_expr(&dec.expression, ctx) {
                extracted.push(ExtractedDecorator {
                    kind,
                    target_member: None,
                    span: (dec.span.start, dec.span.end),
                });
            } else if let Some(tag) = ctx.is_class_custom_element_decorator_call(&dec.expression) {
                extracted.push(ExtractedDecorator {
                    kind: LitDecoratorKind::CustomElement { tag },
                    target_member: None,
                    span: (dec.span.start, dec.span.end),
                });
            }
        }

        extracted
    }

    pub fn extract_member_decorators<'a>(
        class: &'a Class<'a>,
        ctx: &SymbolProofContext<'a>,
    ) -> Vec<ExtractedDecorator> {
        let mut extracted = Vec::new();

        for element in &class.body.body {
            match element {
                ClassElement::PropertyDefinition(prop) => {
                    let prop_name = prop.key.static_name().map(|s| s.to_string());
                    for dec in &prop.decorators {
                        if let Some(kind) = Self::parse_decorator_expr(&dec.expression, ctx) {
                            extracted.push(ExtractedDecorator {
                                kind,
                                target_member: prop_name.clone(),
                                span: (dec.span.start, dec.span.end),
                            });
                        }
                    }
                }
                ClassElement::MethodDefinition(method) => {
                    let method_name = method.key.static_name().map(|s| s.to_string());
                    for dec in &method.decorators {
                        if let Some(kind) = Self::parse_decorator_expr(&dec.expression, ctx) {
                            extracted.push(ExtractedDecorator {
                                kind,
                                target_member: method_name.clone(),
                                span: (dec.span.start, dec.span.end),
                            });
                        }
                    }
                }
                ClassElement::AccessorProperty(accessor) => {
                    let acc_name = accessor.key.static_name().map(|s| s.to_string());
                    for dec in &accessor.decorators {
                        if let Some(kind) = Self::parse_decorator_expr(&dec.expression, ctx) {
                            extracted.push(ExtractedDecorator {
                                kind,
                                target_member: acc_name.clone(),
                                span: (dec.span.start, dec.span.end),
                            });
                        }
                    }
                }
                _ => {}
            }
        }

        extracted
    }

    /// Extracts transpiled decorator helpers (`__decorate`, `__decorateClass`, inline functions)
    /// from statements outside the class body.
    pub fn extract_transpiled_helpers<'a>(
        program: &'a Program<'a>,
        class_name: &str,
        ctx: &SymbolProofContext<'a>,
    ) -> Vec<ExtractedDecorator> {
        let mut extracted = Vec::new();

        for stmt in &program.body {
            match stmt {
                Statement::ExpressionStatement(expr_stmt) => {
                    Self::inspect_expression_for_helpers(
                        &expr_stmt.expression,
                        class_name,
                        ctx,
                        &mut extracted,
                    );
                }
                Statement::VariableDeclaration(var_decl) => {
                    for decl in &var_decl.declarations {
                        if let Some(init) = &decl.init {
                            Self::inspect_expression_for_helpers(
                                init,
                                class_name,
                                ctx,
                                &mut extracted,
                            );
                        }
                    }
                }
                _ => {}
            }
        }

        extracted
    }

    /// Finds custom element tag from `customElements.define("tag", Target)` or class decorators.
    pub fn extract_custom_element_tag<'a>(
        program: &'a Program<'a>,
        class_name: &str,
        class_sym_id: Option<SymbolId>,
        class_decorators: &[ExtractedDecorator],
        ctx: &SymbolProofContext<'a>,
    ) -> Option<String> {
        // 1. From class decorators
        for dec in class_decorators {
            if let LitDecoratorKind::CustomElement { tag } = &dec.kind {
                return Some(tag.clone());
            }
        }

        // 2. From statements: customElements.define("my-tag", TargetClass)
        for stmt in &program.body {
            if let Statement::ExpressionStatement(expr_stmt) = stmt {
                if let Expression::CallExpression(call) = &expr_stmt.expression {
                    if let Some(reg) = ctx.is_custom_elements_define(call) {
                        let targets_class = match reg.class_expr {
                            Expression::Identifier(id) => {
                                if let Some(target_sym) = class_sym_id {
                                    id.reference_id
                                        .get()
                                        .and_then(|r| ctx.scoping.get_reference(r).symbol_id())
                                        == Some(target_sym)
                                } else {
                                    id.name == class_name
                                }
                            }
                            _ => false,
                        };

                        if targets_class {
                            if let Some(tag) = reg.tag {
                                return Some(tag);
                            }
                        }
                    }
                }
            }
        }

        None
    }

    fn inspect_expression_for_helpers<'a>(
        expr: &'a Expression<'a>,
        class_name: &str,
        ctx: &SymbolProofContext<'a>,
        extracted: &mut Vec<ExtractedDecorator>,
    ) {
        match expr {
            Expression::CallExpression(call) => {
                Self::try_extract_helper_call(call, class_name, ctx, extracted);
            }
            Expression::AssignmentExpression(assign) => {
                // Class decorator assignment: Target = helper([customElement("...")], Target)
                if let Expression::CallExpression(call) = &assign.right {
                    Self::try_extract_helper_call(call, class_name, ctx, extracted);
                }
            }
            Expression::SequenceExpression(seq) => {
                for e in &seq.expressions {
                    Self::inspect_expression_for_helpers(e, class_name, ctx, extracted);
                }
            }
            _ => {}
        }
    }

    fn try_extract_helper_call<'a>(
        call: &'a CallExpression<'a>,
        class_name: &str,
        ctx: &SymbolProofContext<'a>,
        extracted: &mut Vec<ExtractedDecorator>,
    ) {
        if call.arguments.len() < 2 {
            return;
        }

        let helper_kind = match call.callee.without_parentheses() {
            Expression::Identifier(id) => ctx.resolve_helper_symbol(id),
            _ => None,
        };
        let Some(helper_kind) = helper_kind else {
            return;
        };

        match helper_kind {
            CanonicalHelperSymbol::ApplyDecoratedDescriptor => {
                // Babel: applyDecoratedDescriptor(Target.prototype, "propName", [decorators], descriptor, target)
                if call.arguments.len() >= 3 {
                    if let Some(Expression::StaticMemberExpression(mem)) =
                        call.arguments[0].as_expression()
                    {
                        if mem.property.name == "prototype" {
                            if let Expression::Identifier(target_id) = &mem.object {
                                if target_id.name == class_name {
                                    let prop_name = match call.arguments[1].as_expression() {
                                        Some(Expression::StringLiteral(s)) => {
                                            Some(s.value.to_string())
                                        }
                                        Some(Expression::Identifier(id)) => {
                                            Some(id.name.to_string())
                                        }
                                        _ => None,
                                    };

                                    if let Some(Expression::ArrayExpression(decorators_arr)) =
                                        call.arguments[2].as_expression()
                                    {
                                        for elem in &decorators_arr.elements {
                                            if let Some(dec_expr) = elem.as_expression() {
                                                if Self::is_metadata_helper(dec_expr, ctx) {
                                                    continue;
                                                }
                                                if let Some(kind) =
                                                    Self::parse_decorator_expr(dec_expr, ctx)
                                                {
                                                    extracted.push(ExtractedDecorator {
                                                        kind,
                                                        target_member: prop_name.clone(),
                                                        span: (call.span.start, call.span.end),
                                                    });
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
            CanonicalHelperSymbol::Decorate | CanonicalHelperSymbol::DecorateClass => {
                let decorators_arr = match call.arguments[0].as_expression() {
                    Some(Expression::ArrayExpression(arr)) => arr,
                    _ => return,
                };

                // Form A: Member decorator call
                // helper([dec1, dec2], TargetClass.prototype, "propName", descriptor)
                if call.arguments.len() >= 3 {
                    if let Some(Expression::StaticMemberExpression(mem)) =
                        call.arguments[1].as_expression()
                    {
                        if mem.property.name == "prototype" {
                            if let Expression::Identifier(target_id) = &mem.object {
                                if target_id.name == class_name {
                                    let prop_name = match call.arguments[2].as_expression() {
                                        Some(Expression::StringLiteral(s)) => {
                                            Some(s.value.to_string())
                                        }
                                        Some(Expression::Identifier(id)) => {
                                            Some(id.name.to_string())
                                        }
                                        _ => None,
                                    };

                                    for elem in &decorators_arr.elements {
                                        if let Some(dec_expr) = elem.as_expression() {
                                            if Self::is_metadata_helper(dec_expr, ctx) {
                                                continue;
                                            }
                                            if let Some(kind) =
                                                Self::parse_decorator_expr(dec_expr, ctx)
                                            {
                                                extracted.push(ExtractedDecorator {
                                                    kind,
                                                    target_member: prop_name.clone(),
                                                    span: (call.span.start, call.span.end),
                                                });
                                            }
                                        }
                                    }
                                    return;
                                }
                            }
                        }
                    }
                }

                // Form B: Class decorator call
                // helper([customElement("my-tag")], TargetClass)
                if let Some(Expression::Identifier(target_id)) = call.arguments[1].as_expression() {
                    if target_id.name == class_name {
                        for elem in &decorators_arr.elements {
                            if let Some(dec_expr) = elem.as_expression() {
                                if let Some(kind) = Self::parse_decorator_expr(dec_expr, ctx) {
                                    extracted.push(ExtractedDecorator {
                                        kind,
                                        target_member: None,
                                        span: (call.span.start, call.span.end),
                                    });
                                } else if let Some(tag) =
                                    ctx.is_class_custom_element_decorator_call(dec_expr)
                                {
                                    extracted.push(ExtractedDecorator {
                                        kind: LitDecoratorKind::CustomElement { tag },
                                        target_member: None,
                                        span: (call.span.start, call.span.end),
                                    });
                                }
                            }
                        }
                    }
                }
            }
            CanonicalHelperSymbol::Metadata => {}
        }
    }

    fn is_metadata_helper<'a>(expr: &'a Expression<'a>, ctx: &SymbolProofContext<'a>) -> bool {
        if let Expression::CallExpression(call) = expr {
            if let Expression::Identifier(id) = &call.callee {
                ctx.resolve_helper_symbol(id) == Some(CanonicalHelperSymbol::Metadata)
            } else {
                false
            }
        } else {
            false
        }
    }

    pub fn parse_decorator_expr<'a>(
        expr: &'a Expression<'a>,
        ctx: &SymbolProofContext<'a>,
    ) -> Option<LitDecoratorKind> {
        match expr {
            Expression::Identifier(ident) => {
                let sym = ctx.resolve_symbol(ident);
                match sym {
                    Some(CanonicalLitSymbol::PropertyDecorator) => {
                        Some(LitDecoratorKind::Property {
                            options_json: None,
                            prop_type: None,
                            reflect: false,
                            attribute: None,
                            has_changed: None,
                            no_accessor: false,
                        })
                    }
                    Some(CanonicalLitSymbol::StateDecorator) => Some(LitDecoratorKind::State {
                        options_json: None,
                        has_changed: None,
                    }),
                    _ => None,
                }
            }
            Expression::CallExpression(call) => {
                let canonical_kind = ctx.is_proven_decorator(expr);

                match canonical_kind {
                    Some(CanonicalLitSymbol::CustomElementDecorator) => {
                        let tag = call
                            .arguments
                            .first()
                            .and_then(|a| a.as_expression())
                            .and_then(SymbolProofContext::extract_static_string)
                            .unwrap_or_default();
                        Some(LitDecoratorKind::CustomElement { tag })
                    }
                    Some(CanonicalLitSymbol::PropertyDecorator) => {
                        let mut prop_type = None;
                        let mut reflect = false;
                        let mut attribute = None;
                        let mut has_changed = None;
                        let mut no_accessor = false;

                        if let Some(Expression::ObjectExpression(obj)) =
                            call.arguments.first().and_then(|a| a.as_expression())
                        {
                            for prop in &obj.properties {
                                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                                    if let Some(key_name) = p.key.static_name() {
                                        match key_name.as_ref() {
                                            "type" => {
                                                if let Expression::Identifier(t_id) = &p.value {
                                                    prop_type = Some(t_id.name.to_string());
                                                }
                                            }
                                            "reflect" => {
                                                reflect = crate::property::PropertyModelExtractor::evaluate_boolean(&p.value).unwrap_or(false);
                                            }
                                            "attribute" => {
                                                attribute = match &p.value {
                                                        Expression::StringLiteral(s) => Some(s.value.to_string()),
                                                        other => {
                                                            if let Some(b) = crate::property::PropertyModelExtractor::evaluate_boolean(other) {
                                                                if !b {
                                                                    Some("__DISABLED__".to_string())
                                                                } else {
                                                                    None
                                                                }
                                                            } else {
                                                                None
                                                            }
                                                        }
                                                    };
                                            }
                                            "hasChanged" => {
                                                has_changed = crate::property::PropertyModelExtractor::extract_has_changed(p, Some(ctx.source_text));
                                            }
                                            "noAccessor" => {
                                                no_accessor = crate::property::PropertyModelExtractor::evaluate_boolean(&p.value).unwrap_or(false);
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                            }
                        }

                        Some(LitDecoratorKind::Property {
                            options_json: None,
                            prop_type,
                            reflect,
                            attribute,
                            has_changed,
                            no_accessor,
                        })
                    }
                    Some(CanonicalLitSymbol::StateDecorator) => {
                        let mut has_changed = None;
                        if let Some(Expression::ObjectExpression(obj)) =
                            call.arguments.first().and_then(|a| a.as_expression())
                        {
                            for prop in &obj.properties {
                                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                                    if let Some(key_name) = p.key.static_name() {
                                        if key_name.as_ref() == "hasChanged" {
                                            has_changed = crate::property::PropertyModelExtractor::extract_has_changed(p, Some(ctx.source_text));
                                        }
                                    }
                                }
                            }
                        }
                        Some(LitDecoratorKind::State {
                            options_json: None,
                            has_changed,
                        })
                    }
                    Some(CanonicalLitSymbol::QueryDecorator) => {
                        let selector = call
                            .arguments
                            .first()
                            .and_then(|a| a.as_expression())
                            .and_then(|e| match e {
                                Expression::StringLiteral(s) => Some(s.value.to_string()),
                                _ => None,
                            })
                            .unwrap_or_default();
                        Some(LitDecoratorKind::Query { selector })
                    }
                    Some(CanonicalLitSymbol::QueryAllDecorator) => {
                        let selector = call
                            .arguments
                            .first()
                            .and_then(|a| a.as_expression())
                            .and_then(|e| match e {
                                Expression::StringLiteral(s) => Some(s.value.to_string()),
                                _ => None,
                            })
                            .unwrap_or_default();
                        Some(LitDecoratorKind::QueryAll { selector })
                    }
                    Some(CanonicalLitSymbol::QueryAsyncDecorator) => {
                        let selector = call
                            .arguments
                            .first()
                            .and_then(|a| a.as_expression())
                            .and_then(|e| match e {
                                Expression::StringLiteral(s) => Some(s.value.to_string()),
                                _ => None,
                            })
                            .unwrap_or_default();
                        Some(LitDecoratorKind::QueryAsync { selector })
                    }
                    Some(CanonicalLitSymbol::QueryAssignedElementsDecorator) => {
                        let mut selector = None;
                        let mut slot = None;
                        if let Some(Expression::ObjectExpression(obj)) =
                            call.arguments.first().and_then(|a| a.as_expression())
                        {
                            for prop in &obj.properties {
                                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                                    if let Some(key_name) = p.key.static_name() {
                                        match key_name.as_ref() {
                                            "slot" => {
                                                if let Expression::StringLiteral(s) = &p.value {
                                                    slot = Some(s.value.to_string());
                                                }
                                            }
                                            "selector" => {
                                                if let Expression::StringLiteral(s) = &p.value {
                                                    selector = Some(s.value.to_string());
                                                }
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                            }
                        }
                        Some(LitDecoratorKind::QueryAssignedElements { selector, slot })
                    }
                    Some(CanonicalLitSymbol::QueryAssignedNodesDecorator) => {
                        let mut slot = None;
                        if let Some(Expression::ObjectExpression(obj)) =
                            call.arguments.first().and_then(|a| a.as_expression())
                        {
                            for prop in &obj.properties {
                                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                                    if let Some(key_name) = p.key.static_name() {
                                        if key_name == "slot" {
                                            if let Expression::StringLiteral(s) = &p.value {
                                                slot = Some(s.value.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Some(LitDecoratorKind::QueryAssignedNodes { slot })
                    }
                    Some(CanonicalLitSymbol::EventOptionsDecorator) => {
                        let mut capture = false;
                        let mut passive = false;
                        let mut once = false;
                        if let Some(Expression::ObjectExpression(obj)) =
                            call.arguments.first().and_then(|a| a.as_expression())
                        {
                            for prop in &obj.properties {
                                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                                    if let Some(key_name) = p.key.static_name() {
                                        match key_name.as_ref() {
                                            "capture" => {
                                                capture = match &p.value {
                                                    Expression::BooleanLiteral(b) => b.value,
                                                    _ => false,
                                                }
                                            }
                                            "passive" => {
                                                passive = match &p.value {
                                                    Expression::BooleanLiteral(b) => b.value,
                                                    _ => false,
                                                }
                                            }
                                            "once" => {
                                                once = match &p.value {
                                                    Expression::BooleanLiteral(b) => b.value,
                                                    _ => false,
                                                }
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                            }
                        }
                        Some(LitDecoratorKind::EventOptions {
                            capture,
                            passive,
                            once,
                        })
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }
}
