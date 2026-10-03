use crate::models::{ClusterGroup, ExtractedStyle, RewrittenFileInfo};
use crate::normalizer::subtract_rules_from_css;
use std::path::Path;

pub fn rewrite_file(
    file_path: &str,
    original_code: &str,
    extracted_styles: &[ExtractedStyle],
    clusters: &[ClusterGroup],
    output_dir: &str,
    virtual_imports: bool,
) -> Option<RewrittenFileInfo> {
    // Find which clusters apply to this file
    let applicable_clusters: Vec<&ClusterGroup> = clusters
        .iter()
        .filter(|c| c.shared_by_files.contains(&file_path.to_string()))
        .collect();

    if applicable_clusters.is_empty() {
        return None;
    }

    let file_styles: Vec<&ExtractedStyle> = extracted_styles
        .iter()
        .filter(|s| s.file_path == file_path)
        .collect();

    if file_styles.is_empty() {
        return None;
    }

    // Gather all shared rules applicable to this file
    let mut shared_rules = Vec::new();
    let mut cluster_ids = Vec::new();
    for cluster in &applicable_clusters {
        shared_rules.extend(cluster.rules.clone());
        cluster_ids.push(cluster.id.clone());
    }
    cluster_ids.sort_by(|a, b| {
        let a_sub = a.starts_with("_fused_subsystem_");
        let b_sub = b.starts_with("_fused_subsystem_");
        match (a_sub, b_sub) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.cmp(b),
        }
    });
    cluster_ids.dedup();

    // Replacements: (start_byte, end_byte, replacement_string)
    let mut replacements: Vec<(usize, usize, String)> = Vec::new();

    for style in file_styles {
        let remaining_css = subtract_rules_from_css(style, &shared_rules);
        let cluster_ref_list = cluster_ids.join(", ");
        let tag = style.tag_identifier.as_deref().unwrap_or("css");

        match style.location_kind.as_str() {
            "static_property" => {
                if let Some(parent) = &style.parent_span {
                    let replacement = if let Some(rem) = remaining_css {
                        format!(
                            "static styles = [{}, {}`\n{}\n  `];",
                            cluster_ref_list, tag, rem
                        )
                    } else {
                        format!("static styles = [{}];", cluster_ref_list)
                    };
                    replacements.push((parent.start, parent.end, replacement));
                } else if let Some(rem) = remaining_css {
                    let interpolations: Vec<String> =
                        cluster_ids.iter().map(|c| format!("${{{}}}", c)).collect();
                    replacements.push((
                        style.span.start,
                        style.span.end,
                        format!("{}`\n{}\n{}\n  `", tag, interpolations.join("\n"), rem),
                    ));
                } else if cluster_ids.len() == 1 {
                    replacements.push((style.span.start, style.span.end, cluster_ids[0].clone()));
                } else {
                    let interpolations: Vec<String> =
                        cluster_ids.iter().map(|c| format!("${{{}}}", c)).collect();
                    replacements.push((
                        style.span.start,
                        style.span.end,
                        format!("{}`\n{}\n  `", tag, interpolations.join("\n")),
                    ));
                }
            }
            "static_getter" => {
                if let Some(parent) = &style.parent_span {
                    let replacement = if let Some(rem) = remaining_css {
                        format!("return [{}, {}`\n{}\n  `];", cluster_ref_list, tag, rem)
                    } else {
                        format!("return [{}];", cluster_ref_list)
                    };
                    replacements.push((parent.start, parent.end, replacement));
                } else if let Some(rem) = remaining_css {
                    let interpolations: Vec<String> =
                        cluster_ids.iter().map(|c| format!("${{{}}}", c)).collect();
                    replacements.push((
                        style.span.start,
                        style.span.end,
                        format!("{}`\n{}\n{}\n  `", tag, interpolations.join("\n"), rem),
                    ));
                } else if cluster_ids.len() == 1 {
                    replacements.push((style.span.start, style.span.end, cluster_ids[0].clone()));
                } else {
                    let interpolations: Vec<String> =
                        cluster_ids.iter().map(|c| format!("${{{}}}", c)).collect();
                    replacements.push((
                        style.span.start,
                        style.span.end,
                        format!("{}`\n{}\n  `", tag, interpolations.join("\n")),
                    ));
                }
            }
            _ => {
                // "variable", "export_default", "standalone", or array element
                let replacement = if let Some(rem) = remaining_css {
                    let interpolations: Vec<String> =
                        cluster_ids.iter().map(|c| format!("${{{}}}", c)).collect();
                    format!("{}`\n{}\n{}\n  `", tag, interpolations.join("\n"), rem)
                } else if cluster_ids.len() == 1 {
                    cluster_ids[0].clone()
                } else {
                    let interpolations: Vec<String> =
                        cluster_ids.iter().map(|c| format!("${{{}}}", c)).collect();
                    format!("{}`\n{}\n  `", tag, interpolations.join("\n"))
                };
                replacements.push((style.span.start, style.span.end, replacement));
            }
        }
    }

    if replacements.is_empty() {
        return None;
    }

    // Sort replacements in descending order by start index so offsets remain valid
    replacements.sort_by_key(|b| std::cmp::Reverse(b.0));

    let mut transformed_code = original_code.to_string();
    for (start, end, text) in replacements {
        if start <= end && end <= transformed_code.len() {
            transformed_code.replace_range(start..end, &text);
        }
    }

    // Generate import statements
    let mut import_lines = Vec::new();
    for cid in &cluster_ids {
        let import_specifier = if virtual_imports {
            format!("virtual:css-fuse/{}.js", cid)
        } else {
            compute_relative_import(file_path, output_dir, cid)
        };
        import_lines.push(format!("import {{ {} }} from '{}';", cid, import_specifier));
    }

    let imports_header = format!("{}\n", import_lines.join("\n"));
    let insert_pos = find_import_insertion_index(&transformed_code);
    if insert_pos == 0 {
        transformed_code = format!("{}{}", imports_header, transformed_code);
    } else {
        transformed_code.insert_str(insert_pos, &imports_header);
    }

    Some(RewrittenFileInfo {
        file_path: file_path.to_string(),
        original_code: original_code.to_string(),
        transformed_code,
        fused_imports: cluster_ids,
    })
}

