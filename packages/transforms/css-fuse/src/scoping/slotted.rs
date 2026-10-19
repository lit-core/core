use crate::diagnostics::make_diagnostic;
use crate::models::{Diagnostic, ExtractedStyle};

pub fn audit_slotted_selectors(extracted: &ExtractedStyle) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    let css = &extracted.css_text;

    // Search for ::slotted(...)
    let mut idx = 0;
    while let Some(found) = css[idx..].find("::slotted(") {
        let start_pos = idx + found + "::slotted(".len();
        if let Some(close_pos) = css[start_pos..].find(')') {
            let inner_selector = &css[start_pos..start_pos + close_pos].trim();

            // Check for illegal combinators inside ::slotted()
            // W3C spec: ::slotted() can only take a compound-selector without combinators (no space, >, +, ~)
            let has_combinator = inner_selector.contains('>')
                || inner_selector.contains('+')
                || inner_selector.contains('~')
                || inner_selector.split_whitespace().count() > 1;

            if has_combinator {
                // Calculate rough line number
                let prefix = &css[..start_pos];
                let line = prefix.lines().count() as u32;

                diagnostics.push(make_diagnostic(
          "error",
          "W3C_SLOTTED_COMPOUND",
          &format!(
            "::slotted({}) contains combinators. W3C Shadow DOM Scoping forbids descendant/child combinators inside ::slotted().",
            inner_selector
          ),
          Some(&extracted.file_path),
          Some(extracted.span.line as u32 + line.saturating_sub(1)),
          Some(1),
        ));
            }

            idx = start_pos + close_pos + 1;
        } else {
            break;
        }
    }

    diagnostics
}
