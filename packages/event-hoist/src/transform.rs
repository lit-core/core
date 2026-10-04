use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub use crate::analyzer::{
    collect_classes_mut, has_event_options, is_lit_html_tag, match_event_attr, SAFE_BUBBLING_EVENTS,
};
pub use crate::builder::{
    build_add_listener_statement, build_call_init_event_hoist, build_reset_lh_actions,
    LIFECYCLE_STUBS, STATIC_HELPERS,
};
pub use crate::hoister::{hoist_events_in_expr, hoist_events_in_stmt};

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
    // Fast check: must contain html and @
    if !source.contains("html") || !source.contains('@') {
        return EventHoistResult {
            code: source.to_string(),
            map: None,
            hoisted_events_count: 0,
            events: Vec::new(),
            components_count: 0,
        };
    }

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
        let mut class_hoisted_events = HashSet::new();
        let mut class_hoisted_count = 0u32;

        let mut has_connected = false;
        let mut has_first_updated = false;
        let mut has_will_update = false;

        for elem in class.body.body.iter_mut() {
            if let ClassElement::MethodDefinition(method) = elem {
                let method_name = match &method.key {
                    PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                    _ => None,
                };

                if let Some(ref mut body) = method.value.body {
                    if method_name == Some("render") {
                        for stmt in &mut body.statements {
                            hoist_events_in_stmt(
                                stmt,
                                source,
                                &safe_event_set,
                                &allocator,
                                source_type,
                                &mut class_hoisted_events,
                                &mut class_hoisted_count,
                            );
                        }
                    } else if method_name == Some("connectedCallback") {
                        has_connected = true;
                    } else if method_name == Some("firstUpdated") {
                        has_first_updated = true;
                    } else if method_name == Some("willUpdate") {
                        has_will_update = true;
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
                    if method_name == Some("render") || method_name == Some("willUpdate") {
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
        if !has_connected || !has_first_updated || !has_will_update {
            let p_stubs = Parser::new(&allocator, LIFECYCLE_STUBS, source_type).parse();
            if let Some(Statement::ClassDeclaration(mut d)) =
                p_stubs.program.body.into_iter().next()
            {
                let stubs = std::mem::replace(&mut d.body.body, ArenaVec::new_in(&ast));
                for elem in stubs {
                    let keep = if let ClassElement::MethodDefinition(ref method) = elem {
                        let name = match &method.key {
                            PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                            _ => None,
                        };
                        (!has_connected && name == Some("connectedCallback"))
                            || (!has_first_updated && name == Some("firstUpdated"))
                            || (!has_will_update && name == Some("willUpdate"))
                    } else {
                        false
                    };
                    if keep {
                        class.body.body.push(elem);
                    }
                }
            }
        }

        let mut sorted_class_events: Vec<String> = class_hoisted_events.into_iter().collect();
        sorted_class_events.sort();

        let p_helpers = Parser::new(&allocator, STATIC_HELPERS, source_type).parse();
        if let Some(Statement::ClassDeclaration(mut d_helpers)) =
            p_helpers.program.body.into_iter().next()
        {
            let helpers = std::mem::replace(&mut d_helpers.body.body, ArenaVec::new_in(&ast));
            for mut elem in helpers {
                if let ClassElement::MethodDefinition(ref mut method) = elem {
                    let name = match &method.key {
                        PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                        _ => None,
                    };
                    if name == Some("__initLitEventHoist") {
                        if let Some(ref mut body) = method.value.body {
                            for evt in &sorted_class_events {
                                body.statements
                                    .push(build_add_listener_statement(evt, &ast));
                            }
                        }
                    }
                }
                class.body.body.push(elem);
            }
        }
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
    if options.sourcemap.unwrap_or(false) {
        if let Some(ref filename) = options.filename {
            codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
        }
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
