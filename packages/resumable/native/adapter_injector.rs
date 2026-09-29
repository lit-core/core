use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::SourceType;
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

    let injection_source = format!(
        "import {{ installResumableAdapter }} from '{}';\ninstallResumableAdapter();\n",
        virtual_module
    );

    let injection_parsed = Parser::new(&allocator, &injection_source, source_type).parse();
    let mut injection_stmts: Vec<Statement> = injection_parsed.program.body.into_iter().collect();

    // Insert injection statements at the top of the program
    let mut new_body = oxc_allocator::Vec::new_in(&&allocator);
    for stmt in injection_stmts.drain(..) {
        new_body.push(stmt);
    }
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
