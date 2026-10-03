use oxc_allocator::ArenaVec;
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DirectiveKind {
    ClassMap,
    StyleMap,
    IfDefined,
    Guard,
    Repeat,
    Cache,
    Until,
    Live,
}

impl DirectiveKind {
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "classMap" => Some(Self::ClassMap),
            "styleMap" => Some(Self::StyleMap),
            "ifDefined" => Some(Self::IfDefined),
            "guard" => Some(Self::Guard),
            "repeat" => Some(Self::Repeat),
            "cache" => Some(Self::Cache),
            "until" => Some(Self::Until),
            "live" => Some(Self::Live),
            _ => None,
        }
    }
}

pub fn is_lit_import_source(src: &str) -> bool {
    src == "lit"
        || src.starts_with("lit/")
        || src == "lit-element"
        || src.starts_with("lit-element/")
        || src == "lit-html"
        || src.starts_with("lit-html/")
        || src.starts_with("@lit/")
}

pub fn is_lit_directive_source(src: &str) -> bool {
    src.contains("lit/directives/")
        || src.contains("lit-html/directives/")
        || src.contains("@lit/directive")
}

#[derive(Debug, Default)]
pub struct ImportContext {
    pub directive_bindings: HashMap<String, DirectiveKind>,
    pub lit_bindings: HashSet<String>,
    pub lit_sources: HashSet<String>,
}

impl ImportContext {
    pub fn scan<'a>(program: &Program<'a>) -> Self {
        let mut ctx = Self::default();

        for stmt in &program.body {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                let src = import_decl.source.value.as_str();
                let is_lit = is_lit_import_source(src);
                let is_directive = is_lit_directive_source(src);

                if is_lit || is_directive {
                    ctx.lit_sources.insert(src.to_string());
                }

                if let Some(specifiers) = &import_decl.specifiers {
                    for spec in specifiers {
                        match spec {
                            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                let imported_name = named.imported.name();
                                let local_name = named.local.name.as_str();

                                if is_directive || is_lit {
                                    if let Some(kind) =
                                        DirectiveKind::from_name(imported_name.as_str())
                                    {
                                        ctx.directive_bindings.insert(local_name.to_string(), kind);
                                    }
                                }

                                if is_lit {
                                    ctx.lit_bindings.insert(local_name.to_string());
                                }
                            }
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => {
                                if is_lit {
                                    ctx.lit_bindings.insert(def.local.name.as_str().to_string());
                                }
                            }
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                if is_lit {
                                    ctx.lit_bindings.insert(ns.local.name.as_str().to_string());
                                }
                            }
                        }
                    }
                }
            }
        }

        ctx
    }

    pub fn has_lit_imports(&self) -> bool {
        !ctx_is_empty(self)
    }

    pub fn get_directive_kind(&self, name: &str) -> Option<DirectiveKind> {
        self.directive_bindings
            .get(name)
            .copied()
            .or_else(|| DirectiveKind::from_name(name))
    }
}

fn ctx_is_empty(ctx: &ImportContext) -> bool {
    ctx.lit_sources.is_empty() && ctx.directive_bindings.is_empty() && ctx.lit_bindings.is_empty()
}

