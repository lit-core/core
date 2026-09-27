use crate::cluster::frequency::FrequencyIndex;
use crate::models::{ClusterGroup, NormalizedRule, RuleHash, SourceSpan};
use crate::normalizer::hasher::{compute_cluster_hash, compute_rule_hash};
use std::collections::{BTreeSet, HashMap, HashSet};

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

        // 2. Build candidate rules with their file associations
        struct CandidateRule {
            rule: NormalizedRule,
            files: BTreeSet<String>,
            namespace: Option<String>,
            topology: Option<String>,
        }

        let mut candidate_rules = Vec::new();

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

            let namespace = extract_selector_namespace(&selector);
            let topology = extract_declaration_topology(&decl_vec);

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

            let files_set: BTreeSet<String> = sorted_files.into_iter().collect();
            candidate_rules.push(CandidateRule {
                rule,
                files: files_set,
                namespace,
                topology,
            });
        }

        let mut clusters = Vec::new();
        let mut clustered_rule_indices = HashSet::new();

        // 3. Subsystem clustering by selector namespace
        // Map: namespace -> Vec<candidate_index>
        let mut namespace_groups: HashMap<String, Vec<usize>> = HashMap::new();
        for (idx, candidate) in candidate_rules.iter().enumerate() {
            if let Some(ns) = &candidate.namespace {
                if ns.len() >= 3 {
                    namespace_groups.entry(ns.clone()).or_default().push(idx);
                }
            }
        }

        let mut sorted_namespaces: Vec<String> = namespace_groups.keys().cloned().collect();
        sorted_namespaces.sort();

        for ns in sorted_namespaces {
            let indices = &namespace_groups[&ns];
            if indices.len() >= 2 {
                // Check if rules share a common core of files
                let mut common_files = candidate_rules[indices[0]].files.clone();
                let mut union_files = candidate_rules[indices[0]].files.clone();
                for &idx in &indices[1..] {
                    common_files = common_files
                        .intersection(&candidate_rules[idx].files)
                        .cloned()
                        .collect();
                    union_files = union_files
                        .union(&candidate_rules[idx].files)
                        .cloned()
                        .collect();
                }

                if common_files.len() >= threshold
                    || (common_files.len() >= 1 && union_files.len() >= threshold)
                {
                    let mut rules = Vec::new();
                    for &idx in indices {
                        rules.push(candidate_rules[idx].rule.clone());
                        clustered_rule_indices.insert(idx);
                    }

                    rules.sort_by(|a, b| {
                        let at_cmp = a.at_rule.cmp(&b.at_rule);
                        if at_cmp != std::cmp::Ordering::Equal {
                            return at_cmp;
                        }
                        a.selector.cmp(&b.selector)
                    });

                    let total_css_len: usize =
                        rules.iter().map(|r| r.full_canonical_css.len()).sum();
                    let net_bytes_saved = (union_files.len().saturating_sub(1)) * total_css_len;
                    if net_bytes_saved >= min_savings && net_bytes_saved > 0 {
                        let rule_hashes: Vec<RuleHash> =
                            rules.iter().map(|r| r.hash.clone()).collect();
                        let cluster_id =
                            format!("_fused_subsystem_{}", compute_cluster_hash(&rule_hashes));

                        clusters.push(ClusterGroup {
                            id: cluster_id.clone(),
                            fused_sheet_name: format!("{}.js", cluster_id),
                            rules,
                            shared_by_files: union_files.into_iter().collect(),
                        });
                    }
                }
            }
        }

        // 4. Subsystem clustering by declaration topology for remaining unclustered rules
        let mut topology_groups: HashMap<String, Vec<usize>> = HashMap::new();
        for (idx, candidate) in candidate_rules.iter().enumerate() {
            if clustered_rule_indices.contains(&idx) {
                continue;
            }
            if let Some(top) = &candidate.topology {
                topology_groups.entry(top.clone()).or_default().push(idx);
            }
        }

        let mut sorted_topologies: Vec<String> = topology_groups.keys().cloned().collect();
        sorted_topologies.sort();

        for top in sorted_topologies {
            let indices = &topology_groups[&top];
            if indices.len() >= 2 {
                let mut common_files = candidate_rules[indices[0]].files.clone();
                let mut union_files = candidate_rules[indices[0]].files.clone();
                for &idx in &indices[1..] {
                    common_files = common_files
                        .intersection(&candidate_rules[idx].files)
                        .cloned()
                        .collect();
                    union_files = union_files
                        .union(&candidate_rules[idx].files)
                        .cloned()
                        .collect();
                }

                if common_files.len() >= threshold
                    || (common_files.len() >= 1 && union_files.len() >= threshold)
                {
                    let mut rules = Vec::new();
                    for &idx in indices {
                        rules.push(candidate_rules[idx].rule.clone());
                        clustered_rule_indices.insert(idx);
                    }

                    rules.sort_by(|a, b| {
                        let at_cmp = a.at_rule.cmp(&b.at_rule);
                        if at_cmp != std::cmp::Ordering::Equal {
                            return at_cmp;
                        }
                        a.selector.cmp(&b.selector)
                    });

                    let total_css_len: usize =
                        rules.iter().map(|r| r.full_canonical_css.len()).sum();
                    let net_bytes_saved = (union_files.len().saturating_sub(1)) * total_css_len;
                    if net_bytes_saved >= min_savings && net_bytes_saved > 0 {
                        let rule_hashes: Vec<RuleHash> =
                            rules.iter().map(|r| r.hash.clone()).collect();
                        let cluster_id =
                            format!("_fused_subsystem_{}", compute_cluster_hash(&rule_hashes));

                        clusters.push(ClusterGroup {
                            id: cluster_id.clone(),
                            fused_sheet_name: format!("{}.js", cluster_id),
                            rules,
                            shared_by_files: union_files.into_iter().collect(),
                        });
                    }
                }
            }
        }

        // 5. Remaining rules clustered by exact file profile
        let mut profile_to_rules: HashMap<Vec<String>, Vec<NormalizedRule>> = HashMap::new();
        for (idx, candidate) in candidate_rules.into_iter().enumerate() {
            if !clustered_rule_indices.contains(&idx) {
                let sorted_files: Vec<String> = candidate.files.into_iter().collect();
                profile_to_rules
                    .entry(sorted_files)
                    .or_default()
                    .push(candidate.rule);
            }
        }

        // Add whole rules (e.g. @keyframes)
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

        for (files, mut rules) in profile_to_rules {
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

        // Sort clusters deterministically: subsystem clusters first, then by ID
        clusters.sort_by(|a, b| {
            let a_sub = a.id.starts_with("_fused_subsystem_");
            let b_sub = b.id.starts_with("_fused_subsystem_");
            match (a_sub, b_sub) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.id.cmp(&b.id),
            }
        });

        clusters
    }
}

