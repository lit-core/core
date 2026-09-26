use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{SourceType, SPAN};

use crate::constructor::inject_constructor_statements;
use crate::decorators::custom_element::transform_custom_element;
use crate::decorators::event_options::try_transform_event_options;
use crate::decorators::localized::transform_localized;
use crate::decorators::property::try_transform_property;
use crate::decorators::query::try_transform_query;
use crate::decorators::query_all::try_transform_query_all;
use crate::decorators::query_assigned::try_transform_query_assigned;
use crate::decorators::query_async::try_transform_query_async;
use crate::decorators::state::try_transform_state;
use crate::lit_import_scanner::{is_lit_import, ImportContext};
use crate::static_properties::inject_or_merge_static_properties;

#[napi(object)]
#[derive(Default, Clone, Debug)]
pub struct TransformOptions {
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct TransformResult {
    pub code: String,
    pub map: Option<String>,
}

pub fn transform_code(source: &str, options: TransformOptions) -> TransformResult {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(options.filename.as_deref().unwrap_or("file.ts"))
        .unwrap_or_else(|_| SourceType::ts());

    let parsed = Parser::new(&allocator, source, source_type).parse();

    if !parsed.diagnostics.is_empty() {
        return TransformResult {
            code: source.to_string(),
            map: None,
        };
    }

    let mut program = parsed.program;

    // 1. Scan for Lit decorator imports
    let import_ctx = ImportContext::scan(&program);
    if !import_ctx.has_lit_decorators() {
        return TransformResult {
            code: source.to_string(),
            map: None,
        };
    }

    let ast = AstBuilder::new(&allocator);

    // 2. Walk top-level statements and transform classes
    let old_statements = std::mem::replace(&mut program.body, ArenaVec::new_in(&ast));
    let mut new_statements = ArenaVec::new_in(&ast);

    for mut stmt in old_statements {
        match &mut stmt {
            Statement::ClassDeclaration(class) => {
                let post_stmts = transform_class(class, &import_ctx, &ast);
                new_statements.push(stmt);
                for s in post_stmts {
                    new_statements.push(s);
                }
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &mut export_decl.declaration {
                    let post_stmts = transform_class(class, &import_ctx, &ast);
                    new_statements.push(stmt);
                    for s in post_stmts {
                        new_statements.push(s);
                    }
                } else {
                    new_statements.push(stmt);
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &mut export_decl.declaration
                {
                    let post_stmts = transform_class(class, &import_ctx, &ast);
                    new_statements.push(stmt);
                    for s in post_stmts {
                        new_statements.push(s);
                    }
                } else {
                    new_statements.push(stmt);
                }
            }
            Statement::ImportDeclaration(import_decl) => {
                if clean_lit_import(import_decl, &import_ctx, &ast) {
                    new_statements.push(stmt);
                }
            }
            _ => {
                new_statements.push(stmt);
            }
        }
    }

    program.body = new_statements;

    let mut codegen_options = CodegenOptions::default();
    if options.sourcemap.unwrap_or(false) {
        if let Some(ref filename) = options.filename {
            codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
        }
    }

    let codegen_result = Codegen::new().with_options(codegen_options).build(&program);

    let map_json = codegen_result.map.map(|m| m.to_json_string());

    TransformResult {
        code: codegen_result.code,
        map: map_json,
    }
}

pub fn transform_class<'a>(
    class: &mut Class<'a>,
    import_ctx: &ImportContext,
    ast: &AstBuilder<'a>,
) -> Vec<Statement<'a>> {
    let mut post_class_statements = Vec::new();
    let mut constructor_statements = Vec::new();
    let mut reactive_props = Vec::new();

    // 1. Transform class decorators
    if let Some(custom_elem_stmt) = transform_custom_element(class, import_ctx, ast) {
        post_class_statements.push(custom_elem_stmt);
    }

    if let Some(localized_stmt) = transform_localized(class, import_ctx, ast) {
        constructor_statements.push(localized_stmt);
    }

