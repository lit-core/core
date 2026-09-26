use miette::{Diagnostic as MietteDiagnostic, NamedSource, SourceSpan as MietteSpan};
use thiserror::Error;
use crate::models::Diagnostic;

#[derive(Error, Debug, MietteDiagnostic)]
#[error("{message}")]
#[diagnostic(code(css_fuse::scoping_violation))]
pub struct ScopingError {
  pub message: String,
  #[source_code]
  pub src: NamedSource<String>,
  #[label("{label}")]
  pub span: MietteSpan,
  pub label: String,
  #[help]
  pub help: Option<String>,
}

#[derive(Error, Debug, MietteDiagnostic)]
#[error("{message}")]
#[diagnostic(code(css_fuse::missing_fallback))]
pub struct FallbackWarning {
  pub message: String,
  #[source_code]
  pub src: NamedSource<String>,
  #[label("{label}")]
  pub span: MietteSpan,
  pub label: String,
  #[help]
  pub help: Option<String>,
}

pub fn make_diagnostic(
  severity: &str,
  code: &str,
  message: &str,
  file_path: Option<&str>,
  line: Option<u32>,
  column: Option<u32>,
) -> Diagnostic {
  Diagnostic {
    severity: severity.to_string(),
    code: code.to_string(),
    message: message.to_string(),
    file_path: file_path.map(|s| s.to_string()),
    line,
    column,
  }
}
