use crate::models::{Diagnostic, ExtractedFragment};
use std::collections::HashMap;

pub struct TemplateAuditor;

impl TemplateAuditor {
    pub fn audit_all(fragments: &[ExtractedFragment]) -> Vec<Diagnostic> {
        let mut diagnostics = Vec::new();
        let mut occurrences_by_hash: HashMap<&str, Vec<&ExtractedFragment>> = HashMap::new();

        for f in fragments {
            occurrences_by_hash.entry(&f.hash).or_default().push(f);
        }

        for (hash, frags) in occurrences_by_hash {
            if frags.len() > 1 {
                let first = frags[0];
                let snippet = if first.canonical_text.len() > 50 {
                    format!("{}...", &first.canonical_text[..47])
                } else {
                    first.canonical_text.clone()
                };

                diagnostics.push(Diagnostic {
                    severity: "info".to_string(),
                    code: "DUPLICATE_STATIC_FRAGMENT".to_string(),
                    message: format!(
                        "Static template fragment '{}' duplicated across {} component occurrences (hash: {})",
                        snippet,
                        frags.len(),
                        hash
                    ),
                    file_path: Some(first.file_path.clone()),
                    line: Some(first.span.line as u32),
                    column: Some(first.span.column as u32),
                });
            }
        }

        diagnostics
    }
}
