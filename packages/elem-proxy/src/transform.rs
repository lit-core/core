use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
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
    class_span: (usize, usize),
    decorator_span: Option<(usize, usize)>,
    define_stmt_span: Option<(usize, usize)>,
    is_export: bool,
    is_default_export: bool,
    export_prefix_len: usize,
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

pub fn transform_code(source: &str, options: ElemProxyOptions) -> ElemProxyResult {
    let allocator = Allocator::default();
    let filename = options.filename.as_deref().unwrap_or("file.ts");
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());

    let parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return ElemProxyResult {
            code: source.to_string(),
            map: None,
            proxied_elements_count: 0,
            elements: Vec::new(),
        };
    }

    let program = &parsed.program;

    // Scan for customElements.define calls
    let mut define_calls: HashMap<String, (String, (usize, usize))> = HashMap::new(); // class_name -> (tag_name, span)
    for stmt in &program.body {
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
                    let tag = if let Some(Expression::StringLiteral(s)) =
                        call.arguments[0].as_expression()
                    {
                        Some(s.value.as_str().to_string())
                    } else {
                        None
                    };
                    let cls = if let Some(Expression::Identifier(id)) =
                        call.arguments[1].as_expression()
                    {
                        Some(id.name.as_str().to_string())
                    } else {
                        None
                    };
                    if let (Some(tag), Some(cls)) = (tag, cls) {
                        define_calls.insert(
                            cls,
                            (
                                tag,
                                (expr_stmt.span.start as usize, expr_stmt.span.end as usize),
                            ),
                        );
                    }
                }
            }
        }
    }

    let mut targets: Vec<CustomElementTarget> = Vec::new();

    // Scan classes in program body
    for stmt in &program.body {
        match stmt {
            Statement::ClassDeclaration(class) => {
                if let Some(target) = check_and_extract_target(class, false, false, 0, &define_calls) {
                    targets.push(target);
                }
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &export_decl.declaration {
                    let prefix_len = (class.span.start - export_decl.span.start) as usize;
                    if let Some(target) =
                        check_and_extract_target(class, true, false, prefix_len, &define_calls)
                    {
                        targets.push(target);
                    }
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &export_decl.declaration
                {
                    let prefix_len = (class.span.start - export_decl.span.start) as usize;
                    if let Some(target) =
                        check_and_extract_target(class, true, true, prefix_len, &define_calls)
                    {
                        targets.push(target);
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

    // Build rewritten code
    let mut rewritten = source.to_string();

    // Sort targets by span start descending so replacements don't invalidate offsets
    // First, collect all replacement regions:
    // A replacement region has (start, end, replacement_str)
    let mut replacements: Vec<(usize, usize, String)> = Vec::new();

    for target in &targets {
        let class_start = target.class_span.0;
        let class_end = target.class_span.1;

        // If exported, start from the export keyword
        let full_start = if target.is_export {
            class_start - target.export_prefix_len
        } else {
            class_start
        };

        // Extract class content without export prefix
        let mut class_source = source[class_start..class_end].to_string();

        // If there was a decorator, remove it from class_source
        if let Some((dec_start, dec_end)) = target.decorator_span {
            let rel_start = dec_start - class_start;
            let rel_end = dec_end - class_start;
            if rel_end <= class_source.len() {
                // remove decorator and any leading/trailing whitespace
                let before = &class_source[..rel_start];
                let after = &class_source[rel_end..];
                class_source = format!("{}{}", before.trim_end(), after);
            }
        }

        // Build proxy stub and implementation closure
        let proxy_name = format!("{}Proxy", target.class_name);
        let getter_name = format!("__getImpl_{}", target.class_name);
        let impl_var = format!("__impl_{}", target.class_name);
        let props_var = format!("__props_{}", target.class_name);

        let observed_attrs_json =
            serde_json::to_string(&target.observed_attributes).unwrap_or_else(|_| "[]".to_string());
        let properties_json =
            serde_json::to_string(&target.properties).unwrap_or_else(|_| "[]".to_string());

        let export_stmt = if target.is_default_export {
            format!("export default {proxy_name};\n")
        } else if target.is_export {
            format!("export {{ {proxy_name} as {} }};\n", target.class_name)
        } else {
            String::new()
        };

        let replacement = format!(
            r#"let {impl_var} = null;
function {getter_name}() {{
  if (!{impl_var}) {{
    {class_source}
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
            class_source = class_source,
            class_name = target.class_name,
            proxy_name = proxy_name,
            observed_attrs_json = observed_attrs_json,
            props_var = props_var,
            properties_json = properties_json,
            tag_name = target.tag_name,
            export_stmt = export_stmt,
        );

        replacements.push((full_start, class_end, replacement));

        // If there was an external customElements.define statement, remove it because we define the proxy above
        if let Some((def_start, def_end)) = target.define_stmt_span {
            replacements.push((def_start, def_end, String::new()));
        }
    }

    // Sort replacements descending by start position
    replacements.sort_by(|a, b| b.0.cmp(&a.0));

    for (start, end, repl) in replacements {
        if start <= end && end <= rewritten.len() {
            rewritten.replace_range(start..end, &repl);
        }
    }

    let elements_info: Vec<ProxiedElementInfo> = targets
        .into_iter()
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
    export_prefix_len: usize,
    define_calls: &HashMap<String, (String, (usize, usize))>,
) -> Option<CustomElementTarget> {
    let class_name = class.id.as_ref().map(|id| id.name.as_str().to_string())?;

    let mut tag_name: Option<String> = None;
    let mut dec_span: Option<(usize, usize)> = None;

    for dec in &class.decorators {
        if let Some(tag) = extract_decorator_tag(dec) {
            tag_name = Some(tag);
            dec_span = Some((dec.span.start as usize, dec.span.end as usize));
            break;
        }
    }

    let mut define_span: Option<(usize, usize)> = None;
    if tag_name.is_none() {
        if let Some((tag, span)) = define_calls.get(&class_name) {
            tag_name = Some(tag.clone());
            define_span = Some(*span);
        }
    }

    let tag = tag_name?;

    let mut properties = Vec::new();
    let mut observed_attributes = Vec::new();
    extract_class_properties(class, &mut properties, &mut observed_attributes);

    Some(CustomElementTarget {
        tag_name: tag,
        class_name,
        class_span: (class.span.start as usize, class.span.end as usize),
        decorator_span: dec_span,
        define_stmt_span: define_span,
        is_export,
        is_default_export,
        export_prefix_len,
        properties,
        observed_attributes,
    })
}
