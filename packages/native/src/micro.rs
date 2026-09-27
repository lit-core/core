use crate::directive_lower::DirectiveLowerer;
use crate::import_scanner::ImportContext;
use crate::models::ClassificationResult;
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;

pub fn transform_micro_class<'a>(
    class: &mut Class<'a>,
    _source: &str,
    _target: &ClassificationResult,
    ast: &AstBuilder<'a>,
    import_ctx: &ImportContext,
) {
    let mut lowerer = DirectiveLowerer::new(ast, import_ctx);
    lowerer.transform_class(class);
}
