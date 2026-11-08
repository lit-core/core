pub mod hasher;

use crate::normalizer::hasher::compute_fragment_hash;
use lit_analysis::html_collapse::collapse_template_quasis;

/// Normalizes raw HTML or SVG template fragments into a canonical representation.
/// Minor formatting, whitespace and indentation differences across components
/// are collapsed so identical static trees map to the same cluster.
pub fn normalize_fragment(raw: &str) -> (String, String) {
    let collapsed = collapse_template_quasis(&[raw.trim()]);
    let canonical = collapsed
        .into_iter()
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    let hash = compute_fragment_hash(&canonical);
    (canonical, hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_fragment_whitespace() {
        let raw1 = "<svg   viewBox=\"0 0 16 16\">\n  <path d=\"M4 6\" />\n</svg>";
        let raw2 = "<svg viewBox=\"0 0 16 16\"><path d=\"M4 6\"/></svg>";
        let (canon1, hash1) = normalize_fragment(raw1);
        let (canon2, hash2) = normalize_fragment(raw2);

        assert_eq!(canon1, canon2);
        assert_eq!(hash1, hash2);
        assert_eq!(
            canon1,
            "<svg viewBox=\"0 0 16 16\"><path d=\"M4 6\"/></svg>"
        );
    }

    #[test]
    fn test_normalize_slot_wrapper() {
        let raw1 = "<slot \n  name=\"decorator\" \n  slot=\"decorator\"></slot>";
        let raw2 = "<slot name=\"decorator\" slot=\"decorator\"></slot>";
        let (c1, h1) = normalize_fragment(raw1);
        let (c2, h2) = normalize_fragment(raw2);

        assert_eq!(c1, c2);
        assert_eq!(h1, h2);
    }
}
