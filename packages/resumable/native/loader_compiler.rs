use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{SourceType, SPAN};
use oxc_traverse::{traverse_mut, Traverse, TraverseCtx};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const LOADER_TEMPLATE: &str = include_str!("loader.js");

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct ResumableLoaderOptions {
    pub manifest: Option<HashMap<String, String>>,
    pub preload_on_hover: Option<bool>,
    pub idle_hydration: Option<bool>,
    pub idle_timeout: Option<u32>,
    pub events: Option<Vec<String>>,
}

struct LoaderConfigInjector<'a, 'b> {
    ast: &'b AstBuilder<'a>,
    manifest: HashMap<String, String>,
    events: Vec<String>,
    idle_hydration: bool,
    idle_timeout: u32,
}

impl<'a, 'b> Traverse<'a, ()> for LoaderConfigInjector<'a, 'b> {
    fn enter_statement(&mut self, stmt: &mut Statement<'a>, _ctx: &mut TraverseCtx<'a, ()>) {
        if !self.idle_hydration {
            if let Statement::IfStatement(if_stmt) = stmt {
                if let Expression::Identifier(ident) = &if_stmt.test {
                    if ident.name == "__IDLE_HYDRATION__" {
                        *stmt = Statement::new_empty_statement(SPAN, self.ast);
                    }
                }
            }
        }
    }

    fn enter_expression(&mut self, expr: &mut Expression<'a>, _ctx: &mut TraverseCtx<'a, ()>) {
        if let Expression::Identifier(ident) = expr {
            match ident.name.as_str() {
                "__MANIFEST__" => {
                    let mut properties = ArenaVec::new_in(self.ast);
                    for (tag, url) in &self.manifest {
                        let key = PropertyKey::new_string_literal(
                            SPAN,
                            self.ast.allocator().alloc_str(tag),
                            None,
                            self.ast,
                        );
                        let val = Expression::new_string_literal(
                            SPAN,
                            self.ast.allocator().alloc_str(url),
                            None,
                            self.ast,
                        );
                        let prop = ObjectPropertyKind::new_object_property(
                            SPAN,
                            PropertyKind::Init,
                            key,
                            val,
                            false,
                            false,
                            false,
                            self.ast,
                        );
                        properties.push(prop);
                    }
                    *expr = Expression::new_object_expression(SPAN, properties, self.ast);
                }
                "__EVENTS__" => {
                    let mut elements = ArenaVec::new_in(self.ast);
                    for evt in &self.events {
                        let str_lit = Expression::new_string_literal(
                            SPAN,
                            self.ast.allocator().alloc_str(evt),
                            None,
                            self.ast,
                        );
                        elements.push(ArrayExpressionElement::from(str_lit));
                    }
                    *expr = Expression::new_array_expression(SPAN, elements, self.ast);
                }
                "__IDLE_HYDRATION__" => {
                    *expr = Expression::new_boolean_literal(SPAN, self.idle_hydration, self.ast);
                }
                "__IDLE_TIMEOUT__" => {
                    *expr = Expression::new_numeric_literal(
                        SPAN,
                        self.idle_timeout as f64,
                        None,
                        NumberBase::Decimal,
                        self.ast,
                    );
                }
                _ => {}
            }
        }
    }
}

#[napi]
pub fn compile_resumable_loader(options: Option<ResumableLoaderOptions>) -> String {
    let opts = options.unwrap_or_default();
    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);

    let manifest_map = opts.manifest.unwrap_or_default();
    let preload_on_hover = opts.preload_on_hover.unwrap_or(true);
    let idle_hydration = opts.idle_hydration.unwrap_or(true);
    let idle_timeout = opts.idle_timeout.unwrap_or(2000);

    let mut events_list = opts.events.unwrap_or_else(|| {
        vec![
            "click".to_string(),
            "input".to_string(),
            "change".to_string(),
            "keydown".to_string(),
            "submit".to_string(),
            "pointerdown".to_string(),
            "focusin".to_string(),
        ]
    });

    if preload_on_hover && !events_list.contains(&"pointerover".to_string()) {
        events_list.push("pointerover".to_string());
    }

    // Parse source into AST using oxc_parser
    let mut parsed = Parser::new(&allocator, LOADER_TEMPLATE, SourceType::mjs()).parse();

    let semantic_ret = SemanticBuilder::new().build(&parsed.program);
    let scoping = semantic_ret.semantic.into_scoping();

    let mut injector = LoaderConfigInjector {
        ast: &ast,
        manifest: manifest_map,
        events: events_list,
        idle_hydration,
        idle_timeout,
    };

    traverse_mut(&mut injector, &allocator, &mut parsed.program, scoping, ());

    let codegen_options = CodegenOptions {
        minify: true,
        ..Default::default()
    };
    let codegen_result = Codegen::new()
        .with_options(codegen_options)
        .build(&parsed.program);
    codegen_result.code
}
