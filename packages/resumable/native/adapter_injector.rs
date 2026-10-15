use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::{walk, Visit};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder, SymbolId};
use oxc_span::{SourceType, SPAN};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

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

/// Canonical export names (stable under aliasing and minification) that identify
/// a custom element definition through a resolved import binding.
const CUSTOM_ELEMENT_DECORATOR_EXPORT: &str = "customElement";
const ELEMENT_BASE_EXPORTS: [&str; 2] = ["LitElement", "ReactiveElement"];
const ADAPTER_EXPORT: &str = "installResumableAdapter";
const GLOBAL_THIS_ALIASES: [&str; 3] = ["window", "globalThis", "self"];

/// Finds custom element definitions anywhere in the program using semantic bindings:
/// - calls to `customElements.define` on the global registry,
/// - calls to an imported `customElement` decorator factory (decorator or lowered form),
/// - classes extending an imported `LitElement` / `ReactiveElement` or the global `HTMLElement`.
struct ElementDetector<'s> {
    scoping: &'s Scoping,
    decorator_symbols: HashSet<SymbolId>,
    base_symbols: HashSet<SymbolId>,
    namespace_symbols: HashSet<SymbolId>,
    found: bool,
}

impl<'s> ElementDetector<'s> {
    fn new(program: &Program, scoping: &'s Scoping) -> Self {
        let mut detector = Self {
            scoping,
            decorator_symbols: HashSet::new(),
            base_symbols: HashSet::new(),
            namespace_symbols: HashSet::new(),
            found: false,
        };
        for stmt in &program.body {
            let Statement::ImportDeclaration(import_decl) = stmt else {
                continue;
            };
            let Some(specifiers) = &import_decl.specifiers else {
                continue;
            };
            for spec in specifiers {
                match spec {
                    ImportDeclarationSpecifier::ImportSpecifier(named) => {
                        let Some(symbol) = named.local.symbol_id.get() else {
                            continue;
                        };
                        let imported = named.imported.name();
                        if imported == CUSTOM_ELEMENT_DECORATOR_EXPORT {
                            detector.decorator_symbols.insert(symbol);
                        } else if ELEMENT_BASE_EXPORTS.contains(&imported.as_str()) {
                            detector.base_symbols.insert(symbol);
                        }
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                        if let Some(symbol) = ns.local.symbol_id.get() {
                            detector.namespace_symbols.insert(symbol);
                        }
                    }
                    _ => {}
                }
            }
        }
        detector
    }

    fn symbol_of(&self, ident: &IdentifierReference) -> Option<SymbolId> {
        ident
            .reference_id
            .get()
            .and_then(|reference_id| self.scoping.get_reference(reference_id).symbol_id())
    }

    fn is_unresolved_global(&self, ident: &IdentifierReference, name: &str) -> bool {
        ident.name == name && self.symbol_of(ident).is_none()
    }

    /// `customElements`, `window.customElements`, `globalThis.customElements`, `self.customElements`
    fn is_global_registry(&self, expr: &Expression) -> bool {
        match expr {
            Expression::Identifier(ident) => self.is_unresolved_global(ident, "customElements"),
            Expression::StaticMemberExpression(mem) if mem.property.name == "customElements" => {
                matches!(
                    &mem.object,
                    Expression::Identifier(root)
                        if GLOBAL_THIS_ALIASES.iter().any(|alias| self.is_unresolved_global(root, alias))
                )
            }
            _ => false,
        }
    }

    fn is_decorator_factory(&self, callee: &Expression) -> bool {
        match callee {
            Expression::Identifier(ident) => self
                .symbol_of(ident)
                .is_some_and(|symbol| self.decorator_symbols.contains(&symbol)),
            Expression::StaticMemberExpression(mem)
                if mem.property.name == CUSTOM_ELEMENT_DECORATOR_EXPORT =>
            {
                matches!(
                    &mem.object,
                    Expression::Identifier(obj)
                        if self.symbol_of(obj).is_some_and(|symbol| self.namespace_symbols.contains(&symbol))
                )
            }
            _ => false,
        }
    }

    /// Resolves `extends X`, including mixin wrappers such as `extends Mixin(X)`.
    fn extends_element(&self, expr: &Expression) -> bool {
        match expr {
            Expression::Identifier(ident) => match self.symbol_of(ident) {
                Some(symbol) => self.base_symbols.contains(&symbol),
                None => ident.name == "HTMLElement",
            },
            Expression::CallExpression(call) => call
                .arguments
                .iter()
                .filter_map(|arg| arg.as_expression())
                .any(|arg| self.extends_element(arg)),
            Expression::ParenthesizedExpression(paren) => self.extends_element(&paren.expression),
            _ => false,
        }
    }
}

impl<'a> Visit<'a> for ElementDetector<'_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.found {
            return;
        }
        let is_define = matches!(
            &call.callee,
            Expression::StaticMemberExpression(mem)
                if mem.property.name == "define" && self.is_global_registry(&mem.object)
        );
        if is_define || self.is_decorator_factory(&call.callee) {
            self.found = true;
            return;
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_class(&mut self, class: &Class<'a>) {
        if self.found {
            return;
        }
        if let Some(heritage) = &class.heritage {
            if self.extends_element(&heritage.expression) {
                self.found = true;
                return;
            }
        }
        walk::walk_class(self, class);
    }
}

fn has_custom_element_definition(program: &Program) -> bool {
    let semantic = SemanticBuilder::new().build(program).semantic;
    let mut detector = ElementDetector::new(program, semantic.scoping());
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
                if let ImportDeclarationSpecifier::ImportSpecifier(named) = spec {
                    if named.imported.name() == ADAPTER_EXPORT {
                        return true;
                    }
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
        || !has_custom_element_definition(&parsed.program)
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
