use oxc_allocator::{Allocator, CloneIn};
use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
use oxc_span::GetSpan;
use std::collections::HashSet;

use crate::analyzer::{analyze_candidate, is_lit_html_tag, LitSemanticAnalysis};

pub fn make_memo_slot(base_prop: &str, counter: usize) -> String {
    let mut s = String::with_capacity(base_prop.len() + 1 + 8);
    s.push_str(base_prop);
    s.push('_');
    s.push_str(&counter.to_string());
    s
}

pub fn make_memoized_var_name(base_prop: &str, idx: Option<usize>) -> String {
    let mut s = String::with_capacity(10 + base_prop.len() + 8);
    s.push_str("_memoized_");
    s.push_str(base_prop);
    if let Some(i) = idx {
        s.push('_');
        s.push_str(&i.to_string());
    }
    s
}

pub fn make_memo_key(base_prop: &str) -> String {
    let mut s = String::with_capacity(6 + base_prop.len());
    s.push_str("_memo_");
    s.push_str(base_prop);
    s
}

pub fn generate_unique_var_name(
    base_prop: &str,
    counter: usize,
    used_slots: &HashSet<String>,
    existing_bindings: &HashSet<String>,
) -> String {
    let memo_key = make_memo_key(base_prop);
    let mut candidate = if used_slots.contains(&memo_key) {
        make_memoized_var_name(base_prop, Some(counter))
    } else {
        make_memoized_var_name(base_prop, None)
    };

    let mut idx = counter;
    while existing_bindings.contains(&candidate) || used_slots.contains(&candidate) {
        idx += 1;
        candidate = make_memoized_var_name(base_prop, Some(idx));
    }

    candidate
}

#[derive(Debug)]
pub struct CandidateItem<'a> {
    pub expr_start: usize,
    pub expr_end: usize,
    pub expr: Expression<'a>,
    pub root_prop: String,
    pub var_name: String,
    pub val_slot: String,
    pub dependencies: Vec<String>,
}

#[derive(Debug)]
pub struct StmtCandidateGroup<'a> {
    pub stmt_start: usize,
    pub stmt_end: usize,
    pub is_var_decl: bool,
    pub var_name: Option<String>,
    pub candidates: Vec<CandidateItem<'a>>,
}

/// Visitor that walks tagged templates inside statements to find candidate expressions
pub struct TemplateCandidateFinder<'a, 's> {
    pub allocator: &'a Allocator,
    pub lit_analysis: Option<&'s LitSemanticAnalysis>,
    pub existing_bindings: &'s HashSet<String>,
    pub candidates: Vec<CandidateItem<'a>>,
    pub used_slots: HashSet<String>,
    pub counter: usize,
}