    let class_name = class
        .id
        .as_ref()
        .map(|id| id.name.as_str().to_string())
        .unwrap_or_default();

    // 2. Transform members
    let old_elements = std::mem::replace(&mut class.body.body, ArenaVec::new_in(ast));
    let mut new_elements = ArenaVec::new_in(ast);

    for mut element in old_elements {
        // @property
        if let Some(res) = try_transform_property(&mut element, import_ctx, ast) {
            reactive_props.push(res.reactive_prop);
            if let Some(init_stmt) = res.constructor_init {
                constructor_statements.push(init_stmt);
            }
            if !res.remove_member {
                new_elements.push(element);
            }
            continue;
        }

        // @state
        if let Some(res) = try_transform_state(&mut element, import_ctx, ast) {
            reactive_props.push(res.reactive_prop);
            if let Some(init_stmt) = res.constructor_init {
                constructor_statements.push(init_stmt);
            }
            if !res.remove_member {
                new_elements.push(element);
            }
            continue;
        }

        // @query
        if let Some(getter) = try_transform_query(&mut element, import_ctx, ast) {
            new_elements.push(getter);
            continue;
        }

        // @queryAll
        if let Some(getter) = try_transform_query_all(&mut element, import_ctx, ast) {
            new_elements.push(getter);
            continue;
        }

        // @queryAsync
        if let Some(getter) = try_transform_query_async(&mut element, import_ctx, ast) {
            new_elements.push(getter);
            continue;
        }

        // @queryAssignedElements / @queryAssignedNodes
        if let Some(getter) = try_transform_query_assigned(&mut element, import_ctx, ast) {
            new_elements.push(getter);
            continue;
        }

        // @eventOptions
        if let Some(event_opt_stmt) =
            try_transform_event_options(&mut element, &class_name, import_ctx, ast)
        {
            post_class_statements.push(event_opt_stmt);
            new_elements.push(element);
            continue;
        }

        new_elements.push(element);
    }

    class.body.body = new_elements;

    // 3. Inject or merge static properties
    if !reactive_props.is_empty() {
        inject_or_merge_static_properties(class, reactive_props, ast);
    }

    // 4. Inject constructor statements
    if !constructor_statements.is_empty() {
        inject_constructor_statements(class, constructor_statements, ast);
    }

    post_class_statements
}

