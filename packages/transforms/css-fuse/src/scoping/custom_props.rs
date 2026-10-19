use crate::diagnostics::make_diagnostic;
use crate::models::{Diagnostic, ExtractedStyle};

pub fn audit_custom_properties(extracted: &ExtractedStyle) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    let css = &extracted.css_text;

    // Search for var(--...)
    let mut idx = 0;
    while let Some(found) = css[idx..].find("var(") {
        let var_start = idx + found + 4;
        // Find matching closing parenthesis handling nested var()
        let mut depth = 1;
        let mut end_pos = var_start;

        for (char_idx, ch) in css[var_start..].char_indices() {
            if ch == '(' {
                depth += 1;
            } else if ch == ')' {
                depth -= 1;
                if depth == 0 {
                    end_pos = var_start + char_idx;
                    break;
                }
            }
        }

        if depth == 0 {
            let var_content = &css[var_start..end_pos].trim();

            // Check if it's a CSS custom property
            if var_content.starts_with("--") {
                // If there's no comma at depth 1, there is no fallback
                let mut top_level_comma = false;
                let mut inner_depth = 0;
                for ch in var_content.chars() {
                    if ch == '(' {
                        inner_depth += 1;
                    } else if ch == ')' {
                        inner_depth -= 1;
                    } else if ch == ',' && inner_depth == 0 {
                        top_level_comma = true;
                        break;
                    }
                }

                if !top_level_comma {
                    let prefix = &css[..var_start];
                    let line = prefix.lines().count() as u32;

                    diagnostics.push(make_diagnostic(
            "warning",
            "DESIGN_CONTRACT_NO_FALLBACK",
            &format!(
              "CSS Custom Property '{var_content}' is consumed without a fallback: var({var_content}, <fallback>).",
            ),
            Some(&extracted.file_path),
            Some(extracted.span.line as u32 + line.saturating_sub(1)),
            Some(1),
          ));
                }
            }

            idx = end_pos + 1;
        } else {
            break;
        }
    }

    diagnostics
}