pub fn clean_dead_imports<'a>(program: &mut Program<'a>, ast: &AstBuilder<'a>) {
    let old_body = std::mem::replace(&mut program.body, ArenaVec::new_in(ast));

    let mut candidate_names = HashSet::new();
    for stmt in &old_body {
        if let Statement::ImportDeclaration(ref import_decl) = stmt {
            let src = import_decl.source.value.as_str();
            if is_lit_import_source(src) || is_lit_directive_source(src) {
                if let Some(ref specifiers) = import_decl.specifiers {
                    for spec in specifiers {
                        let name = match spec {
                            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                named.local.name.as_str()
                            }
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => {
                                def.local.name.as_str()
                            }
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                ns.local.name.as_str()
                            }
                        };
                        candidate_names.insert(name.to_string());
                    }
                }
            }
        }
    }

    let mut used_names = HashSet::new();
    for stmt in &old_body {
        if !matches!(stmt, Statement::ImportDeclaration(_)) {
            for name in &candidate_names {
                if !used_names.contains(name) && stmt_has_identifier_reference(stmt, name) {
                    used_names.insert(name.clone());
                }
            }
        }
    }

    let mut retained_stmts = ArenaVec::new_in(ast);

    for mut stmt in old_body {
        if let Statement::ImportDeclaration(ref mut import_decl) = stmt {
            let src = import_decl.source.value.as_str();
            if is_lit_import_source(src) || is_lit_directive_source(src) {
                if let Some(ref mut specifiers) = import_decl.specifiers {
                    specifiers.retain(|spec| {
                        let local_name = match spec {
                            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                named.local.name.as_str()
                            }
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => {
                                def.local.name.as_str()
                            }
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                ns.local.name.as_str()
                            }
                        };
                        used_names.contains(local_name)
                    });

                    if specifiers.is_empty() {
                        continue;
                    }
                }
            }
        }
        retained_stmts.push(stmt);
    }

    program.body = retained_stmts;
}

fn stmt_has_identifier_reference(stmt: &Statement, name: &str) -> bool {
    match stmt {
        Statement::ExpressionStatement(e) => expr_has_identifier_reference(&e.expression, name),
        Statement::VariableDeclaration(var_decl) => var_decl.declarations.iter().any(|d| {
            d.init
                .as_ref()
                .map_or(false, |init| expr_has_identifier_reference(init, name))
        }),
        Statement::ClassDeclaration(class) => class_has_identifier_reference(class, name),
        Statement::FunctionDeclaration(func) => func.body.as_ref().map_or(false, |b| {
            b.statements
                .iter()
                .any(|s| stmt_has_identifier_reference(s, name))
        }),
        Statement::ReturnStatement(ret) => ret
            .argument
            .as_ref()
            .map_or(false, |arg| expr_has_identifier_reference(arg, name)),
        Statement::IfStatement(if_stmt) => {
            expr_has_identifier_reference(&if_stmt.test, name)
                || stmt_has_identifier_reference(&if_stmt.consequent, name)
                || if_stmt
                    .alternate
                    .as_ref()
                    .map_or(false, |alt| stmt_has_identifier_reference(alt, name))
        }
        Statement::BlockStatement(block) => block
            .body
            .iter()
            .any(|s| stmt_has_identifier_reference(s, name)),
        Statement::ForStatement(for_stmt) => {
            for_stmt.init.as_ref().map_or(false, |init| match init {
                ForStatementInit::VariableDeclaration(v) => v.declarations.iter().any(|d| {
                    d.init
                        .as_ref()
                        .map_or(false, |i| expr_has_identifier_reference(i, name))
                }),
                _ => init
                    .as_expression()
                    .map_or(false, |e| expr_has_identifier_reference(e, name)),
            }) || for_stmt
                .test
                .as_ref()
                .map_or(false, |test| expr_has_identifier_reference(test, name))
                || for_stmt
                    .update
                    .as_ref()
                    .map_or(false, |up| expr_has_identifier_reference(up, name))
                || stmt_has_identifier_reference(&for_stmt.body, name)
        }
        Statement::ForInStatement(for_in) => {
            expr_has_identifier_reference(&for_in.right, name)
                || stmt_has_identifier_reference(&for_in.body, name)
        }
        Statement::ForOfStatement(for_of) => {
            expr_has_identifier_reference(&for_of.right, name)
                || stmt_has_identifier_reference(&for_of.body, name)
        }
        Statement::WhileStatement(while_stmt) => {
            expr_has_identifier_reference(&while_stmt.test, name)
                || stmt_has_identifier_reference(&while_stmt.body, name)
        }
        Statement::DoWhileStatement(do_while) => {
            expr_has_identifier_reference(&do_while.test, name)
                || stmt_has_identifier_reference(&do_while.body, name)
        }
        Statement::SwitchStatement(switch_stmt) => {
            expr_has_identifier_reference(&switch_stmt.discriminant, name)
                || switch_stmt.cases.iter().any(|c| {
                    c.test
                        .as_ref()
                        .map_or(false, |t| expr_has_identifier_reference(t, name))
                        || c.consequent
                            .iter()
                            .any(|s| stmt_has_identifier_reference(s, name))
                })
        }
        Statement::ThrowStatement(throw_stmt) => {
            expr_has_identifier_reference(&throw_stmt.argument, name)
        }
        Statement::TryStatement(try_stmt) => {
            try_stmt
                .block
                .body
                .iter()
                .any(|s| stmt_has_identifier_reference(s, name))
                || try_stmt.handler.as_ref().map_or(false, |h| {
                    h.body
                        .body
                        .iter()
                        .any(|s| stmt_has_identifier_reference(s, name))
                })
                || try_stmt.finalizer.as_ref().map_or(false, |f| {
                    f.body
                        .iter()
                        .any(|s| stmt_has_identifier_reference(s, name))
                })
        }
        Statement::ExportDefaultDeclaration(exp) => match &exp.declaration {
            ExportDefaultDeclarationKind::ClassDeclaration(c) => {
                class_has_identifier_reference(c, name)
            }
            ExportDefaultDeclarationKind::FunctionDeclaration(f) => {
                f.body.as_ref().map_or(false, |b| {
                    b.statements
                        .iter()
                        .any(|s| stmt_has_identifier_reference(s, name))
                })
            }
            _ => {
                if let Some(expr) = exp.declaration.as_expression() {
                    expr_has_identifier_reference(expr, name)
                } else {
                    false
                }
            }
        },
        Statement::ExportDeclaration(exp) => decl_has_identifier_reference(&exp.declaration, name),
        Statement::ExportNamedDeclaration(exp) => exp
            .specifiers
            .iter()
            .any(|s| s.local.name().as_str() == name),
        _ => false,
    }
}

