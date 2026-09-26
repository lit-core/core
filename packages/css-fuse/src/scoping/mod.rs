pub mod custom_props;
pub mod slot_dist;
pub mod slotted;

use crate::models::{Diagnostic, ExtractedStyle};
pub use custom_props::audit_custom_properties;
pub use slotted::audit_slotted_selectors;

pub struct ScopingAuditor;

impl ScopingAuditor {
    pub fn audit_style(extracted: &ExtractedStyle) -> Vec<Diagnostic> {
        let mut diags = Vec::new();
        diags.extend(audit_slotted_selectors(extracted));
        diags.extend(audit_custom_properties(extracted));
        diags
    }

    pub fn audit_all(styles: &[ExtractedStyle]) -> Vec<Diagnostic> {
        let mut diags = Vec::new();
        for s in styles {
            diags.extend(Self::audit_style(s));
        }
        diags
    }
}
