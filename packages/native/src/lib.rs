pub mod classifier;
pub mod micro;
pub mod models;
pub mod vanilla;

use napi_derive::napi;
use crate::models::{ClassificationResult, ClassifyOptions, TransformOptions, TransformResult};

#[napi]
pub fn classify(source: String, options: Option<ClassifyOptions>) -> Vec<ClassificationResult> {
    classifier::classify_code(&source, options.unwrap_or_default())
}

#[napi]
pub fn transform_native(source: String, options: Option<TransformOptions>) -> TransformResult {
    let opts = options.unwrap_or_default();
    let classifications = classifier::classify_code(&source, ClassifyOptions {
        mode: opts.mode.clone(),
        filename: opts.filename.clone(),
    });

    let mut vanilla_count = 0u32;
    let mut micro_count = 0u32;
    let mut code = source.clone();
    let map = None;

    for target in &classifications {
        match target.mode.as_str() {
            "vanilla" => {
                code = vanilla::transform_vanilla(&code, target, &opts);
                vanilla_count += 1;
            }
            "micro" => {
                code = micro::transform_micro(&code, target, &opts);
                micro_count += 1;
            }
            _ => {}
        }
    }

    TransformResult {
        code,
        map,
        vanilla_count,
        micro_count,
        classifications,
    }
}
