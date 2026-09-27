use crate::models::{ClassificationResult, TransformOptions};

pub fn transform_micro(source: &str, target: &ClassificationResult, _options: &TransformOptions) -> String {
    let comp_id = &target.component_name;
    let mut rewritten = source.to_string();

    // 1. Replace LitElement import with NativeElement from @lit-core/native/runtime
    let has_runtime_import = rewritten.contains("@lit-core/native/runtime");
    if !has_runtime_import {
        let import_statement = if source.contains("repeat(") || source.contains(".map(") {
            "import { NativeElement } from '@lit-core/native/runtime';\nimport { reconcile } from '@lit-core/native/runtime/reconciler';\n"
        } else {
            "import { NativeElement } from '@lit-core/native/runtime';\n"
        };
        rewritten.insert_str(0, import_statement);
    }

    // 2. Replace extends LitElement or extends ReactiveElement with extends NativeElement
    rewritten = rewritten
        .replace("extends LitElement", "extends NativeElement")
        .replace("extends ReactiveElement", "extends NativeElement");

    // 3. Strip @customElement, @property, @state
    rewritten = strip_decorator(&rewritten, "customElement");
    rewritten = strip_decorator(&rewritten, "property");
    rewritten = strip_decorator(&rewritten, "state");

    // 4. Inject DOM path resolution stub and micro-scheduler bridge
    let class_decl_pattern = format!("class {}", comp_id);
    if let Some(pos) = rewritten.find(&class_decl_pattern) {
        if let Some(open_brace) = rewritten[pos..].find('{') {
            let insert_pos = pos + open_brace + 1;
            let bridge_code = "\n  __cache = new Map();\n  __nodes = [];\n";
            rewritten.insert_str(insert_pos, bridge_code);
        }
    }

    if let Some(tag) = &target.tag_name {
        let define_call = format!("customElements.define('{}', {});\n", tag, comp_id);
        if !rewritten.contains(&format!("customElements.define('{}'", tag)) && !rewritten.contains(&format!("customElements.define(\"{}\"", tag)) {
            rewritten.push('\n');
            rewritten.push_str(&define_call);
        }
    }

    rewritten
}

fn strip_decorator(s: &str, dec_name: &str) -> String {
    let mut res = s.to_string();
    let pattern = format!("@{}", dec_name);
    while let Some(pos) = res.find(&pattern) {
        let after = &res[pos + pattern.len()..];
        let trimmed_after = after.trim_start();
        if trimmed_after.starts_with('(') {
            let offset = pos + pattern.len() + (after.len() - trimmed_after.len());
            let bytes = res.as_bytes();
            let mut depth = 1;
            let mut end = offset + 1;
            while end < bytes.len() && depth > 0 {
                if bytes[end] == b'(' { depth += 1; }
                else if bytes[end] == b')' { depth -= 1; }
                end += 1;
            }
            while end < bytes.len() && (bytes[end] == b' ' || bytes[end] == b'\t' || bytes[end] == b'\n' || bytes[end] == b'\r') {
                end += 1;
            }
            res.replace_range(pos..end, "");
        } else {
            res.replace_range(pos..pos + pattern.len(), "");
        }
    }
    res
}
