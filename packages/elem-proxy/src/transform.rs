use napi_derive::napi;
use oxc_allocator::{Allocator, Box as ArenaBox, Vec as ArenaVec};
use oxc_ast::ast::*;
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub use crate::extractor::{
    check_and_extract_target, extract_class_properties, extract_decorator_tag, get_ce_define_call,
    inspect_properties_object, CustomElementTarget,
};
pub use crate::generator::{generate_external_proxy_wrapper, generate_proxy_wrapper};

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct ElemProxyOptions {
    pub mode: Option<String>,
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProxiedElementInfo {
    pub tag_name: String,
    pub class_name: String,
    pub properties: Vec<String>,
    pub observed_attributes: Vec<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ElemProxyResult {
    pub code: String,
    pub map: Option<String>,
    pub proxied_elements_count: u32,
    pub elements: Vec<ProxiedElementInfo>,
}

pub fn transform_code(source: &str, options: ElemProxyOptions) -> ElemProxyResult {
    let allocator = Allocator::default();
    let filename = options.filename.as_deref().unwrap_or("file.ts");
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());

    let mut parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return ElemProxyResult {
            code: source.to_string(),
            map: None,
            proxied_elements_count: 0,
            elements: Vec::new(),
        };
    }

    // Scan for customElements.define calls
    let mut define_calls: HashMap<String, String> = HashMap::new(); // class_name -> tag_name
    for stmt in &parsed.program.body {
        if let Statement::ExpressionStatement(expr_stmt) = stmt {
            if let Expression::CallExpression(call) = &expr_stmt.expression {
                let is_ce_define = match &call.callee {
                    Expression::StaticMemberExpression(mem) => {
                        mem.property.name == "define"
                            && match &mem.object {
                                Expression::Identifier(id) => id.name == "customElements",
                                Expression::StaticMemberExpression(inner) => {
                                    inner.property.name == "customElements"
                                }
                                _ => false,
                            }
                    }
                    _ => false,
                };
                if is_ce_define && call.arguments.len() >= 2 {
                    if let (Some(Expression::StringLiteral(s)), Some(Expression::Identifier(id))) = (
                        call.arguments[0].as_expression(),
                        call.arguments[1].as_expression(),
                    ) {
                        define_calls
                            .insert(id.name.as_str().to_string(), s.value.as_str().to_string());
                    }
                }
            }
        }
    }

    let mut targets: HashMap<String, CustomElementTarget> = HashMap::new();

    // Scan classes in program body
    for stmt in &parsed.program.body {
        match stmt {
            Statement::ClassDeclaration(class) => {
                if let Some(target) = check_and_extract_target(class, false, false, &define_calls) {
                    targets.insert(target.class_name.clone(), target);
                }
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &export_decl.declaration {
                    if let Some(target) =
                        check_and_extract_target(class, true, false, &define_calls)
                    {
                        targets.insert(target.class_name.clone(), target);
                    }
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &export_decl.declaration
                {
                    if let Some(target) = check_and_extract_target(class, true, true, &define_calls)
                    {
                        targets.insert(target.class_name.clone(), target);
                    }
                }
            }
            _ => {}
        }
    }

    let has_any_targets = !targets.is_empty() || !define_calls.is_empty();
    if !has_any_targets {
        return ElemProxyResult {
            code: source.to_string(),
            map: None,
            proxied_elements_count: 0,
            elements: Vec::new(),
        };
    }

    let old_body = std::mem::replace(&mut parsed.program.body, ArenaVec::new_in(&&allocator));
    let mut new_body = ArenaVec::new_in(&&allocator);
    let mut external_elements_info = Vec::new();

    for stmt in old_body {
        if let Some((tag, cls)) = get_ce_define_call(&stmt) {
            if targets.contains_key(&cls) {
                continue;
            } else {
                let wrapper_src = generate_external_proxy_wrapper(&tag, &cls);
                let wrapper =
                    Parser::new(&allocator, allocator.alloc_str(&wrapper_src), source_type).parse();
                for s in wrapper.program.body {
                    new_body.push(s);
                }
                external_elements_info.push(ProxiedElementInfo {
                    tag_name: tag,
                    class_name: cls,
                    properties: Vec::new(),
                    observed_attributes: Vec::new(),
                });
                continue;
            }
        }

        let mut matched_target = None;
        let mut class_to_wrap = None;

        match stmt {
            Statement::ClassDeclaration(mut class) => {
                let is_match = class
                    .id
                    .as_ref()
                    .map(|id| targets.contains_key(id.name.as_str()))
                    .unwrap_or(false);
                if is_match {
                    let target = targets
                        .get(class.id.as_ref().unwrap().name.as_str())
                        .unwrap()
                        .clone();
                    matched_target = Some(target);
                    class
                        .decorators
                        .retain(|d| extract_decorator_tag(d).is_none());
                    class_to_wrap = Some(Statement::ClassDeclaration(class));
                } else {
                    new_body.push(Statement::ClassDeclaration(class));
                }
            }
            Statement::ExportDeclaration(export_decl) => {
                let export_decl = export_decl.unbox();
                let is_match = match &export_decl.declaration {
                    Declaration::ClassDeclaration(class) => class
                        .id
                        .as_ref()
                        .map(|id| targets.contains_key(id.name.as_str()))
                        .unwrap_or(false),
                    _ => false,
                };
                if is_match {
                    if let Declaration::ClassDeclaration(mut class) = export_decl.declaration {
                        let target = targets
                            .get(class.id.as_ref().unwrap().name.as_str())
                            .unwrap()
                            .clone();
                        matched_target = Some(target);
                        class
                            .decorators
                            .retain(|d| extract_decorator_tag(d).is_none());
                        class_to_wrap = Some(Statement::ClassDeclaration(class));
                    }
                } else {
                    new_body.push(Statement::ExportDeclaration(ArenaBox::new_in(
                        export_decl,
                        &&allocator,
                    )));
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                let export_decl = export_decl.unbox();
                let is_match = match &export_decl.declaration {
                    ExportDefaultDeclarationKind::ClassDeclaration(class) => class
                        .id
                        .as_ref()
                        .map(|id| targets.contains_key(id.name.as_str()))
                        .unwrap_or(false),
                    _ => false,
                };
                if is_match {
                    if let ExportDefaultDeclarationKind::ClassDeclaration(mut class) =
                        export_decl.declaration
                    {
                        let target = targets
                            .get(class.id.as_ref().unwrap().name.as_str())
                            .unwrap()
                            .clone();
                        matched_target = Some(target);
                        class
                            .decorators
                            .retain(|d| extract_decorator_tag(d).is_none());
                        class_to_wrap = Some(Statement::ClassDeclaration(class));
                    }
                } else {
                    new_body.push(Statement::ExportDefaultDeclaration(ArenaBox::new_in(
                        export_decl,
                        &&allocator,
                    )));
                }
            }
            other => {
                new_body.push(other);
            }
        }

        if let (Some(target), Some(class_decl)) = (matched_target, class_to_wrap) {
            let wrapper_src = generate_proxy_wrapper(&target);
            let mut wrapper =
                Parser::new(&allocator, allocator.alloc_str(&wrapper_src), source_type).parse();
            let getter_name = format!("__getImpl_{}", target.class_name);

            for wrapper_stmt in &mut wrapper.program.body {
                if let Statement::FunctionDeclaration(func) = wrapper_stmt {
                    if func.id.as_ref().map(|id| id.name.as_str()) == Some(&getter_name) {
                        if let Some(ref mut body) = func.body {
                            if let Some(Statement::IfStatement(if_stmt)) =
                                body.statements.first_mut()
                            {
                                if let Statement::BlockStatement(ref mut block) = if_stmt.consequent
                                {
                                    block.body.insert(0, class_decl);
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            for s in wrapper.program.body {
                new_body.push(s);
            }
        }
    }

    parsed.program.body = new_body;

    let codegen = Codegen::new();
    let rewritten = codegen.build(&parsed.program).code;

    let mut elements_info: Vec<ProxiedElementInfo> = targets
        .into_values()
        .map(|t| ProxiedElementInfo {
            tag_name: t.tag_name,
            class_name: t.class_name,
            properties: t.properties,
            observed_attributes: t.observed_attributes,
        })
        .collect();
    elements_info.extend(external_elements_info);

    let count = elements_info.len() as u32;

    ElemProxyResult {
        code: rewritten,
        map: None,
        proxied_elements_count: count,
        elements: elements_info,
    }
}
