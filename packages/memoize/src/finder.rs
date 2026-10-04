use oxc_allocator::{Allocator, CloneIn};
use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
use oxc_span::GetSpan;
use std::collections::HashSet;

use crate::analyzer::{analyze_candidate, is_lit_html_tag};

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
pub struct TemplateCandidateFinder<'a> {
    pub allocator: &'a Allocator,
    pub candidates: Vec<CandidateItem<'a>>,
    pub used_slots: HashSet<String>,
    pub counter: usize,
}

impl<'a> Visit<'a> for TemplateCandidateFinder<'a> {
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

                    let expr_cloned = expr.clone_in(self.allocator);

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

pub fn collect_stmt_candidates<'a>(
    stmt: &Statement<'a>,
    allocator: &'a Allocator,
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
                            _ => format!("_memoized_{}", cand.root_prop),
                        };

                        let val_slot = if used_slots.contains(&cand.root_prop) {
                            format!("{}_{}", cand.root_prop, counter)
                        } else {
                            cand.root_prop.clone()
                        };
                        used_slots.insert(val_slot.clone());
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
            collect_stmt_candidates(&if_stmt.consequent, allocator, out, used_slots, counter);
            if let Some(alt) = &if_stmt.alternate {
                collect_stmt_candidates(alt, allocator, out, used_slots, counter);
            }
        }
        Statement::BlockStatement(block) => {
            for s in &block.body {
                collect_stmt_candidates(s, allocator, out, used_slots, counter);
            }
        }
        Statement::TryStatement(try_stmt) => {
            for s in &try_stmt.block.body {
                collect_stmt_candidates(s, allocator, out, used_slots, counter);
            }
            if let Some(h) = &try_stmt.handler {
                for s in &h.body.body {
                    collect_stmt_candidates(s, allocator, out, used_slots, counter);
                }
            }
            if let Some(f) = &try_stmt.finalizer {
                for s in &f.body {
                    collect_stmt_candidates(s, allocator, out, used_slots, counter);
                }
            }
        }
        Statement::SwitchStatement(sw) => {
            for case in &sw.cases {
                for s in &case.consequent {
                    collect_stmt_candidates(s, allocator, out, used_slots, counter);
                }
            }
        }
        _ => {}
    }
}
