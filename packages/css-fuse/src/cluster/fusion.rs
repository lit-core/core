use crate::cluster::frequency::FrequencyIndex;
use crate::models::{ClusterGroup, NormalizedRule, RuleHash, SourceSpan};
use crate::normalizer::hasher::{compute_cluster_hash, compute_rule_hash};
use std::collections::{BTreeSet, HashMap};

pub struct ClusterEngine;

impl ClusterEngine {
    pub fn cluster(frequency_index: &FrequencyIndex, threshold: usize) -> Vec<ClusterGroup> {
        Self::cluster_with_min_savings(frequency_index, threshold, 0)
    }

    pub fn cluster_with_min_savings(
        frequency_index: &FrequencyIndex,
        threshold: usize,
        min_savings: usize,
    ) -> Vec<ClusterGroup> {
        // Map: sharing profile (sorted files) -> Vec<NormalizedRule>
        let mut profile_to_rules: HashMap<Vec<String>, Vec<NormalizedRule>> = HashMap::new();

        // 1. Group declarations by (sorted_files, at_rule, selector)
        let mut profile_selector_decls: HashMap<
            (Vec<String>, Option<String>, String),
            BTreeSet<String>,
        > = HashMap::new();

        for ((at_rule, selector, decl), files) in &frequency_index.decl_occurrences {
            if files.len() >= threshold {
                let mut sorted_files: Vec<String> = files.iter().cloned().collect();
                sorted_files.sort();
                let key = (sorted_files, at_rule.clone(), selector.clone());
                profile_selector_decls
                    .entry(key)
                    .or_default()
                    .insert(decl.clone());
            }
        }

        for ((sorted_files, at_rule, selector), decls) in profile_selector_decls {
            let decl_vec: Vec<String> = decls.into_iter().collect();
            let canonical_body = decl_vec.join(";");
            let full_css = if let Some(at) = &at_rule {
                format!("{} {{\n  {} {{{}}}\n}}", at, selector, canonical_body)
            } else {
                format!("{} {{{}}}", selector, canonical_body)
            };

            let hash_key = if let Some(at) = &at_rule {
                format!("{}|{}", at, selector)
            } else {
                selector.clone()
            };
            let hash = compute_rule_hash(&hash_key, &canonical_body);

            let rule = NormalizedRule {
                at_rule,
                selector,
                declarations: decl_vec,
                canonical_body,
                full_canonical_css: full_css,
                hash,
                source_file: String::new(),
                span: SourceSpan {
                    start: 0,
                    end: 0,
                    line: 0,
                    column: 0,
                },
                is_keyframes_or_media: false,
            };

            profile_to_rules.entry(sorted_files).or_default().push(rule);
        }

        // 2. Add whole rules (e.g. @keyframes)
        for (rule, files) in frequency_index.whole_rules.values() {
            if files.len() >= threshold {
                let mut sorted_files: Vec<String> = files.iter().cloned().collect();
                sorted_files.sort();
                profile_to_rules
                    .entry(sorted_files)
                    .or_default()
                    .push(rule.clone());
            }
        }

        let mut clusters = Vec::new();

        for (files, mut rules) in profile_to_rules {
            // Sort rules deterministically by (at_rule, selector)
            rules.sort_by(|a, b| {
                let at_cmp = a.at_rule.cmp(&b.at_rule);
                if at_cmp != std::cmp::Ordering::Equal {
                    return at_cmp;
                }
                a.selector.cmp(&b.selector)
            });

            let total_css_len: usize = rules.iter().map(|r| r.full_canonical_css.len()).sum();
            let net_bytes_saved = (files.len().saturating_sub(1)) * total_css_len;
            if net_bytes_saved < min_savings || net_bytes_saved == 0 {
                continue;
            }

            let rule_hashes: Vec<RuleHash> = rules.iter().map(|r| r.hash.clone()).collect();
            let cluster_id = format!("_fused_{}", compute_cluster_hash(&rule_hashes));

            clusters.push(ClusterGroup {
                id: cluster_id.clone(),
                fused_sheet_name: format!("{}.js", cluster_id),
                rules,
                shared_by_files: files,
            });
        }

        // Sort clusters deterministically by ID
        clusters.sort_by(|a, b| a.id.cmp(&b.id));

        clusters
    }
}
