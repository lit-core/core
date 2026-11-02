use crate::options::ServerSplitDiagnostic;
use oxc_span::Span;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticCode {
    /// Server-only binding leaked into client AST scope.
    SE101,
    /// Unsupported TypeScript type in @action() parameter.
    SE102,
    /// Property modified in @loader() is not declared as a reactive property.
    SE103,
    /// render() method attempts to invoke a @loader() method directly.
    SE104,
    /// Invalid @action() signature (e.g. non-async or missing parameter types).
    SE105,
    /// Server element cannot be lowered to zero-Lit HTMLElement stub or contains unsupported client closures.
    SE106,
}

impl DiagnosticCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SE101 => "SE101",
            Self::SE102 => "SE102",
            Self::SE103 => "SE103",
            Self::SE104 => "SE104",
            Self::SE105 => "SE105",
            Self::SE106 => "SE106",
        }
    }
}

pub fn error_diagnostic(
    code: DiagnosticCode,
    message: impl Into<String>,
    span: Span,
) -> ServerSplitDiagnostic {
    ServerSplitDiagnostic {
        code: code.as_str().to_string(),
        severity: "error".to_string(),
        message: message.into(),
        start: span.start,
        end: span.end,
    }
}

pub fn warning_diagnostic(
    code: DiagnosticCode,
    message: impl Into<String>,
    span: Span,
) -> ServerSplitDiagnostic {
    ServerSplitDiagnostic {
        code: code.as_str().to_string(),
        severity: "warning".to_string(),
        message: message.into(),
        start: span.start,
        end: span.end,
    }
}
