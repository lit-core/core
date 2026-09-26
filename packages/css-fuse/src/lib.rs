#![deny(clippy::all)]

pub mod cluster;
pub mod codegen;
pub mod diagnostics;
pub mod extractor;
pub mod models;
pub mod normalizer;
pub mod scoping;

use glob::glob;
use napi_derive::napi;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

use crate::cluster::{ClusterEngine, FrequencyIndex};
use crate::codegen::{generate_fused_sheet, rewrite_file};
use crate::extractor::StyleExtractor;
use crate::models::{Diagnostic, FuseConfig, FuseResult, FuseStats, NormalizedRule};
use crate::normalizer::normalize_css;
use crate::scoping::ScopingAuditor;

fn resolve_input_files(config: &FuseConfig) -> Vec<String> {
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

pub fn run_fuse_pipeline(config: &FuseConfig, dry_run: bool) -> FuseResult {
    let files = resolve_input_files(config);
    let threshold = config.threshold.unwrap_or(2) as usize;
    let output_dir = config.output_dir.as_deref().unwrap_or(".fused");
    let virtual_imports = config.virtual_imports.unwrap_or(false);

    // Step 1: Extract styles from all source files
    let extracted_styles = StyleExtractor::extract_from_files(&files);

    // Step 2: Scoping and Contract Audits
    let diagnostics = ScopingAuditor::audit_all(&extracted_styles);

    // Step 3: Normalize all extracted rules
    let mut all_normalized_rules: Vec<NormalizedRule> = Vec::new();
    for style in &extracted_styles {
        let rules = normalize_css(style);
        all_normalized_rules.extend(rules);
    }

    // Step 4: Index and Cluster
    let mut frequency_index = FrequencyIndex::new();
    frequency_index.index_rules(&all_normalized_rules);

    let clusters = ClusterEngine::cluster(&frequency_index, threshold);

    // Step 5: Generate fused sheets
    let mut fused_sheets = Vec::new();
    for cluster in &clusters {
        let sheet_info = generate_fused_sheet(cluster);
        fused_sheets.push(sheet_info);
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
            &extracted_styles,
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

        for sheet in &fused_sheets {
            let file_dest = out_path.join(&sheet.file_name);
            let _ = fs::write(file_dest, &sheet.code);
        }

        for rewritten in &rewritten_files {
            let _ = fs::write(&rewritten.file_path, &rewritten.transformed_code);
        }
    }

    // Step 8: Calculate stats
    let total_rules = all_normalized_rules.len() as u32;
    let unique_rules = frequency_index.rule_map.len() as u32;
    let mut rules_deduped = 0;
    for cluster in &clusters {
        let multiplier = cluster.shared_by_files.len().saturating_sub(1);
        rules_deduped += (cluster.rules.len() * multiplier) as u32;
    }

    let bytes_saved = rules_deduped * 35; // rough estimate of bytes saved per deduped rule

    let stats = FuseStats {
        files_scanned: files.len() as u32,
        styles_extracted: extracted_styles.len() as u32,
        total_rules,
        unique_rules,
        rules_deduped,
        fused_sheets_created: fused_sheets.len() as u32,
        components_rewritten: components_rewritten_set.len() as u32,
        bytes_saved,
    };

    FuseResult {
        fused_sheets,
        rewritten_files,
        diagnostics,
        stats,
    }
}

#[napi]
pub fn fuse(config: Option<FuseConfig>) -> FuseResult {
    let cfg = config.unwrap_or_default();
    run_fuse_pipeline(&cfg, false)
}

#[napi]
pub fn analyze(config: Option<FuseConfig>) -> FuseResult {
    let mut cfg = config.unwrap_or_default();
    cfg.write = Some(false);
    run_fuse_pipeline(&cfg, true)
}

#[napi]
pub fn audit_scoping(config: Option<FuseConfig>) -> Vec<Diagnostic> {
    let cfg = config.unwrap_or_default();
    let files = resolve_input_files(&cfg);
    let extracted_styles = StyleExtractor::extract_from_files(&files);
    ScopingAuditor::audit_all(&extracted_styles)
}
