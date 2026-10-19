use oxc_ast::ast::*;
use oxc_semantic::Scoping;
use std::collections::{HashMap, HashSet};

pub fn is_canonical_lit_specifier(src: &str) -> bool {
    src == "lit"
        || src.starts_with("lit/")
        || src == "lit-html"
        || src.starts_with("lit-html/")
        || src == "lit-element"
        || src.starts_with("lit-element/")
        || src == "@lit/reactive-element"
        || src.starts_with("@lit/reactive-element/")
        || src.starts_with("@lit/")
}

#[derive(Clone, Debug)]
pub struct LitSemanticAnalysis {
    pub has_imports: bool,
    pub lit_tag_names: HashSet<String>,
    pub lit_decorator_names: HashSet<String>,
    pub lit_class_names: HashSet<String>,
    pub lit_namespaces: HashSet<String>,
    pub lit_no_change_name: Option<String>,
    pub lit_directive_names: HashSet<String>,
}

pub fn is_directive_name(name: &str) -> bool {
    matches!(
        name,
        "classMap"
            | "styleMap"
            | "ifDefined"
            | "when"
            | "choose"
            | "map"
            | "join"
            | "range"
            | "guard"
            | "live"
            | "keyed"
            | "cache"
            | "repeat"
            | "templateContent"
            | "unsafeHTML"
            | "unsafeSVG"
            | "unsafeMathML"
            | "until"
            | "asyncAppend"
            | "asyncReplace"
            | "ref"
    )
}

pub fn get_class_name<'a>(class: &Class<'a>) -> Option<&'a str> {
    class.id.as_ref().map(|id| id.name.as_str())
}

pub fn get_super_class_name<'a>(class: &Class<'a>) -> Option<&'a str> {
    if let Some(ref heritage) = class.heritage {
        match &heritage.expression {
            Expression::Identifier(ident) => Some(ident.name.as_str()),
            _ => None,
        }
    } else {
        None
    }
}

