#![deny(clippy::all)]

pub mod cluster;
pub mod codegen;
pub mod diagnostics;
pub mod extractor;
pub mod models;
pub mod normalizer;

use glob::glob;
use napi_derive::napi;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

use crate::cluster::{FragmentFrequencyIndex, HtmlClusterEngine};
use crate::codegen::{generate_fused_template, rewrite_file};
use crate::diagnostics::TemplateAuditor;
use crate::extractor::TemplateExtractor;
use crate::models::{Diagnostic, HtmlFuseConfig, HtmlFuseResult, HtmlFuseStats};

fn resolve_input_files(config: &HtmlFuseConfig) -> Vec<String> {
    if let Some(explicit_files) = &config.files {
        let mut files = explicit_files.clone();
        files.sort();
        return files;
    }

    let default_includes = vec![
        "packages/components/**/src/**/*.ts".to_string(),
        "src/**/*.ts".to_string(),
    ];
    let includes = config.include.as_ref().unwrap_or(&default_includes);
    let mut default_excludes = vec![
        "**/*.test.ts".to_string(),
        "**/*.spec.ts".to_string(),
        "**/*.test.js".to_string(),
        "**/*.spec.js".to_string(),
    ];
    let any_targets_node_modules = includes.iter().any(|p| p.contains("node_modules"));
    if !any_targets_node_modules {
        default_excludes.push("**/node_modules/**".to_string());
    }
    let any_targets_dist = includes
        .iter()
        .any(|p| p.contains("/dist/") || p.contains("dist/**"));
    if !any_targets_dist {
        default_excludes.push("**/dist/**".to_string());
    }
    let excludes = config.exclude.as_ref().unwrap_or(&default_excludes);

    let mut matched_files: HashSet<String> = HashSet::new();

    for pattern in includes {
        if let Ok(entries) = glob(pattern) {
            for entry in entries.flatten() {
                let path_str = entry.to_string_lossy().to_string();

                let is_excluded = excludes.iter().any(|exc| {
                    if let Ok(pat) = glob::Pattern::new(exc) {
                        pat.matches(&path_str)
                    } else {
                        path_str.contains(exc)
                    }
                });

                if !is_excluded && entry.is_file() {
                    matched_files.insert(path_str);
                }
            }
        }
    }

    let mut files: Vec<String> = matched_files.into_iter().collect();
    files.sort();
    files
}

pub fn run_html_fuse_pipeline(config: &HtmlFuseConfig, dry_run: bool) -> HtmlFuseResult {
    let files = resolve_input_files(config);
    let threshold = config.threshold.unwrap_or(2) as usize;
    let min_fragment_length = config.min_fragment_length.unwrap_or(15) as usize;
    let min_savings = config.min_savings.unwrap_or(0) as usize;
    let output_dir = config.output_dir.as_deref().unwrap_or(".fused-html");
    let virtual_imports = config.virtual_imports.unwrap_or(true);

    // Step 1: Extract fragments from source files
    let (extracted_fragments, templates_scanned) =
        TemplateExtractor::extract_from_files(&files, min_fragment_length);

    // Step 2: Run audits & diagnostics
    let diagnostics = TemplateAuditor::audit_all(&extracted_fragments);

    // Step 3: Index fragment frequencies
    let mut frequency_index = FragmentFrequencyIndex::new();
    frequency_index.index_fragments(&extracted_fragments);

    // Step 4: Cluster fragments above threshold and min_savings
    let clusters = HtmlClusterEngine::cluster(&frequency_index, threshold, min_savings);

    // Step 5: Generate fused virtual modules
    let mut fused_templates = Vec::new();
    for cluster in &clusters {
        let template_info = generate_fused_template(cluster);
        fused_templates.push(template_info);
    }

    // Step 6: Rewrite component files
    let mut rewritten_files = Vec::new();
    let mut components_rewritten_set = HashSet::new();

    for file_path in &files {
        let Ok(code) = fs::read_to_string(file_path) else {
            continue;
        };

        if let Some(rewritten) = rewrite_file(
            file_path,
            &code,
            &extracted_fragments,
            &clusters,
            output_dir,
            virtual_imports,
        ) {
            components_rewritten_set.insert(file_path.clone());
            rewritten_files.push(rewritten);
        }
    }

    // Step 7: Write to disk if requested and not dry run
    let should_write = config.write.unwrap_or(false) && !dry_run;
    if should_write {
        let out_path = Path::new(output_dir);
        let _ = fs::create_dir_all(out_path);

        for template in &fused_templates {
            let file_dest = out_path.join(&template.file_name);
            let _ = fs::write(file_dest, &template.code);
        }

        for rewritten in &rewritten_files {
            let _ = fs::write(&rewritten.file_path, &rewritten.transformed_code);
        }
    }

    // Step 8: Calculate stats
    let total_fragments = extracted_fragments.len() as u32;
    let unique_fragments = frequency_index.fragments.len() as u32;
    let mut fragments_deduped = 0;
    let mut bytes_saved = 0;

    for cluster in &clusters {
        let multiplier = cluster.shared_by_files.len().saturating_sub(1);
        fragments_deduped += multiplier as u32;
        bytes_saved += (multiplier * cluster.canonical_text.len()) as u32;
    }

    let stats = HtmlFuseStats {
        files_scanned: files.len() as u32,
        templates_scanned,
        fragments_extracted: total_fragments,
        unique_fragments,
        fragments_deduped,
        fused_templates_created: fused_templates.len() as u32,
        components_rewritten: components_rewritten_set.len() as u32,
        bytes_saved,
    };

    HtmlFuseResult {
        fused_templates,
        rewritten_files,
        diagnostics,
        stats,
    }
}

#[napi]
pub fn fuse(config: Option<HtmlFuseConfig>) -> HtmlFuseResult {
    let cfg = config.unwrap_or_default();
    run_html_fuse_pipeline(&cfg, false)
}

#[napi]
pub fn analyze(config: Option<HtmlFuseConfig>) -> HtmlFuseResult {
    let mut cfg = config.unwrap_or_default();
    cfg.write = Some(false);
    run_html_fuse_pipeline(&cfg, true)
}

#[napi]
pub fn audit_templates(config: Option<HtmlFuseConfig>) -> Vec<Diagnostic> {
    let cfg = config.unwrap_or_default();
    let files = resolve_input_files(&cfg);
    let min_fragment_length = cfg.min_fragment_length.unwrap_or(15) as usize;
    let (extracted, _) = TemplateExtractor::extract_from_files(&files, min_fragment_length);
    TemplateAuditor::audit_all(&extracted)
}
