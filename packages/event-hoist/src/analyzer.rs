use oxc_ast::ast::*;
use oxc_semantic::Scoping;
use std::collections::HashSet;

pub const SAFE_BUBBLING_EVENTS: &[&str] = &[
    "click",
    "dblclick",
    "contextmenu",
    "input",
    "change",
    "submit",
    "reset",
    "keydown",
    "keyup",
    "keypress",
    "pointerdown",
    "pointerup",
    "pointercancel",
    "mousedown",
    "mouseup",
    "touchstart",
    "touchend",
    "touchcancel",
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
    pub lit_event_options_names: HashSet<String>,
}

impl LitSemanticAnalysis {
    pub fn new(program: &Program, scoping: &Scoping) -> Self {
        let mut analysis = Self {
            has_lit_imports: false,
            has_any_imports: false,
            lit_tag_names: HashSet::new(),
            lit_class_names: HashSet::new(),
            lit_namespaces: HashSet::new(),
            lit_event_options_names: HashSet::new(),
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
                                        } else if imported_name == "eventOptions" {
                                            analysis.lit_event_options_names.insert(local_name);
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
            false
        }
    }

    pub fn has_event_options(&self, expr: &Expression) -> bool {
        match expr {
            Expression::CallExpression(call) => self.is_event_options_callee(&call.callee),
            _ => false,
        }
    }

    fn is_event_options_callee(&self, expr: &Expression) -> bool {
        match expr {
            Expression::Identifier(ident) => {
                if self.has_any_imports {
                    self.lit_event_options_names.contains(ident.name.as_str())
                } else {
                    ident.name == "eventOptions"
                }
            }
            Expression::CallExpression(call) => self.is_event_options_callee(&call.callee),
            Expression::StaticMemberExpression(mem) => {
                if mem.property.name == "eventOptions" {
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

pub fn match_event_attr(quasi_str: &str) -> Option<(usize, String, Option<char>)> {
    let bytes = quasi_str.as_bytes();
    if bytes.is_empty() {
        return None;
    }

    let mut idx = bytes.len();

    let quote = if bytes[idx - 1] == b'"' || bytes[idx - 1] == b'\'' {
        let q = bytes[idx - 1] as char;
        idx -= 1;
        Some(q)
    } else {
        None
    };

    if idx == 0 || bytes[idx - 1] != b'=' {
        return None;
    }
    idx -= 1;

    let end_event = idx;
    while idx > 0 {
        let b = bytes[idx - 1];
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' {
            idx -= 1;
        } else {
            break;
        }
    }

    if idx == end_event {
        return None;
    }

    if idx == 0 || bytes[idx - 1] != b'@' {
        return None;
    }
    idx -= 1;

    let at_offset = idx;
    let event_name = quasi_str[at_offset + 1..end_event].to_string();

    Some((at_offset, event_name, quote))
}

pub fn has_event_options(expr: &Expression) -> bool {
    match expr {
        Expression::CallExpression(call) => match &call.callee {
            Expression::Identifier(ident) => ident.name == "eventOptions",
            Expression::CallExpression(inner_call) => match &inner_call.callee {
                Expression::Identifier(ident) => ident.name == "eventOptions",
                Expression::StaticMemberExpression(mem) => mem.property.name == "eventOptions",
                _ => false,
            },
            Expression::StaticMemberExpression(mem) => mem.property.name == "eventOptions",
            _ => false,
        },
        _ => false,
    }
}

pub fn collect_classes_mut<'a, 'b>(
    stmts: &'b mut [Statement<'a>],
    out: &mut Vec<&'b mut Class<'a>>,
) {
    for stmt in stmts {
        match stmt {
            Statement::ClassDeclaration(class) => {
                out.push(class);
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &mut export_decl.declaration {
                    out.push(class);
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &mut export_decl.declaration
                {
                    out.push(class);
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &mut var_decl.declarations {
                    if let Some(Expression::ClassExpression(class)) = &mut decl.init {
                        out.push(class);
                    }
                }
            }
            _ => {}
        }
    }
}
