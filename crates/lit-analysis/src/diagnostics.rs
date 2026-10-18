use oxc_span::Span;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiagnosticCode {
    /// LIT101: Unsupported directive (e.g. until, asyncAppend, asyncReplace)
    LitBailUnsupportedDirective,
    /// LIT102: Escaping this to unverified function
    LitBailEscapingThis,
    /// LIT103: Accessing unproven or undeclared member on this
    LitBailUnprovenThisAccess,
    /// LIT104: Direct shadowRoot mutation
    LitBailShadowRootAccess,
    /// LIT105: Dynamic tag name interpolation in template
    LitBailDynamicTagName,
    /// LIT106: Collinear event names conflicting in camelCase
    LitBailConflictingEventNames,
    /// LIT107: Unsafe directive placement (e.g. unsafeHTML with siblings)
    LitBailUnsafeDirectivePlacement,
    /// LIT108: Unresolvable external inheritance
    LitBailUnresolvableInheritance,
    /// LIT201: Style isolation warning
    LitWarnStyleIsolation,
    /// LIT202: Component classified as Tier 0 pure
    LitInfoTier0Pure,
}

impl DiagnosticCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::LitBailUnsupportedDirective => "LIT101",
            Self::LitBailEscapingThis => "LIT102",
            Self::LitBailUnprovenThisAccess => "LIT103",
            Self::LitBailShadowRootAccess => "LIT104",
            Self::LitBailDynamicTagName => "LIT105",
            Self::LitBailConflictingEventNames => "LIT106",
            Self::LitBailUnsafeDirectivePlacement => "LIT107",
            Self::LitBailUnresolvableInheritance => "LIT108",
            Self::LitWarnStyleIsolation => "LIT201",
            Self::LitInfoTier0Pure => "LIT202",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub code: DiagnosticCode,
    pub severity: DiagnosticSeverity,
    pub message: String,
    pub span: (u32, u32),
    pub universal_lit_hint: String,
}

impl Diagnostic {
    pub fn unsupported_directive(directive: &str, span: Span) -> Self {
        Self {
            code: DiagnosticCode::LitBailUnsupportedDirective,
            severity: DiagnosticSeverity::Error,
            message: format!("Unsupported Lit directive `{}` in template", directive),
            span: (span.start, span.end),
            universal_lit_hint: "Use @lit/task or component async state with requestUpdate() instead of asynchronous directives like until() or asyncAppend().".to_string(),
        }
    }

    pub fn escaping_this(callee: &str, span: Span) -> Self {
        Self {
            code: DiagnosticCode::LitBailEscapingThis,
            severity: DiagnosticSeverity::Error,
            message: format!("Passing `this` instance to unverified function `{}`", callee),
            span: (span.start, span.end),
            universal_lit_hint: "Pass explicit DOM element references (e.g. this.renderRoot.querySelector) or implement ReactiveController instead of escaping the host instance.".to_string(),
        }
    }

    pub fn unproven_this_access(member: &str, span: Span) -> Self {
        Self {
            code: DiagnosticCode::LitBailUnprovenThisAccess,
            severity: DiagnosticSeverity::Error,
            message: format!("Accessing undeclared property `this.{}`", member),
            span: (span.start, span.end),
            universal_lit_hint: "Declare reactive properties with @property() or @state(), or access standard host attributes via getAttribute().".to_string(),
        }
    }

    pub fn shadow_root_access(operation: &str, span: Span) -> Self {
        Self {
            code: DiagnosticCode::LitBailShadowRootAccess,
            severity: DiagnosticSeverity::Error,
            message: format!("Direct ShadowRoot manipulation: {}", operation),
            span: (span.start, span.end),
            universal_lit_hint: "Declare styles declaratively via `static styles = css`...`` rather than mutating shadowRoot.adoptedStyleSheets directly.".to_string(),
        }
    }

    pub fn dynamic_tag_name(span: Span) -> Self {
        Self {
            code: DiagnosticCode::LitBailDynamicTagName,
            severity: DiagnosticSeverity::Error,
            message: "Dynamic tag name interpolation in template".to_string(),
            span: (span.start, span.end),
            universal_lit_hint: "Use conditional branching (such as when() or ternary expressions) with static tags instead of interpolating tag names.".to_string(),
        }
    }

    pub fn conflicting_event_names(event_name: &str, camel_name: &str, span: Span) -> Self {
        Self {
            code: DiagnosticCode::LitBailConflictingEventNames,
            severity: DiagnosticSeverity::Error,
            message: format!("Event `{}` conflicts with camelCase callback `{}`", event_name, camel_name),
            span: (span.start, span.end),
            universal_lit_hint: "Rename one of the conflicting events to ensure a distinct camelCase callback property name.".to_string(),
        }
    }

    pub fn unsafe_directive_placement(directive: &str, detail: &str, span: Span) -> Self {
        Self {
            code: DiagnosticCode::LitBailUnsafeDirectivePlacement,
            severity: DiagnosticSeverity::Error,
            message: format!("Unsafe placement of `{}` directive: {}", directive, detail),
            span: (span.start, span.end),
            universal_lit_hint:
                "Wrap unsafe HTML/SVG directives inside a dedicated isolated container element."
                    .to_string(),
        }
    }

    pub fn unresolvable_inheritance(class_name: &str, super_class: &str, span: Span) -> Self {
        Self {
            code: DiagnosticCode::LitBailUnresolvableInheritance,
            severity: DiagnosticSeverity::Error,
            message: format!("Class `{}` extends unresolvable base `{}`", class_name, super_class),
            span: (span.start, span.end),
            universal_lit_hint: "Export the base class from a statically resolvable module or extend LitElement directly.".to_string(),
        }
    }

    pub fn tier0_pure_info(class_name: &str) -> Self {
        Self {
            code: DiagnosticCode::LitInfoTier0Pure,
            severity: DiagnosticSeverity::Info,
            message: format!("Component `{}` classified as Tier 0 (Pure Stateless)", class_name),
            span: (0, 0),
            universal_lit_hint: "Component compiles directly to a pure function component with zero runtime dependencies and React Server Components compatibility.".to_string(),
        }
    }
}
