use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::loader_ast::build_loader_program;

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct ResumableLoaderOptions {
    pub manifest: Option<HashMap<String, String>>,
    pub preload_on_hover: Option<bool>,
    pub idle_hydration: Option<bool>,
    pub idle_timeout: Option<u32>,
    pub events: Option<Vec<String>>,
}

#[napi]
pub fn compile_resumable_loader(options: Option<ResumableLoaderOptions>) -> String {
    let opts = options.unwrap_or_default();
    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);

    let manifest_map = opts.manifest.clone().unwrap_or_default();
    let preload_on_hover = opts.preload_on_hover.unwrap_or(true);
    let idle_hydration = opts.idle_hydration.unwrap_or(false);
    let idle_timeout = opts.idle_timeout.unwrap_or(2000);

    let mut events_list = opts.events.clone().unwrap_or_else(|| {
        vec![
            "click".to_string(),
            "input".to_string(),
            "change".to_string(),
            "keydown".to_string(),
            "submit".to_string(),
            "pointerdown".to_string(),
            "focusin".to_string(),
        ]
    });

    if preload_on_hover && !events_list.contains(&"pointerover".to_string()) {
        events_list.push("pointerover".to_string());
    }

    let program = build_loader_program(
        &ast,
        &opts,
        &manifest_map,
        &events_list,
        idle_hydration,
        idle_timeout,
    );

    let codegen_options = CodegenOptions {
        minify: true,
        ..Default::default()
    };
    let codegen_result = Codegen::new().with_options(codegen_options).build(&program);
    codegen_result.code
}