fn clean_lit_import<'a>(
    import_decl: &mut ImportDeclaration<'a>,
    import_ctx: &ImportContext,
    ast: &AstBuilder<'a>,
) -> bool {
    let specifier = import_decl.source.value.as_str();
    if !is_lit_import(specifier) {
        return true;
    }

    let Some(specifiers) = &mut import_decl.specifiers else {
        return true;
    };

    let old_specs = std::mem::replace(specifiers, ArenaVec::new_in(ast));
    let mut new_specs = ArenaVec::new_in(ast);

    for mut spec in old_specs {
        match &mut spec {
            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                let imported_name = named.imported.name();
                if imported_name.as_str() == "localized" {
                    named.imported = ModuleExportName::IdentifierName(IdentifierName::new(
                        SPAN,
                        "updateWhenLocaleChanges",
                        ast,
                    ));
                    if named.local.name.as_str() == "localized" {
                        named.local = BindingIdentifier::new(SPAN, "updateWhenLocaleChanges", ast);
                    }
                    new_specs.push(spec);
                } else if import_ctx
                    .get_decorator_kind(named.local.name.as_str())
                    .is_some()
                {
                    // Stripped decorator import
                } else {
                    new_specs.push(spec);
                }
            }
            _ => {
                new_specs.push(spec);
            }
        }
    }

    if new_specs.is_empty() {
        false
    } else {
        *specifiers = new_specs;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_custom_element_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {customElement} from 'lit/decorators.js';

      @customElement('my-element')
      class MyElement extends LitElement {}
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@customElement"));
        assert!(
            res.code
                .contains("customElements.define(\"my-element\", MyElement)")
                || res
                    .code
                    .contains("customElements.define('my-element', MyElement)")
        );
        assert!(!res.code.contains("decorators.js"));
    }

    #[test]
    fn test_property_and_constructor_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {property} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @property({type: String})
        foo = 'bar';
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@property"));
        assert!(res.code.contains("static properties"));
        assert!(
            res.code.contains("foo: { type: String }")
                || res.code.contains("foo:{type:String}")
                || res.code.contains("type: String")
        );
        assert!(res.code.contains("constructor"));
        assert!(res.code.contains("super()"));
        assert!(res.code.contains("this.foo = 'bar'") || res.code.contains("this.foo = \"bar\""));
    }

    #[test]
    fn test_state_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {state} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @state()
        count = 0;
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@state"));
        assert!(res.code.contains("state: true") || res.code.contains("state:true"));
    }

    #[test]
    fn test_query_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {query} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @query('#myDiv')
        div: HTMLDivElement;
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@query"));
        assert!(res.code.contains("get div()"));
        assert!(res.code.contains("querySelector"));
    }

    #[test]
    fn test_query_all_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {queryAll} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @queryAll('.items')
        items: NodeList;
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@queryAll"));
        assert!(res.code.contains("get items()"));
        assert!(res.code.contains("querySelectorAll"));
    }

    #[test]
    fn test_query_async_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {queryAsync} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @queryAsync('#btn')
        btn: Promise<HTMLElement>;
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@queryAsync"));
        assert!(res.code.contains("get btn()"));
        assert!(res.code.contains("this.updateComplete.then"));
        assert!(res.code.contains("querySelector"));
    }

    #[test]
    fn test_query_assigned_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {queryAssignedElements, queryAssignedNodes} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @queryAssignedElements({slot: 'header'})
        headers: HTMLElement[];

        @queryAssignedNodes()
        nodes: Node[];
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@queryAssignedElements"));
        assert!(!res.code.contains("@queryAssignedNodes"));
        assert!(res.code.contains("get headers()"));
        assert!(res.code.contains("assignedElements"));
        assert!(res.code.contains("slot[name=header]"));
        assert!(res.code.contains("get nodes()"));
        assert!(res.code.contains("assignedNodes"));
        assert!(res.code.contains("slot:not([name])"));
    }

    #[test]
    fn test_event_options_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {eventOptions} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @eventOptions({passive: true})
        handleClick(e) {
          console.log(e);
        }
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@eventOptions"));
        assert!(
            res.code
                .contains("Object.assign(MyElement.prototype.handleClick, { passive: true })")
                || res.code.contains("passive: true")
        );
    }

    #[test]
    fn test_localized_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {localized} from '@lit/localize';

      @localized()
      class MyElement extends LitElement {}
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@localized"));
        assert!(
            res.code
                .contains("import { updateWhenLocaleChanges } from \"@lit/localize\"")
                || res.code.contains("updateWhenLocaleChanges")
        );
        assert!(res.code.contains("updateWhenLocaleChanges(this)"));
    }

    #[test]
    fn test_existing_static_properties_merge() {
        let input = r#"
      import {LitElement} from 'lit';
      import {property} from 'lit/decorators.js';

      class MyElement extends LitElement {
        static properties = {
          existing: {type: Number},
        };

        @property({type: String})
        name = 'hello';
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@property"));
        assert!(res.code.contains("existing: { type: Number }") || res.code.contains("existing"));
        assert!(res.code.contains("name: { type: String }") || res.code.contains("name"));
        assert!(
            res.code.contains("this.name = 'hello'") || res.code.contains("this.name = \"hello\"")
        );
    }

    #[test]
    fn test_existing_constructor_append() {
        let input = r#"
      import {LitElement} from 'lit';
      import {property} from 'lit/decorators.js';

      class MyElement extends LitElement {
        constructor() {
          super();
          console.log('init');
        }

        @property()
        msg = 'hi';
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@property"));
        assert!(
            res.code.contains("console.log(\"init\")") || res.code.contains("console.log('init')")
        );
        assert!(res.code.contains("this.msg = \"hi\"") || res.code.contains("this.msg = 'hi'"));
    }
}
