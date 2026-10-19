use crate::import_scanner::ImportContext;
use crate::models::ClassificationResult;
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;

/// Mode B directive lowering is unified into `@lit-core/directives`.
/// Components requiring directive lowering are left untouched by `@lit-core/native`,
/// ensuring genuine separation of concerns across packages without duplicating compiler passes.
pub fn transform_micro_class<'a>(
    _class: &mut Class<'a>,
    _source: &str,
    _target: &ClassificationResult,
    _ast: &AstBuilder<'a>,
    _import_ctx: &ImportContext,
) -> bool {
    false
}
