use crate::models::{ExtractedFragment, HtmlClusterGroup, RewrittenFileInfo};
use std::collections::HashMap;
use std::path::Path;

pub fn rewrite_file(
    file_path: &str,
    original_code: &str,
    fragments: &[ExtractedFragment],
    clusters: &[HtmlClusterGroup],
    output_dir: &str,
    virtual_imports: bool,
) -> Option<RewrittenFileInfo> {
    // Check which clusters apply to this file
    let applicable_clusters: Vec<&HtmlClusterGroup> = clusters
        .iter()
        .filter(|c| c.shared_by_files.contains(&file_path.to_string()))
        .collect();

    if applicable_clusters.is_empty() {
        return None;
    }

    let mut cluster_map = HashMap::new();
    for cluster in &applicable_clusters {
        // Map canonical hash from cluster id
        // cluster.id is "_fused_html_<hash>" or "_fused_svg_<hash>"
        if let Some(hash) = cluster.id.split('_').last() {
            cluster_map.insert(hash.to_string(), *cluster);
        }
    }

    let file_frags: Vec<&ExtractedFragment> = fragments
        .iter()
        .filter(|f| f.file_path == file_path)
        .collect();

    if file_frags.is_empty() {
        return None;
    }

    let mut replacements: Vec<(usize, usize, String, String)> = Vec::new();

    for frag in file_frags {
        if let Some(cluster) = cluster_map.get(&frag.hash) {
            let replacement = if frag.is_full_template {
                cluster.id.clone()
            } else {
                format!("${{{}}}", cluster.id)
            };

            replacements.push((
                frag.span.start,
                frag.span.end,
                replacement,
                cluster.id.clone(),
            ));
        }
    }

    if replacements.is_empty() {
        return None;
    }

    // Deduplicate/filter overlapping replacements: sort by start asc, end desc
    replacements.sort_by(|a, b| {
        let cmp = a.0.cmp(&b.0);
        if cmp != std::cmp::Ordering::Equal {
            return cmp;
        }
        b.1.cmp(&a.1)
    });

    let mut filtered_replacements: Vec<(usize, usize, String)> = Vec::new();
    let mut used_clusters = Vec::new();
    let mut last_end = 0;
    for (start, end, rep_text, cid) in replacements {
        if start >= last_end {
            last_end = end;
            used_clusters.push(cid);
            filtered_replacements.push((start, end, rep_text));
        }
    }

    if filtered_replacements.is_empty() {
        return None;
    }

    used_clusters.sort();
    used_clusters.dedup();

    // Sort replacements descending by start byte offset so offsets remain valid
    filtered_replacements.sort_by_key(|b| std::cmp::Reverse(b.0));

    let mut transformed_code = original_code.to_string();
    for (start, end, text) in filtered_replacements {
        if start <= end && end <= transformed_code.len() {
            transformed_code.replace_range(start..end, &text);
        }
    }

    // Generate import statements
    let mut import_lines = Vec::new();
    for cid in &used_clusters {
        let import_specifier = if virtual_imports {
            format!("virtual:html-fuse/{}.js", cid)
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
        fused_imports: used_clusters,
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
