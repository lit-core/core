use napi_derive::napi;
use oxc_allocator::{Allocator, CloneIn, GetAllocator, Vec as ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::Visit;
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{SourceType, SPAN};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub use crate::analyzer::{
    analyze_candidate, CandidateInfo, LitSemanticAnalysis, DOM_QUERY_METHODS, IMPURE_GLOBALS,
    MUTATING_ARRAY_METHODS, PURE_ARRAY_METHODS,
};
pub use crate::builder::{
    build_memo_block, collect_classes_mut, replace_candidate_exprs, replace_candidates_in_stmt,
};
pub use crate::finder::{collect_stmt_candidates, CandidateItem, StmtCandidateGroup};

struct BindingCollector {
    bindings: HashSet<String>,
}

impl<'a> Visit<'a> for BindingCollector {
    fn visit_binding_identifier(&mut self, ident: &BindingIdentifier<'a>) {
        self.bindings.insert(ident.name.as_str().to_string());
    }
}

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

pub fn transform_code(source: &str, options: MemoizeOptions) -> MemoizeResult {
    let allocator = Allocator::default();
    let filename = options.filename.as_deref().unwrap_or("file.ts");
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());

    let mut parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return MemoizeResult {
            code: source.to_string(),
            map: None,
            memoized_count: 0,
            components_count: 0,
        };
    }

    let (lit_analysis, existing_bindings) = {
        let semantic_ret = SemanticBuilder::new().build(&parsed.program);
        let lit_analysis =
            LitSemanticAnalysis::new(&parsed.program, semantic_ret.semantic.scoping());
        let mut collector = BindingCollector {
            bindings: HashSet::new(),
        };
        collector.visit_program(&parsed.program);
        (lit_analysis, collector.bindings)
    };

    let mut classes = Vec::new();
    collect_classes_mut(&mut parsed.program.body, &mut classes);

    if classes.is_empty() {
        return MemoizeResult {
            code: source.to_string(),
            map: None,
            memoized_count: 0,
            components_count: 0,
        };
    }

    let mut total_memoized_count: u32 = 0;
    let mut transformed_components_count: u32 = 0;

    for class in classes {
        if !lit_analysis.is_lit_class(class) {
            continue;
        }

        let mut render_body: Option<&mut FunctionBody> = None;

        for elem in &mut class.body.body {
            if let ClassElement::MethodDefinition(method) = elem {
                let method_name = match &method.key {
                    PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                    _ => None,
                };

                if method_name == Some("render") && !method.r#static {
                    if let Some(body) = &mut method.value.body {
                        render_body = Some(body);
                        break;
                    }
                }
            }
        }

        let Some(render_body) = render_body else {
            continue;
        };

        let mut used_slots: HashSet<String> = HashSet::new();
        let mut counter: usize = 0;

        let ast = AstBuilder::new(&allocator);
        let old_statements = std::mem::replace(&mut render_body.statements, ArenaVec::new_in(&ast));
        let mut new_statements = ArenaVec::new_in(&ast);
        let mut class_modified = false;

        let mut declared_slots: Vec<String> = Vec::new();

        for mut stmt in old_statements {
            let mut groups: Vec<StmtCandidateGroup> = Vec::new();
            collect_stmt_candidates(
                &stmt,
                &allocator,
                Some(&lit_analysis),
                &existing_bindings,
                &mut groups,
                &mut used_slots,
                &mut counter,
            );

            if groups.is_empty() {
                new_statements.push(stmt);
                continue;
            }

            class_modified = true;

            let is_single_var_decl =
                groups.len() == 1 && groups[0].is_var_decl && groups[0].candidates.len() == 1;

            if is_single_var_decl {
                let cand = &groups[0].candidates[0];
                let var_name = groups[0].var_name.as_deref().unwrap_or(&cand.var_name);
                total_memoized_count += 1;

                for dep in &cand.dependencies {
                    let name = crate::builder::memo_ref_prop_name(dep);
                    if !declared_slots.contains(&name) {
                        declared_slots.push(name);
                    }
                }
                let val_name = crate::builder::memo_val_prop_name(&cand.val_slot);
                if !declared_slots.contains(&val_name) {
                    declared_slots.push(val_name);
                }

                for s in build_memo_block(
                    var_name,
                    &cand.val_slot,
                    &cand.dependencies,
                    cand.expr.clone_in(&allocator),
                    &ast,
                ) {
                    new_statements.push(s);
                }
            } else {
                for group in &groups {
                    for cand in &group.candidates {
                        total_memoized_count += 1;

                        for dep in &cand.dependencies {
                            let name = crate::builder::memo_ref_prop_name(dep);
                            if !declared_slots.contains(&name) {
                                declared_slots.push(name);
                            }
                        }
                        let val_name = crate::builder::memo_val_prop_name(&cand.val_slot);
                        if !declared_slots.contains(&val_name) {
                            declared_slots.push(val_name);
                        }

                        for s in build_memo_block(
                            &cand.var_name,
                            &cand.val_slot,
                            &cand.dependencies,
                            cand.expr.clone_in(&allocator),
                            &ast,
                        ) {
                            new_statements.push(s);
                        }
                    }

                    replace_candidates_in_stmt(&mut stmt, &group.candidates, &allocator);
                }
                new_statements.push(stmt);
            }
        }

        render_body.statements = new_statements;

        if class_modified {
            transformed_components_count += 1;

            // Declare memoization slot properties on the class body to avoid mutating
            // undeclared properties on `this` at runtime and de-optimizing V8 hidden classes.
            let mut existing_class_props: HashSet<String> = HashSet::new();
            for elem in &class.body.body {
                if let ClassElement::PropertyDefinition(prop) = elem {
                    if let Some(name) = prop.key.static_name() {
                        existing_class_props.insert(name.to_string());
                    }
                }
            }

            let mut declared_elements = ArenaVec::new_in(&ast);
            for slot in &declared_slots {
                if !existing_class_props.contains(slot) {
                    let prop_key = PropertyKey::new_static_identifier(
                        SPAN,
                        ast.allocator().alloc_str(slot),
                        &ast,
                    );
                    let prop_def = ClassElement::new_property_definition(
                        SPAN,
                        PropertyDefinitionType::PropertyDefinition,
                        ArenaVec::new_in(&ast),
                        prop_key,
                        None,
                        None,
                        false,
                        false,
                        false,
                        false,
                        false,
                        false,
                        false,
                        None,
                        &ast,
                    );
                    declared_elements.push(prop_def);
                }
            }

            for elem in class.body.body.drain(..) {
                declared_elements.push(elem);
            }
            class.body.body = declared_elements;
        }
    }

    if transformed_components_count == 0 {
        return MemoizeResult {
            code: source.to_string(),
            map: None,
            memoized_count: 0,
            components_count: 0,
        };
    }

    let codegen = Codegen::new();
    let rewritten = codegen.build(&parsed.program).code;

    MemoizeResult {
        code: rewritten,
        map: None,
        memoized_count: total_memoized_count,
        components_count: transformed_components_count,
    }
}