fn find_import_insertion_index(code: &str) -> usize {
    let mut index = 0;
    // Skip shebang if present
    if code.starts_with("#!") {
        if let Some(pos) = code.find('\n') {
            index = pos + 1;
        } else {
            index = code.len();
        }
    }
    // Skip leading directives (e.g. "use strict"; or "use client";)
    let rest = &code[index..];
    let trimmed = rest.trim_start();
    let leading_ws = rest.len() - trimmed.len();
    let check_str = &rest[leading_ws..];

    if check_str.starts_with("\"use strict\"")
        || check_str.starts_with("'use strict'")
        || check_str.starts_with("\"use client\"")
        || check_str.starts_with("'use client'")
    {
        if let Some(semi_pos) = check_str.find(';') {
            index += leading_ws + semi_pos + 1;
            if index < code.len() && code.as_bytes()[index] == b'\n' {
                index += 1;
            }
        }
    }
    index
}

fn compute_relative_import(from_file: &str, output_dir: &str, cluster_id: &str) -> String {
    let file_path = Path::new(from_file);
    let parent = file_path.parent().unwrap_or(Path::new(""));
    let out_path = Path::new(output_dir).join(format!("{}.js", cluster_id));

    let parent_components: Vec<_> = parent.components().collect();
    let target_components: Vec<_> = out_path.components().collect();

    let mut common = 0;
    while common < parent_components.len()
        && common < target_components.len()
        && parent_components[common] == target_components[common]
    {
        common += 1;
    }

    let mut parts = Vec::new();
    for _ in common..parent_components.len() {
        parts.push("..".to_string());
    }
    for c in &target_components[common..] {
        parts.push(c.as_os_str().to_string_lossy().to_string());
    }

    let joined = parts.join("/");
    if !joined.starts_with("./") && !joined.starts_with("../") {
        format!("./{}", joined)
    } else {
        joined
    }
}
