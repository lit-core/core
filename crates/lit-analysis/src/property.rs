use crate::decorator::{ExtractedDecorator, LitDecoratorKind};
use oxc_ast::ast::*;
use oxc_span::GetSpan;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PropertyType {
    String,
    Number,
    Boolean,
    Array,
    Object,
    Custom,
    Unknown,
}

impl PropertyType {
    pub fn from_str_name(name: &str) -> Self {
        match name {
            "String" => Self::String,
            "Number" => Self::Number,
            "Boolean" => Self::Boolean,
            "Array" => Self::Array,
            "Object" => Self::Object,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PropertyInfo {
    pub name: String,
    pub property_type: PropertyType,
    pub attribute: Option<String>,
    pub reflect: bool,
    pub has_changed: Option<String>,
    pub no_accessor: bool,
    pub is_state: bool,
    pub default_value: Option<String>,
}

pub struct PropertyModelExtractor;

impl PropertyModelExtractor {
    pub fn to_kebab_case(s: &str) -> String {
        let mut result = String::new();
        for (i, c) in s.chars().enumerate() {
            if c.is_uppercase() {
                if i > 0 {
                    result.push('-');
                }
                for lc in c.to_lowercase() {
                    result.push(lc);
                }
            } else {
                result.push(c);
            }
        }
        result
    }

    pub fn extract_all<'a>(
        program: &'a Program<'a>,
        class: &'a Class<'a>,
        class_name: &str,
        decorators: &[ExtractedDecorator],
        source_text: Option<&'a str>,
    ) -> Vec<PropertyInfo> {
        let mut props_map: HashMap<String, PropertyInfo> = HashMap::new();

        // 1. From decorators (@property, @state)
        for dec in decorators {
            if let Some(target) = &dec.target_member {
                match &dec.kind {
                    LitDecoratorKind::Property {
                        prop_type,
                        reflect,
                        attribute,
                        has_changed,
                        no_accessor,
                        ..
                    } => {
                        let pt = prop_type
                            .as_ref()
                            .map(|s| PropertyType::from_str_name(s))
                            .unwrap_or(PropertyType::Unknown);

                        let attr = match attribute.as_deref() {
                            Some("__DISABLED__") => None,
                            Some(custom) => Some(custom.to_string()),
                            None => Some(Self::to_kebab_case(target)),
                        };

                        props_map.insert(
                            target.clone(),
                            PropertyInfo {
                                name: target.clone(),
                                property_type: pt,
                                attribute: attr,
                                reflect: *reflect,
                                has_changed: has_changed.clone(),
                                no_accessor: *no_accessor,
                                is_state: false,
                                default_value: None,
                            },
                        );
                    }
                    LitDecoratorKind::State { has_changed, .. } => {
                        props_map.insert(
                            target.clone(),
                            PropertyInfo {
                                name: target.clone(),
                                property_type: PropertyType::Unknown,
                                attribute: None,
                                reflect: false,
                                has_changed: has_changed.clone(),
                                no_accessor: false,
                                is_state: true,
                                default_value: None,
                            },
                        );
                    }
                    _ => {}
                }
            }
        }

        // 2. From static properties fields and getters
        let static_props = Self::extract_from_static_properties(class, source_text);
        for sp in static_props {
            props_map.entry(sp.name.clone()).or_insert(sp);
        }

        // 3. From post-class assignment: TargetClass.properties = { ... }
        let post_props = Self::extract_from_post_class_assignment(program, class_name, source_text);
        for pp in post_props {
            props_map.entry(pp.name.clone()).or_insert(pp);
        }

        // 4. Extract default values from field initializers and constructor assignments
        let mut properties: Vec<PropertyInfo> = props_map.into_values().collect();
        Self::extract_default_values(class, &mut properties);

        properties.sort_by(|a, b| a.name.cmp(&b.name));
        properties
    }

    pub fn extract_from_static_properties<'a>(
        class: &'a Class<'a>,
        source_text: Option<&'a str>,
    ) -> Vec<PropertyInfo> {
        let mut properties = Vec::new();

        for element in &class.body.body {
            match element {
                // static properties = { ... };
                ClassElement::PropertyDefinition(prop)
                    if prop.r#static && prop.key.is_specific_static_name("properties") =>
                {
                    if let Some(Expression::ObjectExpression(obj)) = &prop.value {
                        properties.extend(Self::parse_properties_object(obj, source_text));
                    }
                }
                // static get properties() { return { ... }; }
                ClassElement::MethodDefinition(method)
                    if method.r#static
                        && method.kind == MethodDefinitionKind::Get
                        && method.key.is_specific_static_name("properties") =>
                {
                    if let Some(body) = &method.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt
                                && let Some(Expression::ObjectExpression(obj)) = &ret.argument
                            {
                                properties.extend(Self::parse_properties_object(obj, source_text));
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        properties
    }

    pub fn extract_from_post_class_assignment<'a>(
        program: &'a Program<'a>,
        class_name: &str,
        source_text: Option<&'a str>,
    ) -> Vec<PropertyInfo> {
        let mut properties = Vec::new();

        for stmt in &program.body {
            if let Statement::ExpressionStatement(expr_stmt) = stmt
                && let Expression::AssignmentExpression(assign) = &expr_stmt.expression
                && let AssignmentTarget::StaticMemberExpression(mem) = &assign.left
                && mem.property.name == "properties"
                && let Expression::Identifier(target_id) = &mem.object
                && target_id.name == class_name
                && let Expression::ObjectExpression(obj) = &assign.right
            {
                properties.extend(Self::parse_properties_object(obj, source_text));
            }
        }

        properties
    }

    fn parse_properties_object<'a>(
        obj: &'a ObjectExpression<'a>,
        source_text: Option<&'a str>,
    ) -> Vec<PropertyInfo> {
        let mut properties = Vec::new();

        for prop in &obj.properties {
            if let ObjectPropertyKind::ObjectProperty(p) = prop
                && let Some(prop_name) = p.key.static_name()
            {
                let mut prop_type = PropertyType::Unknown;
                let mut reflect = false;
                let mut attribute = Some(Self::to_kebab_case(&prop_name));
                let mut is_state = false;
                let mut no_accessor = false;
                let mut has_changed = None;

                match &p.value {
                    Expression::ObjectExpression(opts) => {
                        for opt in &opts.properties {
                            if let ObjectPropertyKind::ObjectProperty(opt_prop) = opt
                                && let Some(opt_key) = opt_prop.key.static_name()
                            {
                                match opt_key.as_ref() {
                                    "type" => {
                                        if let Expression::Identifier(t_id) = &opt_prop.value {
                                            prop_type =
                                                PropertyType::from_str_name(t_id.name.as_str());
                                        }
                                    }
                                    "reflect" => {
                                        reflect = Self::evaluate_boolean(&opt_prop.value)
                                            .unwrap_or(false);
                                    }
                                    "attribute" => {
                                        attribute = match &opt_prop.value {
                                            Expression::StringLiteral(s) => {
                                                Some(s.value.to_string())
                                            }
                                            other => {
                                                if let Some(b) = Self::evaluate_boolean(other) {
                                                    if !b {
                                                        None
                                                    } else {
                                                        Some(Self::to_kebab_case(&prop_name))
                                                    }
                                                } else {
                                                    None
                                                }
                                            }
                                        };
                                    }
                                    "hasChanged" => {
                                        has_changed =
                                            Self::extract_has_changed(opt_prop, source_text);
                                    }
                                    "state" => {
                                        is_state = Self::evaluate_boolean(&opt_prop.value)
                                            .unwrap_or(false);
                                    }
                                    "noAccessor" => {
                                        no_accessor = Self::evaluate_boolean(&opt_prop.value)
                                            .unwrap_or(false);
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                    Expression::Identifier(type_id) => {
                        prop_type = PropertyType::from_str_name(type_id.name.as_str());
                    }
                    _ => {}
                }

                if is_state {
                    attribute = None;
                    reflect = false;
                }

                properties.push(PropertyInfo {
                    name: prop_name.to_string(),
                    property_type: prop_type,
                    attribute,
                    reflect,
                    has_changed,
                    no_accessor,
                    is_state,
                    default_value: None,
                });
            }
        }

        properties
    }

    pub fn extract_has_changed<'a>(
        prop: &'a ObjectProperty<'a>,
        source_text: Option<&'a str>,
    ) -> Option<String> {
        if let Some(src) = source_text {
            let span = if prop.method {
                prop.span
            } else {
                prop.value.span()
            };
            let start = span.start as usize;
            let end = span.end as usize;
            if start <= end && end <= src.len() {
                let slice = src[start..end].trim();
                if !slice.is_empty() {
                    return Some(slice.to_string());
                }
            }
        }
        match &prop.value {
            Expression::Identifier(id) => Some(id.name.to_string()),
            Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_) => {
                Some("<function>".to_string())
            }
            _ => None,
        }
    }

    fn extract_default_values<'a>(class: &'a Class<'a>, properties: &mut [PropertyInfo]) {
        let mut defaults_by_name: HashMap<String, String> = HashMap::new();

        // 1. From class field initializers
        for element in &class.body.body {
            if let ClassElement::PropertyDefinition(prop) = element
                && !prop.r#static
                && let Some(prop_name) = prop.key.static_name()
                && let Some(val) = &prop.value
                && let Some(lit_val) = Self::expression_to_literal_string(val)
            {
                defaults_by_name.insert(prop_name.to_string(), lit_val);
            }
        }

        // 2. From constructor assignments: this.propName = value;
        for element in &class.body.body {
            if let ClassElement::MethodDefinition(method) = element
                && method.kind == MethodDefinitionKind::Constructor
                && let Some(body) = &method.value.body
            {
                for stmt in &body.statements {
                    if let Statement::ExpressionStatement(expr_stmt) = stmt
                        && let Expression::AssignmentExpression(assign) = &expr_stmt.expression
                        && let AssignmentTarget::StaticMemberExpression(mem) = &assign.left
                        && let Expression::ThisExpression(_) = &mem.object
                    {
                        let prop_name = mem.property.name.as_str();
                        if let Some(val_str) = Self::expression_to_literal_string(&assign.right) {
                            defaults_by_name
                                .entry(prop_name.to_string())
                                .or_insert(val_str);
                        }
                    }
                }
            }
        }

        for p in properties.iter_mut() {
            if let Some(def) = defaults_by_name.get(&p.name) {
                p.default_value = Some(def.clone());
            }
        }
    }

    fn expression_to_literal_string<'a>(expr: &'a Expression<'a>) -> Option<String> {
        match expr {
            Expression::StringLiteral(s) => Some(format!("\"{}\"", s.value)),
            Expression::NumericLiteral(n) => Some(n.value.to_string()),
            Expression::BooleanLiteral(b) => Some(b.value.to_string()),
            Expression::NullLiteral(_) => Some("null".to_string()),
            Expression::Identifier(id) if id.name == "undefined" => Some("undefined".to_string()),
            Expression::UnaryExpression(u) => {
                if let Some(b) = Self::evaluate_boolean(expr) {
                    Some(b.to_string())
                } else if u.operator == UnaryOperator::UnaryNegation {
                    if let Expression::NumericLiteral(n) = &u.argument {
                        Some(format!("-{}", n.value))
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    pub fn is_truthy<'a>(expr: &'a Expression<'a>) -> Option<bool> {
        match expr {
            Expression::BooleanLiteral(b) => Some(b.value),
            Expression::NumericLiteral(n) => Some(n.value != 0.0),
            Expression::StringLiteral(s) => Some(!s.value.is_empty()),
            Expression::NullLiteral(_) => Some(false),
            Expression::Identifier(id) if id.name == "undefined" => Some(false),
            Expression::UnaryExpression(u) => match u.operator {
                UnaryOperator::LogicalNot => Self::is_truthy(&u.argument).map(|b| !b),
                UnaryOperator::Void => Some(false),
                UnaryOperator::UnaryNegation | UnaryOperator::UnaryPlus => {
                    if let Expression::NumericLiteral(n) = &u.argument {
                        Some(n.value != 0.0)
                    } else {
                        None
                    }
                }
                _ => None,
            },
            Expression::ParenthesizedExpression(p) => Self::is_truthy(&p.expression),
            _ => None,
        }
    }

    pub fn evaluate_boolean<'a>(expr: &'a Expression<'a>) -> Option<bool> {
        match expr {
            Expression::BooleanLiteral(b) => Some(b.value),
            Expression::UnaryExpression(u) if u.operator == UnaryOperator::LogicalNot => {
                Self::is_truthy(&u.argument).map(|b| !b)
            }
            Expression::ParenthesizedExpression(p) => Self::evaluate_boolean(&p.expression),
            _ => None,
        }
    }
}
