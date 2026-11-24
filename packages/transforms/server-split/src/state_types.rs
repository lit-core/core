//! Finds reactive property types that cannot cross the JSON state wire.
//!
//! Element state is signed and echoed back by the browser as JSON, so a `Map`, `Set`, `Date`, function,
//! `symbol` or `bigint` would come back as something different from what the server held. The runtime
//! refuses such state when it signs it; this reports the same mistake at build time, where the
//! property is written, for the properties that carry a type annotation.

use std::collections::HashSet;

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_parser::Parser;
use oxc_span::SourceType;

use crate::diagnostics::{DiagnosticCode, error_diagnostic};
use crate::options::ServerSplitDiagnostic;
use crate::symbol::ServerSymbolContext;

/// Built-in types whose instances JSON does not round-trip.
const NON_JSON_GLOBALS: &[&str] = &[
    "Date",
    "Function",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "RegExp",
    "Promise",
    "ArrayBuffer",
    "Uint8Array",
    "Int32Array",
    "Float64Array",
];

fn reference_name<'a>(name: &'a TSTypeName<'a>) -> Option<&'a str> {
    match name {
        TSTypeName::IdentifierReference(id) => Some(id.name.as_str()),
        _ => None,
    }
}

/// The first non-JSON type found in `ty`, including inside arrays, unions, generics and object types.
pub fn non_json_type_name(ty: &TSType) -> Option<String> {
    match ty {
        TSType::TSFunctionType(_) => Some("function".to_string()),
        TSType::TSSymbolKeyword(_) => Some("symbol".to_string()),
        TSType::TSBigIntKeyword(_) => Some("bigint".to_string()),
        TSType::TSArrayType(array) => non_json_type_name(&array.element_type),
        TSType::TSParenthesizedType(inner) => non_json_type_name(&inner.type_annotation),
        TSType::TSUnionType(union) => union.types.iter().find_map(non_json_type_name),
        TSType::TSIntersectionType(intersection) => {
            intersection.types.iter().find_map(non_json_type_name)
        }
        TSType::TSTypeLiteral(literal) => literal.members.iter().find_map(|member| match member {
            TSSignature::TSPropertySignature(property) => property
                .type_annotation
                .as_ref()
                .and_then(|annotation| non_json_type_name(&annotation.type_annotation)),
            _ => None,
        }),
        TSType::TSTupleType(tuple) => tuple
            .element_types
            .iter()
            .find_map(|element| element.as_ts_type().and_then(non_json_type_name)),
        TSType::TSTypeReference(reference) => {
            let name = reference_name(&reference.type_name)?;
            if NON_JSON_GLOBALS.contains(&name) {
                return Some(name.to_string());
            }
            reference
                .type_arguments
                .as_ref()
                .and_then(|args| args.params.iter().find_map(non_json_type_name))
        }
        _ => None,
    }
}

fn key_name<'a>(key: &'a PropertyKey<'a>) -> Option<&'a str> {
    match key {
        PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
        PropertyKey::StringLiteral(s) => Some(s.value.as_str()),
        _ => None,
    }
}

/// Names a class declares as reactive: fields carrying a decorator, and the keys of `static properties`.
pub fn reactive_field_names(class: &Class) -> HashSet<String> {
    let mut names = HashSet::new();
    for element in &class.body.body {
        let ClassElement::PropertyDefinition(property) = element else {
            continue;
        };
        if property.r#static {
            if key_name(&property.key) == Some("properties")
                && let Some(Expression::ObjectExpression(object)) = property.value.as_ref()
            {
                for entry in &object.properties {
                    if let ObjectPropertyKind::ObjectProperty(entry) = entry
                        && let Some(name) = key_name(&entry.key)
                    {
                        names.insert(name.to_string());
                    }
                }
            }
        } else if !property.decorators.is_empty()
            && let Some(name) = key_name(&property.key)
        {
            names.insert(name.to_string());
        }
    }
    names
}

/// One SE109 per reactive field of `class` whose annotation is a type JSON cannot carry.
pub fn diagnose_class(
    class: &Class,
    class_name: &str,
    reactive: &HashSet<String>,
) -> Vec<ServerSplitDiagnostic> {
    let mut found = Vec::new();
    for element in &class.body.body {
        let ClassElement::PropertyDefinition(property) = element else {
            continue;
        };
        let Some(name) = key_name(&property.key) else {
            continue;
        };
        if !reactive.contains(name) {
            continue;
        }
        let Some(annotation) = property.type_annotation.as_ref() else {
            continue;
        };
        if let Some(kind) = non_json_type_name(&annotation.type_annotation) {
            found.push(error_diagnostic(
                DiagnosticCode::SE109,
                format!(
                    "Reactive property '{}' in class '{}' is typed as {}, which does not survive the JSON state wire. Store plain data instead: an array of entries for a Map or Set, and an ISO string for a Date.",
                    name, class_name, kind
                ),
                property.span,
            ));
        }
    }
    found
}

/// Runs the SE109 check over every server element class in `source`.
///
/// Decorator lowering removes field type annotations, so this has to see the author's original source,
/// before any lowering. The splitter runs the same check for sources it receives with annotations intact.
pub fn check_source(source: &str, filename: &str) -> Vec<ServerSplitDiagnostic> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());
    let parsed = Parser::new(&allocator, source, source_type).parse();
    let program = parsed.program;
    let semantic = oxc_semantic::SemanticBuilder::new().build(&program);
    let scoping = semantic.semantic.into_scoping();
    let server_ctx = ServerSymbolContext::scan(&program, &scoping);

    let mut diagnostics = Vec::new();
    for statement in &program.body {
        let class = match statement {
            Statement::ClassDeclaration(class) => Some(class.as_ref()),
            Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                ExportDefaultDeclarationKind::ClassDeclaration(class) => Some(class.as_ref()),
                _ => None,
            },
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::ClassDeclaration(class) => Some(class.as_ref()),
                _ => None,
            },
            _ => None,
        };
        let Some(class) = class else { continue };
        if server_ctx.extract_server_methods(class).is_empty() {
            continue;
        }
        let name = class
            .id
            .as_ref()
            .map(|id| id.name.as_str())
            .unwrap_or("Component");
        diagnostics.extend(diagnose_class(class, name, &reactive_field_names(class)));
    }
    diagnostics
}
