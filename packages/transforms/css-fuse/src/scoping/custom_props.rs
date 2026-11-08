use crate::diagnostics::make_diagnostic;
use crate::models::{Diagnostic, ExtractedStyle};
use lightningcss::properties::custom::Variable;
use lightningcss::stylesheet::{ParserOptions, StyleSheet};
use lightningcss::{
    visit_types,
    visitor::{Visit, VisitTypes, Visitor},
};

struct CustomPropertyAuditor<'a> {
    extracted: &'a ExtractedStyle,
    diagnostics: Vec<Diagnostic>,
}

impl<'i> Visitor<'i> for CustomPropertyAuditor<'_> {
    type Error = std::convert::Infallible;

    fn visit_types(&self) -> VisitTypes {
        visit_types!(VARIABLES)
    }

    fn visit_variable(&mut self, var: &mut Variable<'i>) -> Result<(), Self::Error> {
        let var_content = var.name.ident.0.as_ref();
        if var.fallback.is_none() {
            self.diagnostics.push(make_diagnostic(
                "warning",
                "DESIGN_CONTRACT_NO_FALLBACK",
                &format!(
                    "CSS Custom Property '{var_content}' is consumed without a fallback: var({var_content}, <fallback>).",
                ),
                Some(&self.extracted.file_path),
                Some(self.extracted.span.line as u32),
                Some(1),
            ));
        }
        var.visit_children(self)
    }
}

pub fn audit_custom_properties(extracted: &ExtractedStyle) -> Vec<Diagnostic> {
    let Ok(mut sheet) = StyleSheet::parse(&extracted.css_text, ParserOptions::default()) else {
        return Vec::new();
    };
    let mut auditor = CustomPropertyAuditor {
        extracted,
        diagnostics: Vec::new(),
    };
    let _ = sheet.visit(&mut auditor);
    auditor.diagnostics
}
