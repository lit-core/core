use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use std::collections::HashSet;

pub const PURE_ARRAY_METHODS: &[&str] = &["map", "filter", "slice", "reduce", "flatMap"];

pub const MUTATING_ARRAY_METHODS: &[&str] = &[
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "reverse",
    "fill",
    "copyWithin",
];

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
    pub has_lit_imports: bool,
    pub has_any_imports: bool,
    pub lit_tag_names: HashSet<String>,
    pub lit_class_names: HashSet<String>,
    pub lit_namespaces: HashSet<String>,
}

impl LitSemanticAnalysis {
    pub fn new(program: &Program, scoping: &Scoping) -> Self {
        let mut analysis = Self {
            has_lit_imports: false,
            has_any_imports: false,
            lit_tag_names: HashSet::new(),
            lit_class_names: HashSet::new(),
            lit_namespaces: HashSet::new(),
        };

        let root = scoping.root_scope_id();

        for stmt in &program.body {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                analysis.has_any_imports = true;
                let src = import_decl.source.value.as_str();
                if is_canonical_lit_specifier(src) {
                    analysis.has_lit_imports = true;
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
                                            analysis.lit_tag_names.insert(local_name);
                                        } else if imported_name == "LitElement"
                                            || imported_name == "ReactiveElement"
                                        {
                                            analysis.lit_class_names.insert(local_name);
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

        analysis
    }

    pub fn is_lit_tag(&self, expr: &Expression) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                if self.has_any_imports {
                    self.lit_tag_names.contains(ident.name.as_str())
                } else {
                    ident.name == "html" || ident.name == "svg"
                }
            }
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "html" || mem.property.name == "svg" {
                    if let Expression::Identifier(obj) = &mem.object {
                        if self.has_any_imports {
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

    pub fn is_lit_class(&self, class: &Class) -> bool {
        if let Some(ref heritage) = class.heritage {
            match &heritage.expression {
                Expression::Identifier(ident) => {
                    if self.has_any_imports {
                        self.lit_class_names.contains(ident.name.as_str())
                    } else {
                        ident.name == "LitElement" || ident.name == "ReactiveElement"
                    }
                }
                Expression::StaticMemberExpression(mem)
                    if mem.property.name == "LitElement"
                        || mem.property.name == "ReactiveElement" =>
                {
                    if let Expression::Identifier(obj) = &mem.object {
                        if self.has_any_imports {
                            self.lit_namespaces.contains(obj.name.as_str())
                        } else {
                            true
                        }
                    } else {
                        false
                    }
                }
                _ => false,
            }
        } else {
            !self.has_any_imports
        }
    }
}

pub const IMPURE_GLOBALS: &[&str] = &[
    "window",
    "document",
    "localStorage",
    "sessionStorage",
    "fetch",
    "XMLHttpRequest",
    "setTimeout",
    "setInterval",
    "requestAnimationFrame",
];

pub const DOM_QUERY_METHODS: &[&str] = &[
    "querySelector",
    "querySelectorAll",
    "getElementById",
    "getElementsByClassName",
    "getElementsByTagName",
    "getElementsByName",
    "closest",
];

#[derive(Clone, Debug)]
pub struct CandidateInfo {
    pub expr_start: usize,
    pub expr_end: usize,
    pub root_prop: String,
    pub dependencies: Vec<String>,
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

pub fn returns_fresh_array(expr: &Expression) -> bool {
    match expr {
        Expression::CallExpression(call) => {
            let method = match &call.callee {
                Expression::StaticMemberExpression(mem) => Some(mem.property.name.as_str()),
                Expression::ComputedMemberExpression(mem) => {
                    if let Expression::StringLiteral(s) = &mem.expression {
                        Some(s.value.as_str())
                    } else {
                        None
                    }
                }
                _ => None,
            };
            matches!(
                method,
                Some("map" | "filter" | "slice" | "flatMap" | "concat")
            )
        }
        Expression::ArrayExpression(_) => true,
        _ => false,
    }
}

/// Visitor to verify expression purity and extract dependencies on `this`
pub struct PurityAndDependencyVisitor {
    pub is_pure: bool,
    pub dependencies: Vec<String>,
}

impl PurityAndDependencyVisitor {
    pub fn new() -> Self {
        Self {
            is_pure: true,
            dependencies: Vec::new(),
        }
    }
}

impl Default for PurityAndDependencyVisitor {
    fn default() -> Self {
        Self::new()
    }
}

impl<'a> Visit<'a> for PurityAndDependencyVisitor {
    fn visit_assignment_expression(&mut self, _expr: &AssignmentExpression<'a>) {
        self.is_pure = false;
    }

    fn visit_update_expression(&mut self, _expr: &UpdateExpression<'a>) {
        self.is_pure = false;
    }

    fn visit_unary_expression(&mut self, expr: &UnaryExpression<'a>) {
        if expr.operator == UnaryOperator::Delete {
            self.is_pure = false;
        }
        oxc_ast_visit::walk::walk_unary_expression(self, expr);
    }

    fn visit_new_expression(&mut self, expr: &NewExpression<'a>) {
        if let Expression::Identifier(ident) = &expr.callee {
            if ident.name == "Date" {
                self.is_pure = false;
            }
        }
        oxc_ast_visit::walk::walk_new_expression(self, expr);
    }

    fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
        if IMPURE_GLOBALS.contains(&ident.name.as_str()) {
            self.is_pure = false;
        }
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        match &call.callee {
            Expression::StaticMemberExpression(mem) => {
                let method_name = mem.property.name.as_str();

                if MUTATING_ARRAY_METHODS.contains(&method_name) {
                    self.is_pure = false;
                }

                if DOM_QUERY_METHODS.contains(&method_name) {
                    self.is_pure = false;
                }

                // Check for Date.now(), Math.random(), performance.now(), crypto.randomUUID()
                if let Expression::Identifier(obj_ident) = &mem.object {
                    let obj_name = obj_ident.name.as_str();
                    if (obj_name == "Date" && method_name == "now")
                        || (obj_name == "Math" && method_name == "random")
                        || (obj_name == "performance" && method_name == "now")
                        || (obj_name == "crypto" && method_name == "randomUUID")
                    {
                        self.is_pure = false;
                    }
                }

                // Disallow arbitrary method calls on this (e.g. this.someAction())
                if matches!(&mem.object, Expression::ThisExpression(_)) {
                    // Method call on this is considered potentially state-mutating
                    self.is_pure = false;
                }
            }
            Expression::Identifier(ident) => {
                let name = ident.name.as_str();
                if name == "fetch"
                    || name == "setTimeout"
                    || name == "setInterval"
                    || name == "requestAnimationFrame"
                {
                    self.is_pure = false;
                }
            }
            _ => {}
        }

        oxc_ast_visit::walk::walk_call_expression(self, call);
    }

    fn visit_static_member_expression(&mut self, mem: &StaticMemberExpression<'a>) {
        if matches!(&mem.object, Expression::ThisExpression(_)) {
            let prop = mem.property.name.as_str().to_string();
            if !prop.starts_with("__memo") && !self.dependencies.contains(&prop) {
                self.dependencies.push(prop);
            }
        }
        oxc_ast_visit::walk::walk_static_member_expression(self, mem);
    }

    fn visit_computed_member_expression(&mut self, mem: &ComputedMemberExpression<'a>) {
        if matches!(&mem.object, Expression::ThisExpression(_)) {
            if let Expression::StringLiteral(lit) = &mem.expression {
                let prop = lit.value.as_str().to_string();
                if !prop.starts_with("__memo") && !self.dependencies.contains(&prop) {
                    self.dependencies.push(prop);
                }
            }
        }
        oxc_ast_visit::walk::walk_computed_member_expression(self, mem);
    }
}

/// Analyze whether an expression is a pure array method call chain rooted in `this.<prop>`
pub fn analyze_candidate<'a>(expr: &'a Expression<'a>) -> Option<CandidateInfo> {
    let Expression::CallExpression(outer_call) = expr else {
        return None;
    };

    // Check outer method is pure array method or valid sort on fresh array
    let outer_method = match &outer_call.callee {
        Expression::StaticMemberExpression(mem) => mem.property.name.as_str(),
        Expression::ComputedMemberExpression(mem) => {
            if let Expression::StringLiteral(s) = &mem.expression {
                s.value.as_str()
            } else {
                return None;
            }
        }
        _ => return None,
    };

    let next_obj_outer = match &outer_call.callee {
        Expression::StaticMemberExpression(mem) => &mem.object,
        Expression::ComputedMemberExpression(mem) => &mem.object,
        _ => return None,
    };

    if outer_method == "sort" {
        if !returns_fresh_array(next_obj_outer) {
            return None;
        }
    } else if !PURE_ARRAY_METHODS.contains(&outer_method) {
        return None;
    }

    // Trace receiver chain backwards to find root receiver
    let mut cur: &Expression<'a> = expr;
    let mut chain_methods = Vec::new();
    let mut root_prop: Option<String> = None;

    while let Expression::CallExpression(call) = cur {
        let method = match &call.callee {
            Expression::StaticMemberExpression(mem) => Some(mem.property.name.as_str()),
            Expression::ComputedMemberExpression(mem) => {
                if let Expression::StringLiteral(s) = &mem.expression {
                    Some(s.value.as_str())
                } else {
                    None
                }
            }
            _ => None,
        };

        let Some(m) = method else {
            break;
        };

        let next_obj = match &call.callee {
            Expression::StaticMemberExpression(mem) => &mem.object,
            Expression::ComputedMemberExpression(mem) => &mem.object,
            _ => break,
        };

        if m == "sort" {
            if !returns_fresh_array(next_obj) {
                // sort directly on this.<prop> mutates original array in place!
                return None;
            }
        } else if !PURE_ARRAY_METHODS.contains(&m) {
            break;
        }

        chain_methods.push(m);

        match next_obj {
            Expression::StaticMemberExpression(mem) => {
                if matches!(&mem.object, Expression::ThisExpression(_)) {
                    root_prop = Some(mem.property.name.as_str().to_string());
                    break;
                }
                cur = next_obj;
            }
            Expression::ComputedMemberExpression(mem) => {
                if matches!(&mem.object, Expression::ThisExpression(_)) {
                    if let Expression::StringLiteral(s) = &mem.expression {
                        root_prop = Some(s.value.as_str().to_string());
                        break;
                    }
                }
                cur = next_obj;
            }
            Expression::ArrayExpression(arr) => {
                // e.g. [...this.items]
                for elem in &arr.elements {
                    if let ArrayExpressionElement::SpreadElement(spread) = elem {
                        if let Expression::StaticMemberExpression(mem) = &spread.argument {
                            if matches!(&mem.object, Expression::ThisExpression(_)) {
                                root_prop = Some(mem.property.name.as_str().to_string());
                                break;
                            }
                        }
                    }
                }
                break;
            }
            Expression::CallExpression(_) => {
                cur = next_obj;
            }
            _ => break,
        }
    }

    let root_prop = root_prop?;

    // Check purity and extract dependencies
    let mut visitor = PurityAndDependencyVisitor::new();
    visitor.visit_expression(expr);

    if !visitor.is_pure || visitor.dependencies.is_empty() {
        return None;
    }

    // Ensure root_prop is included in dependencies
    let mut deps = visitor.dependencies;
    if !deps.contains(&root_prop) {
        deps.insert(0, root_prop.clone());
    }

    Some(CandidateInfo {
        expr_start: expr.span().start as usize,
        expr_end: expr.span().end as usize,
        root_prop,
        dependencies: deps,
    })
}
