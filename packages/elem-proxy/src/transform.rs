use napi_derive::napi;
use oxc_allocator::{Allocator, Box as ArenaBox, Vec as ArenaVec};
use oxc_ast::ast::*;
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

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

#[derive(Debug, Clone)]
struct CustomElementTarget {
    tag_name: String,
    class_name: String,
    is_export: bool,
    is_default_export: bool,
    properties: Vec<String>,
    observed_attributes: Vec<String>,
}

fn extract_decorator_tag<'a>(dec: &Decorator<'a>) -> Option<String> {
    if let Expression::CallExpression(call) = &dec.expression {
        let is_custom_element = match &call.callee {
            Expression::Identifier(ident) => ident.name == "customElement",
            Expression::StaticMemberExpression(mem) => mem.property.name == "customElement",
            _ => false,
        };
        if is_custom_element {
            if let Some(first_arg) = call.arguments.first() {
                if let Some(Expression::StringLiteral(str_lit)) = first_arg.as_expression() {
                    return Some(str_lit.value.as_str().to_string());
                }
            }
        }
    }
    None
}

fn extract_class_properties<'a>(
    class: &Class<'a>,
    out_properties: &mut Vec<String>,
    out_attributes: &mut Vec<String>,
) {
    let mut prop_set = HashSet::new();
    let mut attr_set = HashSet::new();

    for elem in &class.body.body {
        match elem {
            ClassElement::PropertyDefinition(prop) => {
                let prop_name = match &prop.key {
                    PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str().to_string()),
                    PropertyKey::StringLiteral(lit) => Some(lit.value.as_str().to_string()),
                    _ => None,
                };

                if let Some(name) = prop_name {
                    let mut is_lit_prop = false;
                    let mut observes_attr = true;
                    let mut custom_attr_name: Option<String> = None;

                    for dec in &prop.decorators {
                        if let Expression::CallExpression(call) = &dec.expression {
                            let callee_name = match &call.callee {
                                Expression::Identifier(id) => Some(id.name.as_str()),
                                Expression::StaticMemberExpression(mem) => {
                                    Some(mem.property.name.as_str())
                                }
                                _ => None,
                            };

                            if callee_name == Some("property") {
                                is_lit_prop = true;
                                if let Some(arg) = call.arguments.first() {
                                    if let Some(Expression::ObjectExpression(obj)) =
                                        arg.as_expression()
                                    {
                                        for p in &obj.properties {
                                            if let ObjectPropertyKind::ObjectProperty(prop_kv) = p {
                                                let k_name = match &prop_kv.key {
                                                    PropertyKey::StaticIdentifier(id) => {
                                                        Some(id.name.as_str())
                                                    }
                                                    PropertyKey::StringLiteral(lit) => {
                                                        Some(lit.value.as_str())
                                                    }
                                                    _ => None,
                                                };

                                                if k_name == Some("attribute") {
                                                    match &prop_kv.value {
                                                        Expression::BooleanLiteral(b) => {
                                                            if !b.value {
                                                                observes_attr = false;
                                                            }
                                                        }
                                                        Expression::StringLiteral(s) => {
                                                            custom_attr_name =
                                                                Some(s.value.as_str().to_string());
                                                        }
                                                        _ => {}
                                                    }
                                                } else if k_name == Some("state") {
                                                    if let Expression::BooleanLiteral(b) =
                                                        &prop_kv.value
                                                    {
                                                        if b.value {
                                                            observes_attr = false;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            } else if callee_name == Some("state") {
                                is_lit_prop = true;
                                observes_attr = false;
                            }
                        }
                    }

                    if is_lit_prop {
                        prop_set.insert(name.clone());
                        if observes_attr {
                            let attr =
                                custom_attr_name.unwrap_or_else(|| name.to_ascii_lowercase());
                            attr_set.insert(attr);
                        }
                    }
                }
            }
            _ => {}
        }

        // Also check static properties definition: static properties = { ... }
        if let ClassElement::PropertyDefinition(prop) = elem {
            if prop.r#static {
                let key_name = match &prop.key {
                    PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                    PropertyKey::StringLiteral(lit) => Some(lit.value.as_str()),
                    _ => None,
                };
                if key_name == Some("properties") {
                    if let Some(Expression::ObjectExpression(obj)) = &prop.value {
                        inspect_properties_object(obj, &mut prop_set, &mut attr_set);
                    }
                }
            }
        }

        // Also check static get properties() { return { ... }; }
        if let ClassElement::MethodDefinition(method) = elem {
            if method.r#static && method.kind == MethodDefinitionKind::Get {
                let name = match &method.key {
                    PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
                    PropertyKey::StringLiteral(lit) => Some(lit.value.as_str()),
                    _ => None,
                };
                if name == Some("properties") {
                    if let Some(body) = &method.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt {
                                if let Some(Expression::ObjectExpression(obj)) = &ret.argument {
                                    inspect_properties_object(obj, &mut prop_set, &mut attr_set);
                                }
                            }
                        }
                    }
                } else if name == Some("observedAttributes") {
                    if let Some(body) = &method.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt {
                                if let Some(Expression::ArrayExpression(arr)) = &ret.argument {
                                    for elem in &arr.elements {
                                        if let Some(Expression::StringLiteral(str_lit)) =
                                            elem.as_expression()
                                        {
                                            attr_set.insert(str_lit.value.as_str().to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut props: Vec<String> = prop_set.into_iter().collect();
    props.sort();
    let mut attrs: Vec<String> = attr_set.into_iter().collect();
    attrs.sort();

    *out_properties = props;
    *out_attributes = attrs;
}

fn inspect_properties_object<'a>(
    obj: &ObjectExpression<'a>,
    prop_set: &mut HashSet<String>,
    attr_set: &mut HashSet<String>,
) {
    for prop in &obj.properties {
        if let ObjectPropertyKind::ObjectProperty(prop_kv) = prop {
            let p_name = match &prop_kv.key {
                PropertyKey::StaticIdentifier(id) => Some(id.name.as_str().to_string()),
                PropertyKey::StringLiteral(lit) => Some(lit.value.as_str().to_string()),
                _ => None,
            };
            if let Some(name) = p_name {
                prop_set.insert(name.clone());
                let mut observes_attr = true;
                let mut custom_attr: Option<String> = None;

                if let Expression::ObjectExpression(inner_obj) = &prop_kv.value {
                    for inner_prop in &inner_obj.properties {
                        if let ObjectPropertyKind::ObjectProperty(inner_kv) = inner_prop {
                            let k = match &inner_kv.key {
                                PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
                                PropertyKey::StringLiteral(lit) => Some(lit.value.as_str()),
                                _ => None,
                            };
                            if k == Some("attribute") {
                                match &inner_kv.value {
                                    Expression::BooleanLiteral(b) => {
                                        if !b.value {
                                            observes_attr = false;
                                        }
                                    }
                                    Expression::StringLiteral(s) => {
                                        custom_attr = Some(s.value.as_str().to_string());
                                    }
                                    _ => {}
                                }
                            } else if k == Some("state") {
                                if let Expression::BooleanLiteral(b) = &inner_kv.value {
                                    if b.value {
                                        observes_attr = false;
                                    }
                                }
                            }
                        }
                    }
                }

                if observes_attr {
                    let attr = custom_attr.unwrap_or_else(|| name.to_ascii_lowercase());
                    attr_set.insert(attr);
                }
            }
        }
    }
}

fn generate_proxy_wrapper(target: &CustomElementTarget) -> String {
    let proxy_name = format!("{}Proxy", target.class_name);
    let getter_name = format!("__getImpl_{}", target.class_name);
    let impl_var = format!("__impl_{}", target.class_name);
    let props_var = format!("__props_{}", target.class_name);

    let observed_attrs_json =
        serde_json::to_string(&target.observed_attributes).unwrap_or_else(|_| "[]".to_string());
    let properties_json =
        serde_json::to_string(&target.properties).unwrap_or_else(|_| "[]".to_string());

    let export_stmt = if target.is_default_export {
        format!("export default {};\n", proxy_name)
    } else if target.is_export {
        format!("export {{ {} as {} }};\n", proxy_name, target.class_name)
    } else {
        String::new()
    };

    format!(
        r#"let {impl_var} = null;
function {getter_name}() {{
  if (!{impl_var}) {{
    {impl_var} = {class_name};
  }}
  return {impl_var};
}}
class {proxy_name} extends HTMLElement {{
  static get observedAttributes() {{
    return {observed_attrs_json};
  }}
  static [Symbol.hasInstance](instance) {{
    const Impl = {getter_name}();
    return (Impl && instance instanceof Impl) || super[Symbol.hasInstance](instance);
  }}
  static getImplementation() {{
    return {getter_name}();
  }}
  constructor() {{
    super();
    this.__upgraded = false;
    this.__attrBuffer = null;
  }}
  attributeChangedCallback(name, oldValue, newValue) {{
    if (this.__upgraded) {{
      if (typeof super.attributeChangedCallback === 'function') {{
        super.attributeChangedCallback(name, oldValue, newValue);
      }}
    }} else {{
      if (!this.__attrBuffer) this.__attrBuffer = new Map();
      this.__attrBuffer.set(name, newValue);
    }}
  }}
  connectedCallback() {{
    this.__upgrade();
  }}
  __upgrade() {{
    if (this.__upgraded) return this;
    this.__upgraded = true;
    const RealClass = {getter_name}();
    if (!RealClass) return this;
    if (typeof RealClass.finalize === 'function') {{
      RealClass.finalize();
    }}
    Object.setPrototypeOf(this, RealClass.prototype);
    if (RealClass.elementStyles && !this.shadowRoot && typeof this.attachShadow === 'function') {{
      const root = this.attachShadow(RealClass.shadowRootOptions || {{ mode: 'open' }});
      if (Array.isArray(RealClass.elementStyles)) {{
        root.adoptedStyleSheets = RealClass.elementStyles.map((s) => s?.styleSheet || s).filter(Boolean);
      }} else if (RealClass.elementStyles?.styleSheet) {{
        root.adoptedStyleSheets = [RealClass.elementStyles.styleSheet];
      }}
    }}
    if (!this.renderOptions) {{
      this.renderOptions = {{ host: this }};
    }}
    if (typeof this._$Ev === 'function') {{
      this._$Ev();
    }} else if (typeof RealClass.prototype._$Ev === 'function') {{
      RealClass.prototype._$Ev.call(this);
    }}
    if (this.__attrBuffer) {{
      for (const [k, v] of this.__attrBuffer) {{
        if (typeof this.attributeChangedCallback === 'function') {{
          this.attributeChangedCallback(k, null, v);
        }}
      }}
      this.__attrBuffer = null;
    }}
    if (typeof RealClass.prototype.connectedCallback === 'function') {{
      RealClass.prototype.connectedCallback.call(this);
    }}
    return this;
  }}
}}
const {props_var} = {properties_json};
for (const __p of {props_var}) {{
  Object.defineProperty({proxy_name}.prototype, __p, {{
    get() {{
      this.__upgrade();
      return this[__p];
    }},
    set(__v) {{
      this.__upgrade();
      this[__p] = __v;
    }},
    configurable: true,
    enumerable: true
  }});
}}
customElements.define('{tag_name}', {proxy_name});
{export_stmt}"#,
        impl_var = impl_var,
        getter_name = getter_name,
        class_name = target.class_name,
        proxy_name = proxy_name,
        observed_attrs_json = observed_attrs_json,
        props_var = props_var,
        properties_json = properties_json,
        tag_name = target.tag_name,
        export_stmt = export_stmt,
    )
}

fn is_ce_define_for<'a>(stmt: &Statement<'a>, targets: &HashMap<String, CustomElementTarget>) -> bool {
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
                if let Some(Expression::Identifier(id)) = call.arguments[1].as_expression() {
                    return targets.contains_key(id.name.as_str());
                }
            }
        }
    }
    false
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
                    if let (Some(Expression::StringLiteral(s)), Some(Expression::Identifier(id))) =
                        (call.arguments[0].as_expression(), call.arguments[1].as_expression())
                    {
                        define_calls.insert(id.name.as_str().to_string(), s.value.as_str().to_string());
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
                    if let Some(target) =
                        check_and_extract_target(class, true, true, &define_calls)
                    {
                        targets.insert(target.class_name.clone(), target);
                    }
                }
            }
            _ => {}
        }
    }

    if targets.is_empty() {
        return ElemProxyResult {
            code: source.to_string(),
            map: None,
            proxied_elements_count: 0,
            elements: Vec::new(),
        };
    }

    let old_body = std::mem::replace(&mut parsed.program.body, ArenaVec::new_in(&&allocator));
    let mut new_body = ArenaVec::new_in(&&allocator);

    for stmt in old_body {
        if is_ce_define_for(&stmt, &targets) {
            continue;
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
                    class.decorators.retain(|d| extract_decorator_tag(d).is_none());
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
                        class.decorators.retain(|d| extract_decorator_tag(d).is_none());
                        class_to_wrap = Some(Statement::ClassDeclaration(class));
                    }
                } else {
                    new_body.push(Statement::ExportDeclaration(ArenaBox::new_in(export_decl, &&allocator)));
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
                        class.decorators.retain(|d| extract_decorator_tag(d).is_none());
                        class_to_wrap = Some(Statement::ClassDeclaration(class));
                    }
                } else {
                    new_body.push(Statement::ExportDefaultDeclaration(ArenaBox::new_in(export_decl, &&allocator)));
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
                                if let Statement::BlockStatement(ref mut block) =
                                    if_stmt.consequent
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

    let elements_info: Vec<ProxiedElementInfo> = targets
        .into_values()
        .map(|t| ProxiedElementInfo {
            tag_name: t.tag_name,
            class_name: t.class_name,
            properties: t.properties,
            observed_attributes: t.observed_attributes,
        })
        .collect();

    let count = elements_info.len() as u32;

    ElemProxyResult {
        code: rewritten,
        map: None,
        proxied_elements_count: count,
        elements: elements_info,
    }
}

fn check_and_extract_target<'a>(
    class: &Class<'a>,
    is_export: bool,
    is_default_export: bool,
    define_calls: &HashMap<String, String>,
) -> Option<CustomElementTarget> {
    let class_name = class.id.as_ref().map(|id| id.name.as_str().to_string())?;

    let mut tag_name: Option<String> = None;

    for dec in &class.decorators {
        if let Some(tag) = extract_decorator_tag(dec) {
            tag_name = Some(tag);
            break;
        }
    }

    if tag_name.is_none() {
        if let Some(tag) = define_calls.get(&class_name) {
            tag_name = Some(tag.clone());
        }
    }

    let tag = tag_name?;

    let mut properties = Vec::new();
    let mut observed_attributes = Vec::new();
    extract_class_properties(class, &mut properties, &mut observed_attributes);

    Some(CustomElementTarget {
        tag_name: tag,
        class_name,
        is_export,
        is_default_export,
        properties,
        observed_attributes,
    })
}
