use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const PURE_ARRAY_METHODS: &[&str] = &["map", "filter", "sort", "slice", "reduce", "flatMap"];

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

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct MemoizeOptions {
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MemoizeResult {
    pub code: String,
    pub map: Option<String>,
    pub memoized_count: u32,
    pub components_count: u32,
}

#[derive(Clone, Debug)]
pub struct CandidateInfo {
    pub expr_start: usize,
    pub expr_end: usize,
    pub root_prop: String,
    pub dependencies: Vec<String>,
}

fn is_lit_html_tag(tag: &Expression) -> bool {
    match tag {
        Expression::Identifier(ident) => ident.name == "html" || ident.name == "svg",
        Expression::StaticMemberExpression(mem) => {
            mem.property.name == "html" || mem.property.name == "svg"
        }
        _ => false,
    }
}

/// Visitor to verify expression purity and extract dependencies on `this`
struct PurityAndDependencyVisitor {
    is_pure: bool,
    dependencies: Vec<String>,
}

impl PurityAndDependencyVisitor {
    fn new() -> Self {
        Self {
            is_pure: true,
            dependencies: Vec::new(),
        }
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

    // Check outer method is pure array method
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

    if !PURE_ARRAY_METHODS.contains(&outer_method) {
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

        if !PURE_ARRAY_METHODS.contains(&m) {
            break;
        }

        chain_methods.push(m);

        let next_obj = match &call.callee {
            Expression::StaticMemberExpression(mem) => &mem.object,
            Expression::ComputedMemberExpression(mem) => &mem.object,
            _ => break,
        };

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

#[derive(Clone, Debug)]
pub struct CandidateItem {
    pub expr_start: usize,
    pub expr_end: usize,
    pub expr_code: String,
    pub root_prop: String,
    pub var_name: String,
    pub val_slot: String,
    pub dependencies: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct StmtCandidateGroup {
    pub stmt_start: usize,
    pub stmt_end: usize,
    pub is_var_decl: bool,
    pub var_name: Option<String>,
    pub candidates: Vec<CandidateItem>,
}

/// Visitor that walks tagged templates inside statements to find candidate expressions
struct TemplateCandidateFinder<'s> {
    source: &'s str,
    candidates: Vec<CandidateItem>,
    used_slots: HashSet<String>,
    counter: usize,
}

impl<'a, 's> Visit<'a> for TemplateCandidateFinder<'s> {
    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if is_lit_html_tag(&tagged.tag) {
            for expr in &tagged.quasi.expressions {
                if let Some(cand) = analyze_candidate(expr) {
                    let base_prop = cand.root_prop.clone();
                    let val_slot = if self.used_slots.contains(&base_prop) {
                        format!("{}_{}", base_prop, self.counter)
                    } else {
                        base_prop.clone()
                    };
                    self.used_slots.insert(val_slot.clone());

                    let var_name = if self.used_slots.contains(&format!("_memo_{}", base_prop)) {
                        format!("_memoized_{}_{}", base_prop, self.counter)
                    } else {
                        format!("_memoized_{}", base_prop)
                    };
                    self.used_slots.insert(format!("_memo_{}", base_prop));
                    self.counter += 1;

                    let expr_code = self.source[cand.expr_start..cand.expr_end].to_string();

                    self.candidates.push(CandidateItem {
                        expr_start: cand.expr_start,
                        expr_end: cand.expr_end,
                        expr_code,
                        root_prop: cand.root_prop,
                        var_name,
                        val_slot,
                        dependencies: cand.dependencies,
                    });
                    // Don't recurse into this candidate's expressions
                    continue;
                }

                // If not a candidate, visit inner expressions in case of nested templates
                self.visit_expression(expr);
            }
        } else {
            oxc_ast_visit::walk::walk_tagged_template_expression(self, tagged);
        }
    }
}

fn collect_stmt_candidates<'a>(
    stmt: &'a Statement<'a>,
    source: &str,
    out: &mut Vec<StmtCandidateGroup>,
    used_slots: &mut HashSet<String>,
    counter: &mut usize,
) {
    match stmt {
        Statement::VariableDeclaration(var_decl) => {
            // Check if any declarator has a candidate init
            for decl in &var_decl.declarations {
                if let Some(init_expr) = &decl.init {
                    if let Some(cand) = analyze_candidate(init_expr) {
                        let var_name = match &decl.id {
                            BindingPattern::BindingIdentifier(ident) => {
                                ident.name.as_str().to_string()
                            }
                            _ => format!("_memoized_{}", cand.root_prop),
                        };

                        let val_slot = if used_slots.contains(&cand.root_prop) {
                            format!("{}_{}", cand.root_prop, counter)
                        } else {
                            cand.root_prop.clone()
                        };
                        used_slots.insert(val_slot.clone());
                        *counter += 1;

                        let expr_code = source[cand.expr_start..cand.expr_end].to_string();

                        out.push(StmtCandidateGroup {
                            stmt_start: stmt.span().start as usize,
                            stmt_end: stmt.span().end as usize,
                            is_var_decl: true,
                            var_name: Some(var_name.clone()),
                            candidates: vec![CandidateItem {
                                expr_start: cand.expr_start,
                                expr_end: cand.expr_end,
                                expr_code,
                                root_prop: cand.root_prop,
                                var_name,
                                val_slot,
                                dependencies: cand.dependencies,
                            }],
                        });
                        return;
                    }

                    // Otherwise, scan init for inline template candidates
                    let mut finder = TemplateCandidateFinder {
                        source,
                        candidates: Vec::new(),
                        used_slots: used_slots.clone(),
                        counter: *counter,
                    };
                    finder.visit_expression(init_expr);
                    *counter = finder.counter;
                    for s in &finder.used_slots {
                        used_slots.insert(s.clone());
                    }

                    if !finder.candidates.is_empty() {
                        out.push(StmtCandidateGroup {
                            stmt_start: stmt.span().start as usize,
                            stmt_end: stmt.span().end as usize,
                            is_var_decl: false,
                            var_name: None,
                            candidates: finder.candidates,
                        });
                    }
                }
            }
        }
        Statement::ReturnStatement(ret_stmt) => {
            if let Some(arg) = &ret_stmt.argument {
                // If the return argument itself is a pure array call chain:
                if let Some(cand) = analyze_candidate(arg) {
                    let val_slot = if used_slots.contains(&cand.root_prop) {
                        format!("{}_{}", cand.root_prop, counter)
                    } else {
                        cand.root_prop.clone()
                    };
                    used_slots.insert(val_slot.clone());

                    let var_name = format!("_memoized_{}", val_slot);
                    *counter += 1;

                    let expr_code = source[cand.expr_start..cand.expr_end].to_string();

                    out.push(StmtCandidateGroup {
                        stmt_start: stmt.span().start as usize,
                        stmt_end: stmt.span().end as usize,
                        is_var_decl: false,
                        var_name: None,
                        candidates: vec![CandidateItem {
                            expr_start: cand.expr_start,
                            expr_end: cand.expr_end,
                            expr_code,
                            root_prop: cand.root_prop,
                            var_name,
                            val_slot,
                            dependencies: cand.dependencies,
                        }],
                    });
                    return;
                }

                // Scan return argument for inline template candidates
                let mut finder = TemplateCandidateFinder {
                    source,
                    candidates: Vec::new(),
                    used_slots: used_slots.clone(),
                    counter: *counter,
                };
                finder.visit_expression(arg);
                *counter = finder.counter;
                for s in &finder.used_slots {
                    used_slots.insert(s.clone());
                }

                if !finder.candidates.is_empty() {
                    out.push(StmtCandidateGroup {
                        stmt_start: stmt.span().start as usize,
                        stmt_end: stmt.span().end as usize,
                        is_var_decl: false,
                        var_name: None,
                        candidates: finder.candidates,
                    });
                }
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            let mut finder = TemplateCandidateFinder {
                source,
                candidates: Vec::new(),
                used_slots: used_slots.clone(),
                counter: *counter,
            };
            finder.visit_expression(&expr_stmt.expression);
            *counter = finder.counter;
            for s in &finder.used_slots {
                used_slots.insert(s.clone());
            }

            if !finder.candidates.is_empty() {
                out.push(StmtCandidateGroup {
                    stmt_start: stmt.span().start as usize,
                    stmt_end: stmt.span().end as usize,
                    is_var_decl: false,
                    var_name: None,
                    candidates: finder.candidates,
                });
            }
        }
        Statement::IfStatement(if_stmt) => {
            collect_stmt_candidates(&if_stmt.consequent, source, out, used_slots, counter);
            if let Some(alt) = &if_stmt.alternate {
                collect_stmt_candidates(alt, source, out, used_slots, counter);
            }
        }
        Statement::BlockStatement(block) => {
            for s in &block.body {
                collect_stmt_candidates(s, source, out, used_slots, counter);
            }
        }
        Statement::TryStatement(try_stmt) => {
            for s in &try_stmt.block.body {
                collect_stmt_candidates(s, source, out, used_slots, counter);
            }
            if let Some(h) = &try_stmt.handler {
                for s in &h.body.body {
                    collect_stmt_candidates(s, source, out, used_slots, counter);
                }
            }
            if let Some(f) = &try_stmt.finalizer {
                for s in &f.body {
                    collect_stmt_candidates(s, source, out, used_slots, counter);
                }
            }
        }
        Statement::SwitchStatement(sw) => {
            for case in &sw.cases {
                for s in &case.consequent {
                    collect_stmt_candidates(s, source, out, used_slots, counter);
                }
            }
        }
        _ => {}
    }
}

fn get_line_indent(source: &str, offset: usize) -> String {
    let before = &source[..offset];
    let line_start = before.rfind('\n').map(|idx| idx + 1).unwrap_or(0);
    let line_slice = &source[line_start..offset];

    let mut indent = String::new();
    for ch in line_slice.chars() {
        if ch == ' ' || ch == '\t' {
            indent.push(ch);
        } else {
            break;
        }
    }
    indent
}

fn generate_memo_block(cand: &CandidateItem, indent: &str) -> String {
    let guards: Vec<String> = cand
        .dependencies
        .iter()
        .map(|dep| format!("this.__memo_{}_ref === this.{}", dep, dep))
        .collect();
    let guard_str = guards.join(" && ");

    let saves: Vec<String> = cand
        .dependencies
        .iter()
        .map(|dep| format!("{}  this.__memo_{}_ref = this.{};", indent, dep, dep))
        .collect();
    let saves_str = saves.join("\n");

    format!(
        "{indent}let {var_name};\n\
         {indent}if ({guard_str}) {{\n\
         {indent}  {var_name} = this.__memo_{val_slot}_val;\n\
         {indent}}} else {{\n\
         {saves_str}\n\
         {indent}  {var_name} = this.__memo_{val_slot}_val = {expr};\n\
         {indent}}}",
        indent = indent,
        var_name = cand.var_name,
        val_slot = cand.val_slot,
        guard_str = guard_str,
        saves_str = saves_str,
        expr = cand.expr_code,
    )
}

fn generate_var_decl_memo_block(cand: &CandidateItem, var_name: &str, indent: &str) -> String {
    let guards: Vec<String> = cand
        .dependencies
        .iter()
        .map(|dep| format!("this.__memo_{}_ref === this.{}", dep, dep))
        .collect();
    let guard_str = guards.join(" && ");

    let saves: Vec<String> = cand
        .dependencies
        .iter()
        .map(|dep| format!("{}  this.__memo_{}_ref = this.{};", indent, dep, dep))
        .collect();
    let saves_str = saves.join("\n");

    format!(
        "{indent}let {var_name};\n\
         {indent}if ({guard_str}) {{\n\
         {indent}  {var_name} = this.__memo_{val_slot}_val;\n\
         {indent}}} else {{\n\
         {saves_str}\n\
         {indent}  {var_name} = this.__memo_{val_slot}_val = {expr};\n\
         {indent}}}",
        indent = indent,
        var_name = var_name,
        val_slot = cand.val_slot,
        guard_str = guard_str,
        saves_str = saves_str,
        expr = cand.expr_code,
    )
}

fn collect_classes<'a>(stmts: &'a [Statement<'a>], out: &mut Vec<&'a Class<'a>>) {
    for stmt in stmts {
        match stmt {
            Statement::ClassDeclaration(class) => {
                out.push(class);
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &export_decl.declaration {
                    out.push(class);
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &export_decl.declaration
                {
                    out.push(class);
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &var_decl.declarations {
                    if let Some(Expression::ClassExpression(class)) = &decl.init {
                        out.push(class);
                    }
                }
            }
            _ => {}
        }
    }
}

pub fn transform_code(source: &str, options: MemoizeOptions) -> MemoizeResult {
    // Fast check: must contain render and at least one pure array method
    if !source.contains("render")
        || (!source.contains("map")
            && !source.contains("filter")
            && !source.contains("sort")
            && !source.contains("slice")
            && !source.contains("reduce")
            && !source.contains("flatMap"))
    {
        return MemoizeResult {
            code: source.to_string(),
            map: None,
            memoized_count: 0,
            components_count: 0,
        };
    }

    let allocator = Allocator::default();
    let filename = options.filename.as_deref().unwrap_or("file.ts");
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());

    let parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return MemoizeResult {
            code: source.to_string(),
            map: None,
            memoized_count: 0,
            components_count: 0,
        };
    }

    let program = &parsed.program;
    let mut classes = Vec::new();
    collect_classes(&program.body, &mut classes);

    if classes.is_empty() {
        return MemoizeResult {
            code: source.to_string(),
            map: None,
            memoized_count: 0,
            components_count: 0,
        };
    }

    let mut replacements: Vec<(usize, usize, String)> = Vec::new();
    let mut total_memoized_count: u32 = 0;
    let mut transformed_components_count: u32 = 0;

    for class in classes {
        // Look for render() method
        let mut render_body: Option<&FunctionBody> = None;

        for elem in &class.body.body {
            if let ClassElement::MethodDefinition(method) = elem {
                let method_name = match &method.key {
                    PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                    _ => None,
                };

                if method_name == Some("render") && !method.r#static {
                    if let Some(body) = &method.value.body {
                        render_body = Some(body);
                        break;
                    }
                }
            }
        }

        let Some(render_body) = render_body else {
            continue;
        };

        let mut groups: Vec<StmtCandidateGroup> = Vec::new();
        let mut used_slots: HashSet<String> = HashSet::new();
        let mut counter: usize = 0;

        for stmt in &render_body.statements {
            collect_stmt_candidates(stmt, source, &mut groups, &mut used_slots, &mut counter);
        }

        if groups.is_empty() {
            continue;
        }

        transformed_components_count += 1;

        for group in groups {
            let indent = get_line_indent(source, group.stmt_start);

            if group.is_var_decl && group.candidates.len() == 1 {
                let cand = &group.candidates[0];
                let var_name = group.var_name.as_deref().unwrap_or(&cand.var_name);
                let memo_block = generate_var_decl_memo_block(cand, var_name, &indent);

                // Replace the entire variable declaration statement
                replacements.push((group.stmt_start, group.stmt_end, memo_block));
                total_memoized_count += 1;
            } else {
                // Inline candidates:
                // 1. Insert memo blocks before the statement
                let mut blocks = Vec::new();
                for cand in &group.candidates {
                    blocks.push(generate_memo_block(cand, &indent));
                    total_memoized_count += 1;

                    // 2. Replace each candidate expression in template with its variable
                    replacements.push((cand.expr_start, cand.expr_end, cand.var_name.clone()));
                }

                let combined_blocks = blocks.join("\n") + "\n";
                replacements.push((group.stmt_start, group.stmt_start, combined_blocks));
            }
        }
    }

    if replacements.is_empty() {
        return MemoizeResult {
            code: source.to_string(),
            map: None,
            memoized_count: 0,
            components_count: 0,
        };
    }

    // Sort replacements descending by start position to safely apply string slices
    replacements.sort_by_key(|b| std::cmp::Reverse(b.0));

    let mut rewritten = source.to_string();
    for (start, end, repl) in replacements {
        if start <= end && end <= rewritten.len() {
            rewritten.replace_range(start..end, &repl);
        }
    }

    MemoizeResult {
        code: rewritten,
        map: None,
        memoized_count: total_memoized_count,
        components_count: transformed_components_count,
    }
}
