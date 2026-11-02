pub use lit_analysis::parts::{PartAddressing, PartDescriptor, classify_parts_from_ir};

pub fn compute_template_paths(quasis: &[String], _normalize_whitespace: bool) -> Vec<Vec<u32>> {
    let num_expressions = quasis.len().saturating_sub(1);
    if num_expressions == 0 {
        return Vec::new();
    }
    lit_analysis::parts::compute_template_paths(quasis, num_expressions).unwrap_or_default()
}

pub fn compute_template_parts(
    quasis: &[String],
    _normalize_whitespace: bool,
) -> Vec<PartDescriptor> {
    let num_expressions = quasis.len().saturating_sub(1);
    if num_expressions == 0 {
        return Vec::new();
    }
    lit_analysis::parts::compute_template_parts(quasis, num_expressions).unwrap_or_default()
}
