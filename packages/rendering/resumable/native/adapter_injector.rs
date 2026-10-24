use lit_analysis::symbol::{CanonicalLitSymbol, SymbolProofContext};
use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::{Visit, walk};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{SPAN, SourceType};
use serde::{Deserialize, Serialize};

const DEFAULT_VIRTUAL_MODULE: &str = "virtual:lit-core/resumable-adapter";

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct TransformResumableOptions {
    pub filename: Option<String>,
    pub sourcemap: Option<bool>,
    pub virtual_module: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransformResumableResult {
    pub code: String,
    pub map: Option<String>,
    pub transformed: bool,
}

const ADAPTER_EXPORT: &str = "installResumableAdapter";

fn extends_unshadowed_html_element(expr: &Expression<'_>, ctx: &SymbolProofContext<'_>) -> bool {
    match expr.without_parentheses() {
        Expression::Identifier(ident) => {
            ident.name == "HTMLElement" && ctx.is_unresolved_global(ident)
        }
        Expression::CallExpression(call) => call
            .arguments
            .iter()
            .filter_map(|arg| arg.as_expression())
            .any(|arg| extends_unshadowed_html_element(arg, ctx)),
        _ => false,
    }
}

struct ResumableElementDetector<'a, 's> {
    symbol_ctx: &'a SymbolProofContext<'s>,
    found: bool,
}

impl<'a, 's, 'ast> Visit<'ast> for ResumableElementDetector<'a, 's> {
    fn visit_call_expression(&mut self, call: &CallExpression<'ast>) {
        if self.found {
            return;
        }
        if self
            .symbol_ctx
            .is_custom_elements_define_callee(&call.callee)
        {
            self.found = true;
            return;
        }
        if self.symbol_ctx.is_proven_decorator(&call.callee)
            == Some(CanonicalLitSymbol::CustomElementDecorator)
        {
            self.found = true;
            return;
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_class(&mut self, class: &Class<'ast>) {
        if self.found {
            return;
        }
        if self.symbol_ctx.prove_heritage(class).is_reactive() {
            self.found = true;
            return;
        }
        if class.decorators.iter().any(|d| {
            self.symbol_ctx.is_proven_decorator(&d.expression)
                == Some(CanonicalLitSymbol::CustomElementDecorator)
                || match &d.expression {
                    Expression::CallExpression(call) => {
                        self.symbol_ctx.is_proven_decorator(&call.callee)
                            == Some(CanonicalLitSymbol::CustomElementDecorator)
                    }
                    _ => false,
                }
        }) {
            self.found = true;
            return;
        }
        if let Some(heritage) = &class.heritage
            && extends_unshadowed_html_element(&heritage.expression, self.symbol_ctx)
        {
            self.found = true;
            return;
        }
        walk::walk_class(self, class);
    }
}

fn has_custom_element_definition(program: &Program, source: &str) -> bool {
    let semantic = SemanticBuilder::new().build(program).semantic;
    let scoping = semantic.scoping();
    let symbol_ctx = SymbolProofContext::scan(program, scoping, source);
    let mut detector = ResumableElementDetector {
        symbol_ctx: &symbol_ctx,
        found: false,
    };
    detector.visit_program(program);
    detector.found
}

/// True when the module already imports the adapter, resolved by import source and
/// canonical export name rather than by substring matching on the specifier text.
fn has_adapter_import(program: &Program, virtual_module: &str) -> bool {
    let is_adapter_source = |source: &str| {
        let source = source.strip_suffix(".js").unwrap_or(source);
        source == virtual_module.strip_suffix(".js").unwrap_or(virtual_module)
            || source == DEFAULT_VIRTUAL_MODULE
            || source == "@lit-core/resumable"
            || source == "@lit-core/resumable/client"
    };
    for stmt in &program.body {
        let Statement::ImportDeclaration(import_decl) = stmt else {
            continue;
        };
        if is_adapter_source(import_decl.source.value.as_str()) {
            return true;
        }
        if let Some(specifiers) = &import_decl.specifiers {
            for spec in specifiers {
                if let ImportDeclarationSpecifier::ImportSpecifier(named) = spec
                    && named.imported.name() == ADAPTER_EXPORT
                {
                    return true;
                }
            }
        }
    }
    false
}

#[napi]
pub fn transform_resumable_component(
    source: String,
    options: Option<TransformResumableOptions>,
) -> TransformResumableResult {
    let opts = options.unwrap_or_default();
    let filename = opts.filename.as_deref().unwrap_or("component.ts");
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());

    let allocator = Allocator::default();
    let mut parsed = Parser::new(&allocator, &source, source_type).parse();

    // Prove it or leave it alone: never reprint a module that failed to parse cleanly.
    if !parsed.diagnostics.is_empty() || parsed.program.body.is_empty() {
        return TransformResumableResult {
            code: source,
            map: None,
            transformed: false,
        };
    }

    let virtual_module = opts
        .virtual_module
        .as_deref()
        .unwrap_or(DEFAULT_VIRTUAL_MODULE);

    if has_adapter_import(&parsed.program, virtual_module)
        || !has_custom_element_definition(&parsed.program, &source)
    {
        return TransformResumableResult {
            code: source,
            map: None,
            transformed: false,
        };
    }

    let ast = AstBuilder::new(&allocator);

    let imported = ModuleExportName::IdentifierName(IdentifierName::new(
        SPAN,
        "installResumableAdapter",
        &ast,
    ));
    let local = BindingIdentifier::new(SPAN, "installResumableAdapter", &ast);
    let spec = ImportSpecifier::boxed(SPAN, imported, local, ImportOrExportKind::Value, &ast);
    let mut specs = ArenaVec::new_in(&ast);
    specs.push(ImportDeclarationSpecifier::ImportSpecifier(spec));
    let source_lit = StringLiteral::new(SPAN, virtual_module, None, &ast);
    let import_decl = ImportDeclaration::boxed(
        SPAN,
        Some(specs),
        source_lit,
        None,
        None,
        ImportOrExportKind::Value,
        &ast,
    );
    let import_stmt = Statement::ImportDeclaration(import_decl);

    let callee = Expression::new_identifier(SPAN, "installResumableAdapter", &ast);
    let call_expr =
        Expression::new_call_expression(SPAN, callee, None, ArenaVec::new_in(&ast), false, &ast);
    let call_stmt = Statement::new_expression_statement(SPAN, call_expr, &ast);

    let mut new_body = ArenaVec::new_in(&ast);
    new_body.push(import_stmt);
    new_body.push(call_stmt);
    for stmt in parsed.program.body {
        new_body.push(stmt);
    }
    parsed.program.body = new_body;

    let mut codegen_options = CodegenOptions::default();
    if opts.sourcemap.unwrap_or(false) {
        codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
    }

    let codegen_result = Codegen::new()
        .with_options(codegen_options)
        .build(&parsed.program);

    let map = codegen_result.map.map(|m| m.to_json_string());

    TransformResumableResult {
        code: codegen_result.code,
        map,
        transformed: true,
    }
}
