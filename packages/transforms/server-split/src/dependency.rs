use std::collections::HashSet;

use lit_analysis::{ExtractedDecorator, PropertyModelExtractor};
use oxc_ast::ast::*;
use oxc_ast_visit::{Visit, walk};
use oxc_span::Span;

use crate::diagnostics::{DiagnosticCode, error_diagnostic, warning_diagnostic};
use crate::options::ServerSplitDiagnostic;
use crate::symbol::{ExtractedServerMethod, ServerDecoratorKind};

pub struct PropertyDependencyAuditor<'a> {
    pub declared_reactive_props: HashSet<String>,
    pub loader_written_props: HashSet<String>,
    pub action_written_props: HashMap<String, Vec<String>>,
    pub diagnostics: Vec<ServerSplitDiagnostic>,
    _phantom: std::marker::PhantomData<&'a ()>,
}

use std::collections::HashMap;

impl<'a> PropertyDependencyAuditor<'a> {
    pub fn new(
        program: &'a Program<'a>,
        class: &'a Class<'a>,
        source_text: Option<&'a str>,
    ) -> Self {
        let class_name = class
            .id
            .as_ref()
            .map(|id| id.name.as_str())
            .unwrap_or("Component");
        let empty_extracted_decorators: Vec<ExtractedDecorator> = Vec::new();

        // Extract declared properties using lit_analysis
        let prop_infos = PropertyModelExtractor::extract_all(
            program,
            class,
            class_name,
            &empty_extracted_decorators,
            source_text,
        );

        let mut declared_reactive_props = HashSet::new();
        for p in prop_infos {
            declared_reactive_props.insert(p.name);
        }

        // Also check class property decorators (@property, @state) directly if any
        for el in &class.body.body {
            if let ClassElement::PropertyDefinition(prop) = el {
                let prop_name = match &prop.key {
                    PropertyKey::StaticIdentifier(id) => Some(id.name.as_str().to_string()),
                    PropertyKey::StringLiteral(s) => Some(s.value.as_str().to_string()),
                    _ => None,
                };
                if let Some(name) = prop_name {
                    let has_lit_dec = !prop.decorators.is_empty();
                    if has_lit_dec {
                        declared_reactive_props.insert(name);
                    }
                }
            }
        }

        Self {
            declared_reactive_props,
            loader_written_props: HashSet::new(),
            action_written_props: HashMap::new(),
            diagnostics: Vec::new(),
            _phantom: std::marker::PhantomData,
        }
    }

    pub fn audit_server_methods(&mut self, server_methods: &[ExtractedServerMethod<'a>]) {
        let _loader_names: HashSet<String> = server_methods
            .iter()
            .filter(|m| m.kind == ServerDecoratorKind::Loader)
            .map(|m| m.name.clone())
            .collect();

        for method in server_methods {
            if let Some(body) = &method.method_def.value.body {
                let mut scanner = ThisAssignmentScanner {
                    written_props: Vec::new(),
                    called_methods: Vec::new(),
                };
                scanner.visit_function_body(body);

                match method.kind {
                    ServerDecoratorKind::Loader => {
                        for (prop, span) in &scanner.written_props {
                            self.loader_written_props.insert(prop.clone());
                            if !self.declared_reactive_props.contains(prop) {
                                self.diagnostics.push(warning_diagnostic(
                                    DiagnosticCode::SE103,
                                    format!(
                                        "Property '{}' modified in @loader() is not declared as a reactive property in static properties or with @property()/@state(). Edge SSR and action patch evaluation require declared reactive properties.",
                                        prop
                                    ),
                                    *span,
                                ));
                            }
                        }
                    }
                    ServerDecoratorKind::Action => {
                        let mut written = Vec::new();
                        for (prop, span) in scanner.written_props {
                            written.push(prop.clone());
                            if !self.declared_reactive_props.contains(&prop) {
                                self.diagnostics.push(warning_diagnostic(
                                    DiagnosticCode::SE103,
                                    format!(
                                        "Property '{}' modified in @action() is not declared as a reactive property in static properties or with @property()/@state(). Edge SSR and action patch evaluation require declared reactive properties.",
                                        prop
                                    ),
                                    span,
                                ));
                            }
                        }
                        self.action_written_props
                            .insert(method.name.clone(), written);
                    }
                }
            }
        }
    }

    pub fn audit_render(&mut self, class: &'a Class<'a>, loader_names: &HashSet<String>) {
        for el in &class.body.body {
            if let ClassElement::MethodDefinition(method) = el
                && method.key.static_name().is_some_and(|n| n == "render")
                && let Some(body) = &method.value.body
            {
                let mut scanner = ThisAssignmentScanner {
                    written_props: Vec::new(),
                    called_methods: Vec::new(),
                };
                scanner.visit_function_body(body);

                for (called_name, span) in scanner.called_methods {
                    if loader_names.contains(&called_name) {
                        self.diagnostics.push(error_diagnostic(
                            DiagnosticCode::SE104,
                            format!(
                                "render() method attempts to invoke @loader() method '{}' directly. Loaders execute only on the edge; access loader data through declared reactive properties.",
                                called_name
                            ),
                            span,
                        ));
                    }
                }
            }
        }
    }
}

struct ThisAssignmentScanner {
    written_props: Vec<(String, Span)>,
    called_methods: Vec<(String, Span)>,
}

impl<'a> Visit<'a> for ThisAssignmentScanner {
    fn visit_assignment_expression(&mut self, expr: &AssignmentExpression<'a>) {
        if let Some((prop_name, span)) = extract_this_member_target(&expr.left) {
            self.written_props.push((prop_name, span));
        }
        walk::walk_assignment_expression(self, expr);
    }

    fn visit_call_expression(&mut self, expr: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(mem) = expr.callee.without_parentheses()
            && matches!(
                mem.object.without_parentheses(),
                Expression::ThisExpression(_)
            )
        {
            self.called_methods
                .push((mem.property.name.as_str().to_string(), mem.span));
        }
        walk::walk_call_expression(self, expr);
    }
}

fn extract_this_member_target<'a>(target: &AssignmentTarget<'a>) -> Option<(String, Span)> {
    match target {
        AssignmentTarget::StaticMemberExpression(mem) => {
            if matches!(
                mem.object.without_parentheses(),
                Expression::ThisExpression(_)
            ) {
                return Some((mem.property.name.as_str().to_string(), mem.span));
            }
        }
        AssignmentTarget::ComputedMemberExpression(mem) => {
            if matches!(
                mem.object.without_parentheses(),
                Expression::ThisExpression(_)
            ) && let Expression::StringLiteral(s) = mem.expression.without_parentheses()
            {
                return Some((s.value.as_str().to_string(), mem.span));
            }
        }
        _ => {}
    }
    None
}
