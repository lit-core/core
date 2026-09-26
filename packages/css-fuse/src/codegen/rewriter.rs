use std::path::Path;
use crate::models::{ClusterGroup, ExtractedStyle, RewrittenFileInfo};
use crate::normalizer::subtract_rules_from_css;

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
  cluster_ids.sort();
  cluster_ids.dedup();

  // Replacements: (start_byte, end_byte, replacement_string)
  let mut replacements: Vec<(usize, usize, String)> = Vec::new();

  for style in file_styles {
    let remaining_css = subtract_rules_from_css(style, &shared_rules);
    let cluster_ref_list = cluster_ids.join(", ");

    match style.location_kind.as_str() {
      "static_property" => {
        if let Some(parent) = &style.parent_span {
          let replacement = if let Some(rem) = remaining_css {
            format!("static styles = [{}, css`\n{}\n  `];", cluster_ref_list, rem)
          } else {
            format!("static styles = [{}];", cluster_ref_list)
          };
          replacements.push((parent.start, parent.end, replacement));
        } else if let Some(rem) = remaining_css {
          replacements.push((
            style.span.start,
            style.span.end,
            format!("css`\n{}\n  `", rem),
          ));
        }
      }
      "static_getter" => {
        if let Some(parent) = &style.parent_span {
          let replacement = if let Some(rem) = remaining_css {
            format!("return [{}, css`\n{}\n  `];", cluster_ref_list, rem)
          } else {
            format!("return [{}];", cluster_ref_list)
          };
          replacements.push((parent.start, parent.end, replacement));
        } else if let Some(rem) = remaining_css {
          replacements.push((
            style.span.start,
            style.span.end,
            format!("css`\n{}\n  `", rem),
          ));
        }
      }
      "variable" | "export_default" => {
        let replacement = if let Some(rem) = remaining_css {
          format!("[{}, css`\n{}\n  `]", cluster_ref_list, rem)
        } else {
          format!("[{}]", cluster_ref_list)
        };
        replacements.push((style.span.start, style.span.end, replacement));
      }
      _ => {
        // standalone or array element
        if let Some(rem) = remaining_css {
          replacements.push((
            style.span.start,
            style.span.end,
            format!("css`\n{}\n  `", rem),
          ));
        }
      }
    }
  }

  if replacements.is_empty() {
    return None;
  }

  // Sort replacements in descending order by start index so offsets remain valid
  replacements.sort_by(|a, b| b.0.cmp(&a.0));

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
  transformed_code = format!("{}{}", imports_header, transformed_code);

  Some(RewrittenFileInfo {
    file_path: file_path.to_string(),
    original_code: original_code.to_string(),
    transformed_code,
    fused_imports: cluster_ids,
  })
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