/// Extract selector namespace in a strictly general-purpose manner without hardcoding any library names.
fn extract_selector_namespace(selector: &str) -> Option<String> {
    let s = selector.trim();
    if s.is_empty() || s == "*" || s == ":host" {
        return None;
    }

    // Unwrap :host(...)
    let inner = if let Some(stripped) = s.strip_prefix(":host(") {
        if let Some(end) = stripped.strip_suffix(')') {
            end.trim()
        } else {
            stripped.trim()
        }
    } else {
        s
    };

    // 1. Check for attribute selector: [attr] or [attr~="value"] or [attr="value"]
    if let Some(bracket_start) = inner.find('[') {
        if let Some(bracket_end) = inner[bracket_start..].find(']') {
            let attr_content = &inner[bracket_start + 1..bracket_start + bracket_end];
            // If it is [part~="..."] or [part="..."]
            if let Some(part_match) = attr_content.strip_prefix("part") {
                if let Some(quote_start) = part_match.find('"') {
                    if let Some(quote_end) = part_match[quote_start + 1..].find('"') {
                        let part_val = &part_match[quote_start + 1..quote_start + 1 + quote_end];
                        return Some(clean_namespace_token(part_val));
                    }
                }
            }
            // General attribute: e.g. popover, data-tooltip, aria-disabled
            let attr_name = attr_content
                .split(['=', '~', '|', '^', '$', '*'])
                .next()
                .unwrap_or("")
                .trim();
            let stripped_attr = attr_name
                .strip_prefix("data-")
                .or_else(|| attr_name.strip_prefix("aria-"))
                .unwrap_or(attr_name);
            if !stripped_attr.is_empty() {
                return Some(clean_namespace_token(stripped_attr));
            }
        }
    }

    // 2. Check for class selector: .class-name
    if let Some(dot_pos) = inner.find('.') {
        let after_dot = &inner[dot_pos + 1..];
        let class_name: String = after_dot
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == ':')
            .collect();
        if !class_name.is_empty() {
            return Some(clean_namespace_token(&class_name));
        }
    }

    // 3. Check for specific pseudo-classes / elements
    if let Some(colon_pos) = inner.find(':') {
        let after_colon = &inner[colon_pos + 1..];
        let pseudo_name: String = after_colon
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '-')
            .collect();
        if !pseudo_name.is_empty() && pseudo_name != "host" && pseudo_name != "not" {
            return Some(clean_namespace_token(&pseudo_name));
        }
    }

    None
}

/// Normalize token into root stem across standard BEM, kebab-case, or vendor prefix conventions.
fn clean_namespace_token(token: &str) -> String {
    let lower = token.to_ascii_lowercase();

    let base = if let Some(idx) = lower.find("__") {
        let prefix = &lower[..idx];
        if prefix.len() <= 2 {
            &lower[idx + 2..]
        } else {
            prefix
        }
    } else if let Some(idx) = lower.find("--") {
        let prefix = &lower[..idx];
        if prefix.len() <= 2 {
            &lower[idx + 2..]
        } else {
            prefix
        }
    } else {
        &lower
    };

    let parts: Vec<&str> = base.split('-').collect();
    if parts.len() > 1 && parts[0].len() >= 3 {
        parts[0].to_string()
    } else if parts.len() > 1 && parts[0].len() <= 2 && parts[1].len() >= 3 {
        parts[1].to_string()
    } else {
        base.to_string()
    }
}

/// Extract structural declaration topology from declaration list.
fn extract_declaration_topology(declarations: &[String]) -> Option<String> {
    let mut properties = Vec::new();
    for decl in declarations {
        if let Some(colon_pos) = decl.find(':') {
            let prop = decl[..colon_pos].trim().to_ascii_lowercase();
            if !prop.is_empty() {
                properties.push(prop);
            }
        }
    }
    properties.sort();
    properties.dedup();
    if properties.len() >= 2 {
        Some(properties.join("+"))
    } else {
        None
    }
}