pub fn collect_named_classes<'a, 'b>(stmts: &'b [Statement<'a>]) -> Vec<(&'a str, &'b Class<'a>)> {
    let mut out = Vec::new();
    for stmt in stmts {
        match stmt {
            Statement::ClassDeclaration(class) => {
                if let Some(name) = get_class_name(class) {
                    out.push((name, class.as_ref()));
                }
            }
            Statement::ExportDeclaration(export_decl) => match &export_decl.declaration {
                Declaration::ClassDeclaration(class) => {
                    if let Some(name) = get_class_name(class) {
                        out.push((name, class.as_ref()));
                    }
                }
                Declaration::VariableDeclaration(var_decl) => {
                    for decl in &var_decl.declarations {
                        if let Some(Expression::ClassExpression(class)) = &decl.init {
                            if let Some(name) = get_class_name(class) {
                                out.push((name, class.as_ref()));
                            } else if let BindingPattern::BindingIdentifier(id) = &decl.id {
                                out.push((id.name.as_str(), class.as_ref()));
                            }
                        }
                    }
                }
                _ => {}
            },
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &export_decl.declaration
                {
                    if let Some(name) = get_class_name(class) {
                        out.push((name, class.as_ref()));
                    }
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &var_decl.declarations {
                    if let Some(Expression::ClassExpression(class)) = &decl.init {
                        if let Some(name) = get_class_name(class) {
                            out.push((name, class.as_ref()));
                        } else if let BindingPattern::BindingIdentifier(id) = &decl.id {
                            out.push((id.name.as_str(), class.as_ref()));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    out
}

impl LitSemanticAnalysis {
    pub fn new(program: &Program, scoping: &Scoping) -> Self {
        let mut analysis = Self {
            has_imports: false,
            lit_tag_names: HashSet::new(),
            lit_decorator_names: HashSet::new(),
            lit_class_names: HashSet::new(),
            lit_namespaces: HashSet::new(),
            lit_no_change_name: None,
            lit_directive_names: HashSet::new(),
        };

        let root = scoping.root_scope_id();

        for stmt in &program.body {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                analysis.has_imports = true;
                let src = import_decl.source.value.as_str();
                if is_canonical_lit_specifier(src) {
                    if let Some(specifiers) = &import_decl.specifiers {
                        for spec in specifiers {
                            match spec {
                                ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                    let imported_name = named.imported.name();
                                    let local_name = named.local.name.as_str().to_string();
                                    let sym_id = named.local.symbol_id.get().or_else(|| {
                                        scoping.get_binding(root, named.local.name.as_str().into())
                                    });
                                    if sym_id.is_some() {
                                        if imported_name == "html" || imported_name == "svg" {
                                            analysis.lit_tag_names.insert(local_name.clone());
                                        } else if imported_name == "property"
                                            || imported_name == "state"
                                        {
                                            analysis.lit_decorator_names.insert(local_name.clone());
                                        } else if imported_name == "LitElement"
                                            || imported_name == "ReactiveElement"
                                        {
                                            analysis.lit_class_names.insert(local_name.clone());
                                        } else if imported_name == "noChange" {
                                            analysis.lit_no_change_name = Some(local_name.clone());
                                        }

                                        if is_directive_name(imported_name.as_str())
                                            || src.contains("directive")
                                        {
                                            analysis.lit_directive_names.insert(local_name);
                                        }
                                    }
                                }
                                ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                    let sym_id = ns.local.symbol_id.get().or_else(|| {
                                        scoping.get_binding(root, ns.local.name.as_str().into())
                                    });
                                    if sym_id.is_some() {
                                        analysis
                                            .lit_namespaces
                                            .insert(ns.local.name.as_str().to_string());
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }

        if !analysis.has_imports {
            analysis.lit_class_names.insert("LitElement".to_string());
            analysis
                .lit_class_names
                .insert("ReactiveElement".to_string());
        }

        let named_classes = collect_named_classes(&program.body);
        let mut changed = true;
        while changed {
            changed = false;
            for (name, class) in &named_classes {
                if !analysis.lit_class_names.contains(*name) {
                    let (is_reactive, _) = analysis.is_reactive_class(class);
                    if is_reactive {
                        analysis.lit_class_names.insert((*name).to_string());
                        changed = true;
                    }
                }
            }
        }

        analysis
    }

    pub fn is_lit_tag(&self, expr: &Expression) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                if self.has_imports {
                    self.lit_tag_names.contains(ident.name.as_str())
                } else {
                    ident.name == "html" || ident.name == "svg"
                }
            }
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "html" || mem.property.name == "svg" {
                    if let Expression::Identifier(obj) = &mem.object {
                        if self.has_imports {
                            return self.lit_namespaces.contains(obj.name.as_str());
                        } else {
                            return true;
                        }
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn is_reactive_decorator(&self, expr: &Expression) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                if self.has_imports {
                    self.lit_decorator_names.contains(ident.name.as_str())
                } else {
                    ident.name == "property" || ident.name == "state"
                }
            }
            Expression::CallExpression(call) => self.is_reactive_decorator(&call.callee),
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "property" || mem.property.name == "state" {
                    if let Expression::Identifier(obj) = &mem.object {
                        if self.has_imports {
                            return self.lit_namespaces.contains(obj.name.as_str());
                        } else {
                            return true;
                        }
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn is_reactive_class(&self, class: &Class) -> (bool, bool) {
        if let Some(ref heritage) = class.heritage {
            let extends_reactive = match &heritage.expression {
                Expression::Identifier(ident) => {
                    self.lit_class_names.contains(ident.name.as_str())
                        || (!self.has_imports
                            && (ident.name == "LitElement" || ident.name == "ReactiveElement"))
                }
                Expression::StaticMemberExpression(mem)
                    if mem.property.name == "LitElement"
                        || mem.property.name == "ReactiveElement" =>
                {
                    if let Expression::Identifier(obj) = &mem.object {
                        if self.has_imports {
                            self.lit_namespaces.contains(obj.name.as_str())
                        } else {
                            true
                        }
                    } else {
                        false
                    }
                }
                _ => false,
            };
            (extends_reactive, extends_reactive)
        } else {
            (!self.has_imports, false)
        }
    }

    pub fn is_directive_call(&self, call: &CallExpression) -> bool {
        match &call.callee {
            Expression::Identifier(ident) => {
                if self.has_imports {
                    self.lit_directive_names.contains(ident.name.as_str())
                } else {
                    is_directive_name(ident.name.as_str())
                }
            }
            Expression::StaticMemberExpression(mem) => {
                if is_directive_name(mem.property.name.as_str()) {
                    if let Expression::Identifier(obj) = &mem.object {
                        if self.has_imports {
                            return self.lit_namespaces.contains(obj.name.as_str())
                                || self.lit_directive_names.contains(obj.name.as_str());
                        } else {
                            return true;
                        }
                    }
                }
                false
            }
            _ => false,
        }
    }
}

pub fn is_lit_html_tag(tag: &Expression) -> bool {
    match tag {
        Expression::Identifier(ident) => ident.name == "html" || ident.name == "svg",
        Expression::StaticMemberExpression(mem) => {
            mem.property.name == "html" || mem.property.name == "svg"
        }
        _ => false,
    }
}

pub fn is_reactive_decorator(expr: &Expression) -> bool {
    match expr {
        Expression::Identifier(ident) => ident.name == "property" || ident.name == "state",
        Expression::CallExpression(call) => match &call.callee {
            Expression::Identifier(ident) => ident.name == "property" || ident.name == "state",
            Expression::StaticMemberExpression(mem) => {
                mem.property.name == "property" || mem.property.name == "state"
            }
            _ => false,
        },
        Expression::StaticMemberExpression(mem) => {
            mem.property.name == "property" || mem.property.name == "state"
        }
        _ => false,
    }
}

pub fn get_root_this_prop(expr: &Expression) -> Option<String> {
    match expr {
        Expression::StaticMemberExpression(mem) => {
            if let Expression::ThisExpression(_) = &mem.object {
                Some(mem.property.name.to_string())
            } else {
                get_root_this_prop(&mem.object)
            }
        }
        Expression::ComputedMemberExpression(comp) => {
            if let Expression::ThisExpression(_) = &comp.object {
                None
            } else {
                get_root_this_prop(&comp.object)
            }
        }
        _ => None,
    }
}

pub fn analyze_expr_dependencies(
    expr: &Expression,
    reactive_props: &HashMap<String, usize>,
    accessed_bits: &mut u32,
    has_unknown: &mut bool,
) {
    if *has_unknown {
        return;
    }
    match expr {
        Expression::Identifier(ident) => {
            let name = ident.name.as_str();
            let is_safe_global = matches!(
                name,
                "undefined"
                    | "NaN"
                    | "Infinity"
                    | "null"
                    | "true"
                    | "false"
                    | "Math"
                    | "Number"
                    | "String"
                    | "Boolean"
                    | "Array"
                    | "Object"
                    | "JSON"
                    | "Date"
                    | "Intl"
                    | "RegExp"
            );
            if !is_safe_global {
                *has_unknown = true;
            }
        }
        Expression::ThisExpression(_) => {
            *has_unknown = true;
        }
        Expression::StaticMemberExpression(mem) => {
            if let Expression::ThisExpression(_) = &mem.object {
                let prop_name = mem.property.name.as_str();
                if let Some(&idx) = reactive_props.get(prop_name) {
                    if idx < 30 {
                        *accessed_bits |= 1 << idx;
                    } else {
                        *has_unknown = true;
                    }
                } else {
                    *has_unknown = true;
                }
            } else if let Some(prop_name) = get_root_this_prop(&mem.object) {
                if let Some(&idx) = reactive_props.get(prop_name.as_str()) {
                    if idx < 30 {
                        *accessed_bits |= 1 << idx;
                    } else {
                        *has_unknown = true;
                    }
                } else {
                    *has_unknown = true;
                }
            } else if let Expression::Identifier(ident) = &mem.object {
                let name = ident.name.as_str();
                if !matches!(name, "Math" | "Number" | "JSON" | "Intl") {
                    *has_unknown = true;
                }
            } else {
                *has_unknown = true;
            }
        }
        Expression::ComputedMemberExpression(comp) => {
            if let Some(prop_name) = get_root_this_prop(&comp.object) {
                if let Some(&idx) = reactive_props.get(prop_name.as_str()) {
                    if idx < 30 {
                        *accessed_bits |= 1 << idx;
                    } else {
                        *has_unknown = true;
                    }
                } else {
                    *has_unknown = true;
                }
            } else {
                *has_unknown = true;
            }
            analyze_expr_dependencies(&comp.expression, reactive_props, accessed_bits, has_unknown);
        }
        Expression::BinaryExpression(bin) => {
            analyze_expr_dependencies(&bin.left, reactive_props, accessed_bits, has_unknown);
            analyze_expr_dependencies(&bin.right, reactive_props, accessed_bits, has_unknown);
        }
        Expression::UnaryExpression(un) => {
            analyze_expr_dependencies(&un.argument, reactive_props, accessed_bits, has_unknown);
        }
        Expression::LogicalExpression(log) => {
            analyze_expr_dependencies(&log.left, reactive_props, accessed_bits, has_unknown);
            analyze_expr_dependencies(&log.right, reactive_props, accessed_bits, has_unknown);
        }
        Expression::ConditionalExpression(cond) => {
            analyze_expr_dependencies(&cond.test, reactive_props, accessed_bits, has_unknown);
            analyze_expr_dependencies(&cond.consequent, reactive_props, accessed_bits, has_unknown);
            analyze_expr_dependencies(&cond.alternate, reactive_props, accessed_bits, has_unknown);
        }
        Expression::ParenthesizedExpression(paren) => {
            analyze_expr_dependencies(
                &paren.expression,
                reactive_props,
                accessed_bits,
                has_unknown,
            );
        }
        Expression::TemplateLiteral(temp) => {
            for sub_expr in &temp.expressions {
                analyze_expr_dependencies(sub_expr, reactive_props, accessed_bits, has_unknown);
            }
        }
        Expression::ArrayExpression(arr) => {
            for elem in &arr.elements {
                if let Some(el_expr) = elem.as_expression() {
                    analyze_expr_dependencies(el_expr, reactive_props, accessed_bits, has_unknown);
                } else {
                    *has_unknown = true;
                }
            }
        }
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::RegExpLiteral(_) => {}
        _ => {
            *has_unknown = true;
        }
    }
}

pub fn compute_part_mask(expr: &Expression, reactive_props: &HashMap<String, usize>) -> i32 {
    let mut accessed_bits = 0u32;
    let mut has_unknown = false;
    analyze_expr_dependencies(expr, reactive_props, &mut accessed_bits, &mut has_unknown);
    if has_unknown || accessed_bits == 0 {
        -1
    } else {
        accessed_bits as i32
    }
}

pub fn collect_classes_mut<'a, 'b>(
    stmts: &'b mut [Statement<'a>],
    out: &mut Vec<(Option<&'a str>, &'b mut Class<'a>)>,
) {
    for stmt in stmts {
        match stmt {
            Statement::ClassDeclaration(class) => {
                let name = get_class_name(class);
                out.push((name, class));
            }
            Statement::ExportDeclaration(export_decl) => match &mut export_decl.declaration {
                Declaration::ClassDeclaration(class) => {
                    let name = get_class_name(class);
                    out.push((name, class));
                }
                Declaration::VariableDeclaration(var_decl) => {
                    for decl in &mut var_decl.declarations {
                        if let Some(Expression::ClassExpression(class)) = &mut decl.init {
                            let name = get_class_name(class).or_else(|| {
                                if let BindingPattern::BindingIdentifier(id) = &decl.id {
                                    Some(id.name.as_str())
                                } else {
                                    None
                                }
                            });
                            out.push((name, class));
                        }
                    }
                }
                _ => {}
            },
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &mut export_decl.declaration
                {
                    let name = get_class_name(class);
                    out.push((name, class));
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &mut var_decl.declarations {
                    if let Some(Expression::ClassExpression(class)) = &mut decl.init {
                        let name = get_class_name(class).or_else(|| {
                            if let BindingPattern::BindingIdentifier(id) = &decl.id {
                                Some(id.name.as_str())
                            } else {
                                None
                            }
                        });
                        out.push((name, class));
                    }
                }
            }
            _ => {}
        }
    }
}

pub type ReactiveProps = (HashMap<String, usize>, Vec<(String, usize)>);

pub fn collect_reactive_properties(
    class: &Class,
    ctx: Option<&LitSemanticAnalysis>,
) -> ReactiveProps {
    let mut prop_indices: HashMap<String, usize> = HashMap::new();
    let mut sorted_props: Vec<(String, usize)> = Vec::new();

    let check_decorator = |d: &Expression| -> bool {
        if let Some(c) = ctx {
            c.is_reactive_decorator(d)
        } else {
            is_reactive_decorator(d)
        }
    };

    let mut add_prop = |name: String| {
        if !prop_indices.contains_key(&name) {
            let idx = sorted_props.len();
            prop_indices.insert(name.clone(), idx);
            sorted_props.push((name, idx));
        }
    };

    for elem in &class.body.body {
        match elem {
            ClassElement::PropertyDefinition(prop_def) => {
                let is_static_properties = prop_def.r#static
                    && prop_def
                        .key
                        .static_name()
                        .map(|n| n == "properties")
                        .unwrap_or(false);

                if is_static_properties {
                    if let Some(Expression::ObjectExpression(obj)) = &prop_def.value {
                        for prop in &obj.properties {
                            if let ObjectPropertyKind::ObjectProperty(p) = prop {
                                if let Some(name) = p.key.static_name() {
                                    add_prop(name.to_string());
                                }
                            }
                        }
                    }
                } else {
                    let has_reactive_decorator = prop_def
                        .decorators
                        .iter()
                        .any(|d| check_decorator(&d.expression));

                    if has_reactive_decorator {
                        if let Some(name) = prop_def.key.static_name() {
                            add_prop(name.to_string());
                        }
                    }
                }
            }
            ClassElement::AccessorProperty(accessor_def) => {
                let has_reactive_decorator = accessor_def
                    .decorators
                    .iter()
                    .any(|d| check_decorator(&d.expression));

                if has_reactive_decorator {
                    if let Some(name) = accessor_def.key.static_name() {
                        add_prop(name.to_string());
                    }
                }
            }
            ClassElement::MethodDefinition(method_def) => {
                let is_static_get_properties = method_def.r#static
                    && method_def.kind == MethodDefinitionKind::Get
                    && method_def
                        .key
                        .static_name()
                        .map(|n| n == "properties")
                        .unwrap_or(false);

                if is_static_get_properties {
                    if let Some(body) = &method_def.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt {
                                if let Some(Expression::ObjectExpression(obj)) = &ret.argument {
                                    for prop in &obj.properties {
                                        if let ObjectPropertyKind::ObjectProperty(p) = prop {
                                            if let Some(name) = p.key.static_name() {
                                                add_prop(name.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    let has_reactive_decorator = method_def
                        .decorators
                        .iter()
                        .any(|d| check_decorator(&d.expression));

                    if has_reactive_decorator {
                        if let Some(name) = method_def.key.static_name() {
                            add_prop(name.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }

    (prop_indices, sorted_props)
}

pub fn collect_reactive_properties_with_inheritance<'a>(
    class: &Class<'a>,
    classes_by_name: &HashMap<&str, &Class<'a>>,
    external_props: Option<&HashMap<String, Vec<String>>>,
    ctx: Option<&LitSemanticAnalysis>,
) -> ReactiveProps {
    collect_reactive_properties_with_inheritance_named(
        class,
        classes_by_name,
        external_props,
        ctx,
        None,
    )
}

pub fn collect_reactive_properties_with_inheritance_named<'a>(
    class: &Class<'a>,
    classes_by_name: &HashMap<&str, &Class<'a>>,
    external_props: Option<&HashMap<String, Vec<String>>>,
    ctx: Option<&LitSemanticAnalysis>,
    class_name: Option<&str>,
) -> ReactiveProps {
    let mut ancestors = Vec::new();
    let mut current_super = get_super_class_name(class);
    let mut visited = HashSet::new();
    let effective_name = class_name.or_else(|| get_class_name(class));
    if let Some(name) = effective_name {
        visited.insert(name);
    }

    while let Some(super_name) = current_super {
        if !visited.insert(super_name) {
            break;
        }
        if let Some(&super_class) = classes_by_name.get(super_name) {
            ancestors.push((super_name, super_class));
            current_super = get_super_class_name(super_class);
        } else {
            break;
        }
    }

    ancestors.reverse();

    let mut prop_indices: HashMap<String, usize> = HashMap::new();
    let mut sorted_props: Vec<(String, usize)> = Vec::new();

    let mut add_prop = |name: String| {
        if !prop_indices.contains_key(&name) {
            let idx = sorted_props.len();
            prop_indices.insert(name.clone(), idx);
            sorted_props.push((name, idx));
        }
    };

    // 1. Inherit properties from all ancestor classes in order (oldest first)
    for (anc_name, anc_class) in ancestors {
        let (_, anc_sorted) = collect_reactive_properties(anc_class, ctx);
        for (prop_name, _) in anc_sorted {
            add_prop(prop_name);
        }
        if let Some(ext) = external_props {
            if let Some(extra) = ext.get(anc_name) {
                for prop_name in extra {
                    add_prop(prop_name.clone());
                }
            }
        }
    }

    // 2. Add class's own properties
    let (_, own_sorted) = collect_reactive_properties(class, ctx);
    for (prop_name, _) in own_sorted {
        add_prop(prop_name);
    }
    if let Some(ext) = external_props {
        if let Some(name) = effective_name {
            if let Some(extra) = ext.get(name) {
                for prop_name in extra {
                    add_prop(prop_name.clone());
                }
            }
        }
    }

    (prop_indices, sorted_props)
}