fn decl_has_identifier_reference(decl: &Declaration, name: &str) -> bool {
    match decl {
        Declaration::VariableDeclaration(v) => v.declarations.iter().any(|d| {
            d.init
                .as_ref()
                .map_or(false, |init| expr_has_identifier_reference(init, name))
        }),
        Declaration::ClassDeclaration(c) => class_has_identifier_reference(c, name),
        Declaration::FunctionDeclaration(f) => f.body.as_ref().map_or(false, |b| {
            b.statements
                .iter()
                .any(|s| stmt_has_identifier_reference(s, name))
        }),
        _ => false,
    }
}

fn class_has_identifier_reference(class: &Class, name: &str) -> bool {
    if class.heritage.as_ref().map_or(false, |h| {
        expr_has_identifier_reference(&h.expression, name)
    }) {
        return true;
    }
    class
        .decorators
        .iter()
        .any(|d| expr_has_identifier_reference(&d.expression, name))
        || class.body.body.iter().any(|elem| match elem {
            ClassElement::MethodDefinition(m) => {
                m.decorators
                    .iter()
                    .any(|d| expr_has_identifier_reference(&d.expression, name))
                    || m.value.body.as_ref().map_or(false, |b| {
                        b.statements
                            .iter()
                            .any(|s| stmt_has_identifier_reference(s, name))
                    })
            }
            ClassElement::PropertyDefinition(p) => {
                p.decorators
                    .iter()
                    .any(|d| expr_has_identifier_reference(&d.expression, name))
                    || p.value
                        .as_ref()
                        .map_or(false, |v| expr_has_identifier_reference(v, name))
            }
            ClassElement::StaticBlock(b) => b
                .body
                .iter()
                .any(|s| stmt_has_identifier_reference(s, name)),
            ClassElement::AccessorProperty(a) => {
                a.decorators
                    .iter()
                    .any(|d| expr_has_identifier_reference(&d.expression, name))
                    || a.value
                        .as_ref()
                        .map_or(false, |v| expr_has_identifier_reference(v, name))
            }
            _ => false,
        })
}

