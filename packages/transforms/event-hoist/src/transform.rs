use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub use crate::analyzer::{SAFE_BUBBLING_EVENTS, collect_classes_mut, match_event_attr};
pub use crate::builder::{
    build_add_listener_statement, build_call_init_event_hoist, build_connected_callback_method,
    build_first_updated_method, build_init_lit_event_hoist_method, build_lh_action_method,
    build_lh_actions_property, build_lh_dispatch_method, build_lh_initialized_property,
    build_reset_lh_actions, build_will_update_method,
};
pub use crate::hoister::{
    HoistContext, has_event_options, hoist_events_in_expr, hoist_events_in_stmt,
};
use lit_analysis::symbol::SymbolProofContext;

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct EventHoistOptions {
    pub events: Option<Vec<String>>,
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EventHoistResult {
    pub code: String,
    pub map: Option<String>,
    pub hoisted_events_count: u32,
    pub events: Vec<String>,
    pub components_count: u32,
}

pub fn transform_code(source: &str, options: EventHoistOptions) -> EventHoistResult {
    let safe_event_set: HashSet<String> = if let Some(custom_events) = options.events {
        custom_events.into_iter().collect()
    } else {
        SAFE_BUBBLING_EVENTS.iter().map(|s| s.to_string()).collect()
    };

    let allocator = Allocator::default();
    let filename = options.filename.as_deref().unwrap_or("file.ts");
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());

    let mut parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return EventHoistResult {
            code: source.to_string(),
            map: None,
            hoisted_events_count: 0,
            events: Vec::new(),
            components_count: 0,
        };
    }

    let semantic_ret = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic_ret.semantic.into_scoping();
    let symbol_ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);

    let mut classes = Vec::new();
    collect_classes_mut(&mut parsed.program.body, &mut classes);

    if classes.is_empty() {
        return EventHoistResult {
            code: source.to_string(),
            map: None,
            hoisted_events_count: 0,
            events: Vec::new(),
            components_count: 0,
        };
    }

    let mut transformed_components_count = 0u32;
    let mut total_hoisted_events_count = 0u32;
    let mut all_unique_events = HashSet::new();

    for class in classes {
        if !symbol_ctx.prove_heritage(class).is_reactive() {
            continue;
        }

        let mut class_hoisted_events = HashSet::new();
        let mut class_hoisted_count = 0u32;

        let mut has_connected = false;

        for elem in class.body.body.iter_mut() {
            if let ClassElement::MethodDefinition(method) = elem {
                let method_name = match &method.key {
                    PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                    _ => None,
                };

                if let Some(ref mut body) = method.value.body {
                    if method_name == Some("render") {
                        let mut ctx = HoistContext {
                            safe_events: &safe_event_set,
                            allocator: &allocator,
                            symbol_ctx: &symbol_ctx,
                            hoisted_events: &mut class_hoisted_events,
                            hoisted_count: &mut class_hoisted_count,
                        };
                        for stmt in &mut body.statements {
                            hoist_events_in_stmt(stmt, &mut ctx);
                        }
                    } else if method_name == Some("connectedCallback") {
                        has_connected = true;
                    }
                }
            }
        }

        if class_hoisted_count == 0 {
            continue;
        }

        transformed_components_count += 1;
        total_hoisted_events_count += class_hoisted_count;
        for evt in &class_hoisted_events {
            all_unique_events.insert(evt.clone());
        }

        let ast = AstBuilder::new(&allocator);

        // Prepend resets and hook calls to existing methods
        for elem in class.body.body.iter_mut() {
            if let ClassElement::MethodDefinition(method) = elem {
                let method_name = match &method.key {
                    PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                    _ => None,
                };

                if let Some(ref mut body) = method.value.body {
                    if method_name == Some("render") {
                        body.statements.insert(0, build_reset_lh_actions(&ast));
                    } else if method_name == Some("connectedCallback")
                        || method_name == Some("firstUpdated")
                    {
                        body.statements.insert(0, build_call_init_event_hoist(&ast));
                    }
                }
            }
        }

        // Synthesize missing lifecycle methods
        if !has_connected {
            class.body.body.push(build_connected_callback_method(&ast));
        }

        let mut sorted_class_events: Vec<String> = class_hoisted_events.into_iter().collect();
        sorted_class_events.sort();

        class.body.body.push(build_init_lit_event_hoist_method(
            &ast,
            &sorted_class_events,
        ));
        class.body.body.push(build_lh_dispatch_method(&ast));
        class.body.body.push(build_lh_action_method(&ast));
    }

    if transformed_components_count == 0 {
        return EventHoistResult {
            code: source.to_string(),
            map: None,
            hoisted_events_count: 0,
            events: Vec::new(),
            components_count: 0,
        };
    }

    let mut codegen_options = CodegenOptions::default();
    if options.sourcemap.unwrap_or(false)
        && let Some(ref filename) = options.filename
    {
        codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
    }

    let codegen_result = Codegen::new()
        .with_options(codegen_options)
        .build(&parsed.program);
    let map_json = codegen_result.map.map(|m| m.to_json_string());

    let mut sorted_events: Vec<String> = all_unique_events.into_iter().collect();
    sorted_events.sort();

    EventHoistResult {
        code: codegen_result.code,
        map: map_json,
        hoisted_events_count: total_hoisted_events_count,
        events: sorted_events,
        components_count: transformed_components_count,
    }
}
