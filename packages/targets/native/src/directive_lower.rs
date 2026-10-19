//! Directive lowering is unified into `@lit-core/directives`.
//! This module preserves the `DirectiveLowerer` interface for `native` without duplicating
//! directive transformation passes.

use crate::import_scanner::ImportContext;
use oxc_ast::ast::Class;
use oxc_ast::builder::AstBuilder;

pub struct DirectiveLowerer<'a, 'b> {
    pub ast: &'b AstBuilder<'a>,
    pub import_ctx: &'b ImportContext,
    pub used_nothing: bool,
    pub lowered_count: u32,
}

impl<'a, 'b> DirectiveLowerer<'a, 'b> {
    pub fn new(ast: &'b AstBuilder<'a>, import_ctx: &'b ImportContext) -> Self {
        Self {
            ast,
            import_ctx,
            used_nothing: false,
            lowered_count: 0,
        }
    }

    pub fn transform_class(&mut self, _class: &mut Class<'a>) {
        // Directive lowering is handled by @lit-core/directives; no duplicate pass is run here.
    }
}