fn expr_has_identifier_reference(expr: &Expression, name: &str) -> bool {
    match expr {
        Expression::Identifier(id) => id.name == name,
        Expression::CallExpression(call) => {
            expr_has_identifier_reference(&call.callee, name)
                || call.arguments.iter().any(|arg| {
                    arg.as_expression()
                        .map_or(false, |e| expr_has_identifier_reference(e, name))
                })
        }
        Expression::StaticMemberExpression(mem) => expr_has_identifier_reference(&mem.object, name),
        Expression::ComputedMemberExpression(mem) => {
            expr_has_identifier_reference(&mem.object, name)
                || expr_has_identifier_reference(&mem.expression, name)
        }
        Expression::AssignmentExpression(assign) => {
            expr_has_identifier_reference(&assign.right, name)
        }
        Expression::BinaryExpression(bin) => {
            expr_has_identifier_reference(&bin.left, name)
                || expr_has_identifier_reference(&bin.right, name)
        }
        Expression::UnaryExpression(unary) => expr_has_identifier_reference(&unary.argument, name),
        Expression::LogicalExpression(log) => {
            expr_has_identifier_reference(&log.left, name)
                || expr_has_identifier_reference(&log.right, name)
        }
        Expression::ConditionalExpression(cond) => {
            expr_has_identifier_reference(&cond.test, name)
                || expr_has_identifier_reference(&cond.consequent, name)
                || expr_has_identifier_reference(&cond.alternate, name)
        }
        Expression::SequenceExpression(seq) => seq
            .expressions
            .iter()
            .any(|e| expr_has_identifier_reference(e, name)),
        Expression::ParenthesizedExpression(p) => {
            expr_has_identifier_reference(&p.expression, name)
        }
        Expression::ArrayExpression(arr) => arr.elements.iter().any(|elem| {
            elem.as_expression()
                .map_or(false, |e| expr_has_identifier_reference(e, name))
        }),
        Expression::ObjectExpression(obj) => obj.properties.iter().any(|prop| match prop {
            ObjectPropertyKind::ObjectProperty(p) => expr_has_identifier_reference(&p.value, name),
            ObjectPropertyKind::SpreadProperty(p) => {
                expr_has_identifier_reference(&p.argument, name)
            }
        }),
        Expression::FunctionExpression(func) => func.body.as_ref().map_or(false, |b| {
            b.statements
                .iter()
                .any(|s| stmt_has_identifier_reference(s, name))
        }),
        Expression::ArrowFunctionExpression(arrow) => match &arrow.body {
            ArrowFunctionBody::FunctionBody(b) => b
                .statements
                .iter()
                .any(|s| stmt_has_identifier_reference(s, name)),
            _ => {
                if let Some(expr) = arrow.body.as_expression() {
                    expr_has_identifier_reference(expr, name)
                } else {
                    false
                }
            }
        },
        Expression::ClassExpression(class) => class_has_identifier_reference(class, name),
        Expression::TemplateLiteral(tmpl) => tmpl
            .expressions
            .iter()
            .any(|e| expr_has_identifier_reference(e, name)),
        Expression::TaggedTemplateExpression(tagged) => {
            expr_has_identifier_reference(&tagged.tag, name)
                || tagged
                    .quasi
                    .expressions
                    .iter()
                    .any(|e| expr_has_identifier_reference(e, name))
        }
        Expression::NewExpression(new_expr) => {
            expr_has_identifier_reference(&new_expr.callee, name)
                || new_expr.arguments.iter().any(|arg| {
                    arg.as_expression()
                        .map_or(false, |e| expr_has_identifier_reference(e, name))
                })
        }
        Expression::AwaitExpression(aw) => expr_has_identifier_reference(&aw.argument, name),
        _ => false,
    }
}