impl<'a, 's> Visit<'a> for TemplateCandidateFinder<'a, 's> {
    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        let is_lit = match self.lit_analysis {
            Some(analysis) => analysis.is_lit_tag(&tagged.tag),
            None => is_lit_html_tag(&tagged.tag),
        };

        if is_lit {
            for expr in &tagged.quasi.expressions {
                let unmasked_expr = if let Expression::ConditionalExpression(cond) = expr {
                    if let Expression::BinaryExpression(bin) = &cond.test {
                        if let Expression::StaticMemberExpression(mem) = &bin.left {
                            if mem.property.name == "__litDirtyMask" {
                                Some(&cond.consequent)
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };

                let target_expr = unmasked_expr.unwrap_or(expr);
                if let Some(cand) = analyze_candidate(target_expr) {
                    let base_prop = cand.root_prop.clone();
                    let val_slot = if self.used_slots.contains(&base_prop) {
                        make_memo_slot(&base_prop, self.counter)
                    } else {
                        base_prop.clone()
                    };
                    self.used_slots.insert(val_slot.clone());

                    let var_name = generate_unique_var_name(
                        &base_prop,
                        self.counter,
                        &self.used_slots,
                        self.existing_bindings,
                    );
                    self.used_slots.insert(make_memo_key(&base_prop));
                    self.used_slots.insert(var_name.clone());
                    self.counter += 1;

                    let expr_cloned = target_expr.clone_in(self.allocator);

                    self.candidates.push(CandidateItem {
                        expr_start: cand.expr_start,
                        expr_end: cand.expr_end,
                        expr: expr_cloned,
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

pub fn collect_stmt_candidates<'a, 's>(
    stmt: &Statement<'a>,
    allocator: &'a Allocator,
    lit_analysis: Option<&'s LitSemanticAnalysis>,
    existing_bindings: &'s HashSet<String>,
    out: &mut Vec<StmtCandidateGroup<'a>>,
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
                            _ => generate_unique_var_name(
                                &cand.root_prop,
                                *counter,
                                used_slots,
                                existing_bindings,
                            ),
                        };

                        let val_slot = if used_slots.contains(&cand.root_prop) {
                            make_memo_slot(&cand.root_prop, *counter)
                        } else {
                            cand.root_prop.clone()
                        };
                        used_slots.insert(val_slot.clone());
                        used_slots.insert(var_name.clone());
                        *counter += 1;

                        let expr_cloned = init_expr.clone_in(allocator);

                        out.push(StmtCandidateGroup {
                            stmt_start: stmt.span().start as usize,
                            stmt_end: stmt.span().end as usize,
                            is_var_decl: true,
                            var_name: Some(var_name.clone()),
                            candidates: vec![CandidateItem {
                                expr_start: cand.expr_start,
                                expr_end: cand.expr_end,
                                expr: expr_cloned,
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
                        allocator,
                        lit_analysis,
                        existing_bindings,
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
                        make_memo_slot(&cand.root_prop, *counter)
                    } else {
                        cand.root_prop.clone()
                    };
                    used_slots.insert(val_slot.clone());

                    let var_name = generate_unique_var_name(
                        &val_slot,
                        *counter,
                        used_slots,
                        existing_bindings,
                    );
                    used_slots.insert(var_name.clone());
                    *counter += 1;

                    let expr_cloned = arg.clone_in(allocator);

                    out.push(StmtCandidateGroup {
                        stmt_start: stmt.span().start as usize,
                        stmt_end: stmt.span().end as usize,
                        is_var_decl: false,
                        var_name: None,
                        candidates: vec![CandidateItem {
                            expr_start: cand.expr_start,
                            expr_end: cand.expr_end,
                            expr: expr_cloned,
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
                    allocator,
                    lit_analysis,
                    existing_bindings,
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
                allocator,
                lit_analysis,
                existing_bindings,
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
            collect_stmt_candidates(
                &if_stmt.consequent,
                allocator,
                lit_analysis,
                existing_bindings,
                out,
                used_slots,
                counter,
            );
            if let Some(alt) = &if_stmt.alternate {
                collect_stmt_candidates(
                    alt,
                    allocator,
                    lit_analysis,
                    existing_bindings,
                    out,
                    used_slots,
                    counter,
                );
            }
        }
        Statement::BlockStatement(block) => {
            for s in &block.body {
                collect_stmt_candidates(
                    s,
                    allocator,
                    lit_analysis,
                    existing_bindings,
                    out,
                    used_slots,
                    counter,
                );
            }
        }
        Statement::TryStatement(try_stmt) => {
            for s in &try_stmt.block.body {
                collect_stmt_candidates(
                    s,
                    allocator,
                    lit_analysis,
                    existing_bindings,
                    out,
                    used_slots,
                    counter,
                );
            }
            if let Some(h) = &try_stmt.handler {
                for s in &h.body.body {
                    collect_stmt_candidates(
                        s,
                        allocator,
                        lit_analysis,
                        existing_bindings,
                        out,
                        used_slots,
                        counter,
                    );
                }
            }
            if let Some(f) = &try_stmt.finalizer {
                for s in &f.body {
                    collect_stmt_candidates(
                        s,
                        allocator,
                        lit_analysis,
                        existing_bindings,
                        out,
                        used_slots,
                        counter,
                    );
                }
            }
        }
        Statement::SwitchStatement(sw) => {
            for case in &sw.cases {
                for s in &case.consequent {
                    collect_stmt_candidates(
                        s,
                        allocator,
                        lit_analysis,
                        existing_bindings,
                        out,
                        used_slots,
                        counter,
                    );
                }
            }
        }
        _ => {}
    }
}
