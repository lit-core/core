use crate::models::{FusedTemplateInfo, HtmlClusterGroup};

pub fn generate_fused_template(cluster: &HtmlClusterGroup) -> FusedTemplateInfo {
    let tag = if cluster.is_svg { "svg" } else { "html" };
    let code = format!(
        "import {{ {} }} from 'lit';\n\nexport const {} = {}`{}`;\nexport default {};\n",
        tag, cluster.id, tag, cluster.canonical_text, cluster.id
    );

    FusedTemplateInfo {
        id: cluster.id.clone(),
        file_name: cluster.file_name.clone(),
        code,
        kind: tag.to_string(),
        raw_template: cluster.canonical_text.clone(),
        shared_by: cluster.shared_by_files.clone(),
        occurrences_count: cluster.occurrences_count as u32,
    }
}
