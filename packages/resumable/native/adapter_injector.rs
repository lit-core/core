use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{SourceType, SPAN};
use serde::{Deserialize, Serialize};

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

fn has_custom_element_definition(program: &Program) -> bool {
    for stmt in &program.body {
        match stmt {
            Statement::ClassDeclaration(class) => {
                if is_custom_element_class(class) {
                    return true;
                }
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &export_decl.declaration {
                    if is_custom_element_class(class) {
                        return true;
                    }
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &export_decl.declaration
                {
                    if is_custom_element_class(class) {
                        return true;
                    }
                }
            }
            Statement::ExpressionStatement(expr_stmt) => {
                if let Expression::CallExpression(call) = &expr_stmt.expression {
                    if is_custom_elements_define_call(call) {
                        return true;
                    }
                }
            }
            _ => {}
        }
    }
    false
}

fn is_custom_element_class(class: &Class) -> bool {
    // Check decorators
    for dec in &class.decorators {
        if let Expression::CallExpression(call) = &dec.expression {
            if let Expression::Identifier(ident) = &call.callee {
                if ident.name == "customElement" {
                    return true;
                }
            }
        }
    }
    // Check heritage (extends LitElement | ReactiveElement | HTMLElement)
    if let Some(ref heritage) = class.heritage {
        if let Expression::Identifier(ident) = &heritage.expression {
            if ident.name == "LitElement"
                || ident.name == "ReactiveElement"
                || ident.name == "HTMLElement"
            {
                return true;
            }
        }
    }
    false
}

fn is_custom_elements_define_call(call: &CallExpression) -> bool {
    if let Expression::StaticMemberExpression(mem) = &call.callee {
        if mem.property.name == "define" {
            if let Expression::Identifier(obj) = &mem.object {
                return obj.name == "customElements";
            }
        }
    }
    false
}

fn has_adapter_import(program: &Program) -> bool {
    for stmt in &program.body {
        if let Statement::ImportDeclaration(import_decl) = stmt {
            let src = import_decl.source.value.as_str();
            if src.contains("resumable-adapter")
                || src.contains("@lit-core/resumable")
                || src.contains("lit-resumable")
            {
                return true;
            }
            if let Some(ref specifiers) = import_decl.specifiers {
                for spec in specifiers {
                    if let ImportDeclarationSpecifier::ImportSpecifier(named) = spec {
                        if named.imported.name() == "installResumableAdapter" {
                            return true;
                        }
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

    if parsed.program.body.is_empty() {
        return TransformResumableResult {
            code: source,
            map: None,
            transformed: false,
        };
    }

    if has_adapter_import(&parsed.program) || !has_custom_element_definition(&parsed.program) {
        return TransformResumableResult {
            code: source,
            map: None,
            transformed: false,
        };
    }

    let virtual_module = opts
        .virtual_module
        .as_deref()
        .unwrap_or("virtual:lit-core/resumable-adapter");

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
