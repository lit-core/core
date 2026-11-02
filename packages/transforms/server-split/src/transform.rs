use std::collections::{HashMap, HashSet};

use lit_analysis::parts::{PartAddressing, PartDescriptor, compute_template_parts};
use oxc_allocator::{Allocator, ArenaVec, CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::{Visit, walk};
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SymbolId};
use oxc_span::{GetSpan, SPAN, SourceType};

use crate::client_builder::{ClientBuilder, CompiledEventDescriptor};
use crate::dependency::PropertyDependencyAuditor;
use crate::diagnostics::{DiagnosticCode, error_diagnostic};
use crate::hashing::{compute_action_hash, compute_template_id};
use crate::isolation::{IsolationProof, is_server_only_module_specifier};
use crate::options::{
    ActionMetadata, LoaderMetadata, ParamValidationMeta, ServerSplitDiagnostic, ServerSplitOptions,
    ServerSplitResult,
};
use crate::symbol::{ExtractedServerMethod, ServerDecoratorKind, ServerSymbolContext};
use crate::validator::{build_validator_function, extract_param_schema};
use crate::worker_builder::WorkerBuilder;

pub struct ClientReferenceCollector<'s> {
    pub scoping: &'s Scoping,
    pub referenced_symbols: HashSet<SymbolId>,
    pub unresolved_names: HashSet<String>,
}

impl<'s> ClientReferenceCollector<'s> {
    pub fn new(scoping: &'s Scoping) -> Self {
        Self {
            scoping,
            referenced_symbols: HashSet::new(),
            unresolved_names: HashSet::new(),
        }
    }
}

impl<'s, 'a> Visit<'a> for ClientReferenceCollector<'s> {
    fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
        self.unresolved_names
            .insert(ident.name.as_str().to_string());
        if let Some(r_id) = ident.reference_id.get()
            && let Some(sym_id) = self.scoping.get_reference(r_id).symbol_id()
        {
            self.referenced_symbols.insert(sym_id);
        }
    }
}

pub fn transform_code(source: &str, options: ServerSplitOptions) -> ServerSplitResult {
    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);
    let filename = options.filename.as_deref().unwrap_or("component.ts");
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());

    let parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() && parsed.program.body.is_empty() {
        let first = &parsed.diagnostics[0];
        return ServerSplitResult {
            is_server_element: false,
            tag_name: None,
            class_name: None,
            client_code: source.to_string(),
            worker_code: source.to_string(),
            actions: Vec::new(),
            loaders: Vec::new(),
            diagnostics: vec![ServerSplitDiagnostic {
                code: "PARSE_ERROR".to_string(),
                severity: "error".to_string(),
                message: first.to_string(),
                start: 0,
                end: 0,
            }],
            has_errors: true,
            zero_lit: false,
            build_id: None,
            client_map: None,
            worker_map: None,
        };
    }

    let program = parsed.program;
    let semantic_ret = oxc_semantic::SemanticBuilder::new().build(&program);
    let scoping = semantic_ret.semantic.into_scoping();

    let server_ctx = ServerSymbolContext::scan(&program, &scoping);
    let lit_sym_ctx = lit_analysis::symbol::SymbolProofContext::scan(&program, &scoping, "");

    // Find custom element classes with server methods
    let mut server_element_class_idx = None;
    let mut extracted_methods: Vec<ExtractedServerMethod> = Vec::new();

    for (idx, stmt) in program.body.iter().enumerate() {
        if let Statement::ClassDeclaration(cls) = stmt {
            let methods = server_ctx.extract_server_methods(cls.as_ref());
            if !methods.is_empty() {
                server_element_class_idx = Some(idx);
                extracted_methods = methods;
                break;
            }
        } else if let Statement::ExportDefaultDeclaration(exp) = stmt {
            if let ExportDefaultDeclarationKind::ClassDeclaration(cls) = &exp.declaration {
                let methods = server_ctx.extract_server_methods(cls.as_ref());
                if !methods.is_empty() {
                    server_element_class_idx = Some(idx);
                    extracted_methods = methods;
                    break;
                }
            }
        } else if let Statement::ExportDeclaration(exp) = stmt
            && let Declaration::ClassDeclaration(cls) = &exp.declaration
        {
            let methods = server_ctx.extract_server_methods(cls.as_ref());
            if !methods.is_empty() {
                server_element_class_idx = Some(idx);
                extracted_methods = methods;
                break;
            }
        }
    }

    if server_element_class_idx.is_none() {
        return ServerSplitResult {
            is_server_element: false,
            tag_name: None,
            class_name: None,
            client_code: source.to_string(),
            worker_code: source.to_string(),
            actions: Vec::new(),
            loaders: Vec::new(),
            diagnostics: Vec::new(),
            has_errors: false,
            zero_lit: false,
            build_id: None,
            client_map: None,
            worker_map: None,
        };
    }

    let target_cls_idx = server_element_class_idx.unwrap();
    let target_cls = match &program.body[target_cls_idx] {
        Statement::ClassDeclaration(cls) => cls.as_ref(),
        Statement::ExportDefaultDeclaration(exp) => match &exp.declaration {
            ExportDefaultDeclarationKind::ClassDeclaration(cls) => cls.as_ref(),
            _ => unreachable!(),
        },
        Statement::ExportDeclaration(exp) => match &exp.declaration {
            Declaration::ClassDeclaration(cls) => cls.as_ref(),
            _ => unreachable!(),
        },
        _ => unreachable!(),
    };

    let class_name = target_cls
        .id
        .as_ref()
        .map(|id| id.name.as_str().to_string())
        .unwrap_or_else(|| "ServerComponent".to_string());

    let tag_name = server_ctx.find_tag_name(&program, target_cls);
    let effective_tag = tag_name
        .clone()
        .unwrap_or_else(|| class_name.to_lowercase());

    let mut diagnostics = Vec::new();

    // 1. Isolation proof & record imports used within @loader() and @action()
    let mut isolation_proof = IsolationProof::new(&program, &scoping);
    for m in &extracted_methods {
        if m.kind == ServerDecoratorKind::Loader {
            for p in &m.params {
                for name in &p.binding_names {
                    isolation_proof.add_loader_param(name);
                }
            }
        }

        // Collect all identifier references in server method bodies
        if let Some(body) = &m.method_def.value.body {
            struct ServerBodyRefCollector<'s> {
                scoping: &'s Scoping,
                symbols: HashSet<SymbolId>,
            }
            impl<'s, 'a> Visit<'a> for ServerBodyRefCollector<'s> {
                fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
                    if let Some(r_id) = ident.reference_id.get()
                        && let Some(sym_id) = self.scoping.get_reference(r_id).symbol_id()
                    {
                        self.symbols.insert(sym_id);
                    }
                }
            }
            let mut col = ServerBodyRefCollector {
                scoping: &scoping,
                symbols: HashSet::new(),
            };
            col.visit_function_body(body);

            for stmt in &program.body {
                if let Statement::ImportDeclaration(imp) = stmt {
                    let src = imp.source.value.as_str();
                    if let Some(specs) = &imp.specifiers {
                        for spec in specs {
                            match spec {
                                ImportDeclarationSpecifier::ImportSpecifier(named) => {
                                    let sym_id = named.local.symbol_id.get().or_else(|| {
                                        scoping.get_binding(
                                            scoping.root_scope_id(),
                                            named.local.name.as_str().into(),
                                        )
                                    });
                                    if let Some(sym_id) = sym_id
                                        && col.symbols.contains(&sym_id)
                                    {
                                        isolation_proof.add_server_import(
                                            sym_id,
                                            named.local.name.as_str().to_string(),
                                            src.to_string(),
                                        );
                                    }
                                }
                                ImportDeclarationSpecifier::ImportDefaultSpecifier(def) => {
                                    let sym_id = def.local.symbol_id.get().or_else(|| {
                                        scoping.get_binding(
                                            scoping.root_scope_id(),
                                            def.local.name.as_str().into(),
                                        )
                                    });
                                    if let Some(sym_id) = sym_id
                                        && col.symbols.contains(&sym_id)
                                    {
                                        isolation_proof.add_server_import(
                                            sym_id,
                                            def.local.name.as_str().to_string(),
                                            src.to_string(),
                                        );
                                    }
                                }
                                ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                                    let sym_id = ns.local.symbol_id.get().or_else(|| {
                                        scoping.get_binding(
                                            scoping.root_scope_id(),
                                            ns.local.name.as_str().into(),
                                        )
                                    });
                                    if let Some(sym_id) = sym_id
                                        && col.symbols.contains(&sym_id)
                                    {
                                        isolation_proof.add_server_import(
                                            sym_id,
                                            ns.local.name.as_str().to_string(),
                                            src.to_string(),
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    isolation_proof.audit_class(target_cls, &extracted_methods);
    isolation_proof.audit_module_statements(&program, target_cls_idx);
    diagnostics.extend(isolation_proof.violations.clone());

    // 2. Reactive property dependency audit
    let mut dep_auditor = PropertyDependencyAuditor::new(&program, target_cls, Some(source));
    dep_auditor.audit_server_methods(&extracted_methods);

    let loader_names: HashSet<String> = extracted_methods
        .iter()
        .filter(|m| m.kind == ServerDecoratorKind::Loader)
        .map(|m| m.name.clone())
        .collect();
    dep_auditor.audit_render(target_cls, &loader_names);
    diagnostics.extend(dep_auditor.diagnostics);

    // Enforce SE106 diagnostic when component defines client lifecycle methods or custom methods
    for element in &target_cls.body.body {
        if let ClassElement::MethodDefinition(method) = element {
            let name = match &method.key {
                PropertyKey::StaticIdentifier(id) => id.name.as_str(),
                PropertyKey::StringLiteral(s) => s.value.as_str(),
                _ => continue,
            };
            if name == "constructor"
                || name == "render"
                || extracted_methods.iter().any(|m| m.name == name)
            {
                continue;
            }
            if matches!(
                name,
                "firstUpdated" | "updated" | "willUpdate" | "update" | "shouldUpdate"
            ) {
                diagnostics.push(error_diagnostic(
                    DiagnosticCode::SE106,
                    format!(
                        "Class '{}' defines Lit reactive lifecycle method '{}()', which prevents zero-Lit HTMLElement stub generation. Server elements in v1 support zero-Lit pure DOM stubs only.",
                        class_name, name
                    ),
                    method.span,
                ));
            } else {
                diagnostics.push(error_diagnostic(
                    DiagnosticCode::SE106,
                    format!(
                        "Method '{}()' in class '{}' is not an @action(), @loader(), constructor, or render() method. Client-side reactive methods are not supported in zero-Lit server element stubs.",
                        name, class_name
                    ),
                    method.span,
                ));
            }
        }
    }

    // 3. Process actions: validate parameter schemas, synthesize validator AST, and compute hashes
    let mut action_metadata_list = Vec::new();
    let mut action_metadata_map = HashMap::new();
    let mut validator_function_stmts = Vec::new();

    for m in &extracted_methods {
        if m.kind == ServerDecoratorKind::Action {
            if !m.is_async {
                diagnostics.push(error_diagnostic(
                    DiagnosticCode::SE105,
                    format!("@action() method '{}' must be declared async.", m.name),
                    m.span,
                ));
            }

            let mut param_metas = Vec::new();
            let mut param_schemas = Vec::new();

            for p in &m.params {
                let schema_res = if let Some(type_ann) = p.ts_type_annotation {
                    extract_param_schema(&type_ann.type_annotation, &p.name, p.optional, p.span)
                } else {
                    Err((
                        DiagnosticCode::SE105,
                        format!(
                            "Missing parameter type annotation on @action() parameter '{}'. All action arguments must be explicitly typed.",
                            p.name
                        ),
                        p.span,
                    ))
                };

                match schema_res {
                    Ok(schema) => {
                        param_metas.push(ParamValidationMeta {
                            name: p.name.clone(),
                            ts_type: schema.to_meta_type_string(),
                            optional: p.optional,
                        });
                        param_schemas.push((p.name.clone(), schema, p.optional));
                    }
                    Err((code, msg, span)) => {
                        diagnostics.push(error_diagnostic(code, msg, span));
                    }
                }
            }

            let hash = compute_action_hash(&effective_tag, &m.name, &param_metas);

            let writes = dep_auditor
                .action_written_props
                .get(&m.name)
                .cloned()
                .unwrap_or_default();

            let act_meta = ActionMetadata {
                name: m.name.clone(),
                hash: hash.clone(),
                params: param_metas,
                written_properties: writes,
            };

            action_metadata_map.insert(m.name.clone(), act_meta.clone());
            action_metadata_list.push(act_meta);

            // Synthesize validator AST function
            let val_fn = build_validator_function(&ast, &m.name, &param_schemas);
            validator_function_stmts.push(val_fn);
        }
    }

    // 4. Process loaders
    let mut loader_metadata_list = Vec::new();
    for m in &extracted_methods {
        if m.kind == ServerDecoratorKind::Loader {
            let writes: Vec<String> = dep_auditor.loader_written_props.iter().cloned().collect();
            loader_metadata_list.push(LoaderMetadata {
                name: m.name.clone(),
                written_properties: writes,
            });
        }
    }

    // 5. Template analysis: compute dynamic parts, property dependencies, and event handlers
    let mut template_parts: Vec<PartDescriptor> = Vec::new();
    let mut part_deps: Vec<Vec<String>> = Vec::new();
    let mut template_id = String::new();
    let mut event_descriptors: Vec<CompiledEventDescriptor> = Vec::new();

    for element in &target_cls.body.body {
        if let ClassElement::MethodDefinition(method) = element {
            let is_render = method
                .key
                .static_name()
                .map(|n| n == "render")
                .unwrap_or(false);
            if is_render && let Some(body) = &method.value.body {
                for stmt in &body.statements {
                    if let Statement::ReturnStatement(ret) = stmt
                        && let Some(arg) = &ret.argument
                        && let Expression::TaggedTemplateExpression(tagged) =
                            arg.without_parentheses()
                        && (lit_sym_ctx.is_lit_html_tag(&tagged.tag)
                            || lit_sym_ctx.is_lit_svg_tag(&tagged.tag))
                    {
                        let quasi_strs: Vec<&str> = tagged
                            .quasi
                            .quasis
                            .iter()
                            .map(|q| q.value.raw.as_str())
                            .collect();
                        let expr_count = tagged.quasi.expressions.len();
                        template_id = compute_template_id(&quasi_strs);

                        match compute_template_parts(&quasi_strs, expr_count) {
                            Ok(parts) => {
                                template_parts = parts;
                            }
                            Err(err) => {
                                diagnostics.push(error_diagnostic(
                                    DiagnosticCode::SE106,
                                    format!("Failed to analyze template parts: {}", err),
                                    tagged.span,
                                ));
                            }
                        }

                        // Process each dynamic expression for deps and event bindings
                        for (i, expr) in tagged.quasi.expressions.iter().enumerate() {
                            let event_part = template_parts.iter().find(|p| {
                                p.index == i
                                    && match &p.addressing {
                                        PartAddressing::ElementAnchored { prefix, .. } => {
                                            prefix.as_deref() == Some("@")
                                        }
                                        _ => false,
                                    }
                            });

                            if let Some(part) = event_part {
                                part_deps.push(Vec::new());

                                let event_name = match &part.addressing {
                                    PartAddressing::ElementAnchored { attr_name, .. } => {
                                        attr_name.clone().unwrap_or_else(|| "click".to_string())
                                    }
                                    _ => "click".to_string(),
                                };

                                // Classify event expression
                                match expr.without_parentheses() {
                                    Expression::StaticMemberExpression(mem)
                                        if matches!(
                                            mem.object.without_parentheses(),
                                            Expression::ThisExpression(_)
                                        ) =>
                                    {
                                        let action_name = mem.property.name.as_str();
                                        if let Some(act) = action_metadata_map.get(action_name) {
                                            event_descriptors.push(CompiledEventDescriptor {
                                                path: part.path.clone(),
                                                event: event_name,
                                                action_hash: act.hash.clone(),
                                                arg_expr: None,
                                            });
                                        } else {
                                            diagnostics.push(error_diagnostic(
                                                        DiagnosticCode::SE106,
                                                        format!(
                                                            "Event handler '@{}' references 'this.{}', which is not decorated with @action(). All client-invoked event handlers in zero-Lit server elements must target an @action() method.",
                                                            event_name, action_name
                                                        ),
                                                        expr.span(),
                                                    ));
                                        }
                                    }
                                    Expression::ArrowFunctionExpression(arrow) => {
                                        let call_opt = match &arrow.body {
                                            ArrowFunctionBody::FunctionBody(body) => {
                                                if body.statements.len() == 1 {
                                                    match &body.statements[0] {
                                                        Statement::ExpressionStatement(e) => {
                                                            Some(&e.expression)
                                                        }
                                                        Statement::ReturnStatement(r) => {
                                                            r.argument.as_ref()
                                                        }
                                                        _ => None,
                                                    }
                                                } else {
                                                    None
                                                }
                                            }
                                            _ => arrow.body.as_expression(),
                                        };

                                        if let Some(Expression::CallExpression(call)) =
                                            call_opt.map(|e| e.without_parentheses())
                                        {
                                            if let Expression::StaticMemberExpression(mem) =
                                                call.callee.without_parentheses()
                                                && matches!(
                                                    mem.object.without_parentheses(),
                                                    Expression::ThisExpression(_)
                                                )
                                            {
                                                let action_name = mem.property.name.as_str();
                                                if let Some(act) =
                                                    action_metadata_map.get(action_name)
                                                {
                                                    let mut valid_args = true;
                                                    let mut arg_elems = ArenaVec::new_in(&ast);

                                                    for arg in &call.arguments {
                                                        match arg.as_expression() {
                                                            Some(
                                                                Expression::BooleanLiteral(_)
                                                                | Expression::NumericLiteral(_)
                                                                | Expression::StringLiteral(_)
                                                                | Expression::BigIntLiteral(_)
                                                                | Expression::NullLiteral(_),
                                                            ) => {
                                                                arg_elems.push(
                                                                    ArrayExpressionElement::from(
                                                                        arg.as_expression()
                                                                            .unwrap()
                                                                            .clone_in(&allocator),
                                                                    ),
                                                                );
                                                            }
                                                            Some(
                                                                Expression::StaticMemberExpression(
                                                                    m,
                                                                ),
                                                            ) if matches!(
                                                                m.object.without_parentheses(),
                                                                Expression::ThisExpression(_)
                                                            ) =>
                                                            {
                                                                arg_elems.push(
                                                                            ArrayExpressionElement::from(
                                                                                Expression::StaticMemberExpression(
                                                                                    m.clone_in(&allocator),
                                                                                ),
                                                                            ),
                                                                        );
                                                            }
                                                            _ => {
                                                                valid_args = false;
                                                                break;
                                                            }
                                                        }
                                                    }

                                                    if valid_args {
                                                        let arr_expr =
                                                            Expression::new_array_expression(
                                                                SPAN, arg_elems, &ast,
                                                            );
                                                        let formal_params = FormalParameters::boxed(
                                                            SPAN,
                                                            FormalParameterKind::FormalParameter,
                                                            ArenaVec::new_in(&ast),
                                                            None,
                                                            &ast,
                                                        );
                                                        let arg_arrow =
                                                                    Expression::new_arrow_function_expression(
                                                                        SPAN,
                                                                        true,
                                                                        None,
                                                                        formal_params,
                                                                        None,
                                                                        ArrowFunctionBody::from(
                                                                            arr_expr,
                                                                        ),
                                                                        &ast,
                                                                    );

                                                        event_descriptors.push(
                                                            CompiledEventDescriptor {
                                                                path: part.path.clone(),
                                                                event: event_name,
                                                                action_hash: act.hash.clone(),
                                                                arg_expr: Some(arg_arrow),
                                                            },
                                                        );
                                                    } else {
                                                        diagnostics.push(error_diagnostic(
                                                                    DiagnosticCode::SE106,
                                                                    format!(
                                                                        "Unsupported argument in template event handler '@{}'. Arrow wrappers may only pass literals or 'this.<property>' references.",
                                                                        event_name
                                                                    ),
                                                                    call.span,
                                                                ));
                                                    }
                                                } else {
                                                    diagnostics.push(error_diagnostic(
                                                                DiagnosticCode::SE106,
                                                                format!(
                                                                    "Event handler '@{}' arrow wrapper must call an @action() method on this.",
                                                                    event_name
                                                                ),
                                                                call.span,
                                                            ));
                                                }
                                            } else {
                                                diagnostics.push(error_diagnostic(
                                                            DiagnosticCode::SE106,
                                                            format!(
                                                                "Unsupported client closure in template event handler '@{}'. Event handlers on server elements must be direct @action method references (e.g. '@click=${{this.<action>}}') or arrow wrappers passing literals or reactive properties (e.g. '@click=${{() => this.<action>(10)}}').",
                                                                event_name
                                                            ),
                                                            expr.span(),
                                                        ));
                                            }
                                        } else {
                                            diagnostics.push(error_diagnostic(
                                                        DiagnosticCode::SE106,
                                                        format!(
                                                            "Unsupported client closure in template event handler '@{}'. Event handlers on server elements must be direct @action method references (e.g. '@click=${{this.<action>}}') or arrow wrappers passing literals or reactive properties (e.g. '@click=${{() => this.<action>(10)}}').",
                                                            event_name
                                                        ),
                                                        expr.span(),
                                                    ));
                                        }
                                    }
                                    _ => {
                                        diagnostics.push(error_diagnostic(
                                                    DiagnosticCode::SE106,
                                                    format!(
                                                        "Unsupported client closure in template event handler '@{}'. Event handlers on server elements must be direct @action method references (e.g. '@click=${{this.<action>}}') or arrow wrappers passing literals or reactive properties (e.g. '@click=${{() => this.<action>(10)}}').",
                                                        event_name
                                                    ),
                                                    expr.span(),
                                                ));
                                    }
                                }
                            } else {
                                // Collect reactive property dependencies on this
                                struct PropCollector {
                                    props: Vec<String>,
                                }
                                impl<'a> Visit<'a> for PropCollector {
                                    fn visit_member_expression(
                                        &mut self,
                                        mem: &MemberExpression<'a>,
                                    ) {
                                        if let MemberExpression::StaticMemberExpression(s) = mem
                                            && let Expression::ThisExpression(_) =
                                                s.object.without_parentheses()
                                        {
                                            let p = s.property.name.as_str().to_string();
                                            if !self.props.contains(&p) {
                                                self.props.push(p);
                                            }
                                        }
                                        walk::walk_member_expression(self, mem);
                                    }
                                }
                                let mut col = PropCollector { props: Vec::new() };
                                col.visit_expression(expr);
                                part_deps.push(col.props);
                            }
                        }
                    }
                }
            }
        }
    }

    let has_errors = diagnostics.iter().any(|d| d.severity == "error");
    let build_id = options.build_id.as_deref().unwrap_or("dev");

    // 6. Build Worker Artifact AST
    let worker_builder = WorkerBuilder::new(&ast, &server_ctx);
    let mut worker_body = ArenaVec::new_in(&ast);

    for (idx, stmt) in program.body.iter().enumerate() {
        if idx == target_cls_idx {
            let transformed_cls = worker_builder.transform_class_for_worker(
                target_cls,
                &template_parts,
                &part_deps,
                &template_id,
                build_id,
            );
            let cls_stmt = match stmt {
                Statement::ClassDeclaration(_) => Statement::ClassDeclaration(transformed_cls),
                Statement::ExportDefaultDeclaration(exp) => {
                    let mut new_exp = exp.clone_in(&allocator);
                    new_exp.declaration =
                        ExportDefaultDeclarationKind::ClassDeclaration(transformed_cls);
                    Statement::ExportDefaultDeclaration(new_exp)
                }
                Statement::ExportDeclaration(exp) => {
                    let mut new_exp = exp.clone_in(&allocator);
                    new_exp.declaration = Declaration::ClassDeclaration(transformed_cls);
                    Statement::ExportDeclaration(new_exp)
                }
                _ => unreachable!(),
            };
            worker_body.push(cls_stmt);
        } else {
            worker_body.push(stmt.clone_in(&allocator));
        }
    }

    // Append validator functions to worker AST
    for val_fn in validator_function_stmts {
        worker_body.push(val_fn);
    }

    // Append __lit_actions, __lit_loaders, and __litBuildId descriptors
    let class_name_str = ast.allocator().alloc_str(&class_name);
    worker_body
        .push(worker_builder.build_actions_descriptor(class_name_str, &action_metadata_list));
    worker_body
        .push(worker_builder.build_loaders_descriptor(class_name_str, &loader_metadata_list));
    worker_body.push(worker_builder.build_build_id_statement(class_name_str, build_id));

    let worker_program = Program::new(
        SPAN,
        source_type,
        source,
        ArenaVec::new_in(&ast),
        None,
        ArenaVec::new_in(&ast),
        worker_body,
        &ast,
    );

    // 7. Build Client Artifact AST
    let client_builder = ClientBuilder::new(&ast, &server_ctx);
    let zero_lit = options
        .emit_zero_lit_client
        .unwrap_or_else(|| client_builder.is_zero_lit_eligible(target_cls, &extracted_methods))
        && client_builder.is_zero_lit_eligible(target_cls, &extracted_methods);

    let has_custom_elements_define =
        server_ctx.is_class_registered_via_custom_elements_define(&program, target_cls);

    // Stage 1: Build non-import client statements
    let mut client_non_imports = ArenaVec::new_in(&ast);

    for (idx, stmt) in program.body.iter().enumerate() {
        if idx == target_cls_idx {
            let transformed_cls = client_builder.transform_class_for_client(
                target_cls,
                &extracted_methods,
                &action_metadata_map,
                &template_parts,
                &part_deps,
                &template_id,
                build_id,
                &event_descriptors,
                zero_lit,
            );
            let cls_stmt = match stmt {
                Statement::ClassDeclaration(_) => Statement::ClassDeclaration(transformed_cls),
                Statement::ExportDefaultDeclaration(exp) => {
                    let mut new_exp = exp.clone_in(&allocator);
                    new_exp.declaration =
                        ExportDefaultDeclarationKind::ClassDeclaration(transformed_cls);
                    Statement::ExportDefaultDeclaration(new_exp)
                }
                Statement::ExportDeclaration(exp) => {
                    let mut new_exp = exp.clone_in(&allocator);
                    new_exp.declaration = Declaration::ClassDeclaration(transformed_cls);
                    Statement::ExportDeclaration(new_exp)
                }
                _ => unreachable!(),
            };
            client_non_imports.push(cls_stmt);

            if zero_lit
                && let Some(tag) = &tag_name
                && !has_custom_elements_define
            {
                client_non_imports
                    .push(client_builder.build_custom_elements_define(tag, &class_name));
            }
        } else if matches!(stmt, Statement::ImportDeclaration(_)) {
            continue;
        } else if let Statement::ExportAllDeclaration(export_all) = stmt {
            if !is_server_only_module_specifier(export_all.source.value.as_str()) {
                client_non_imports.push(stmt.clone_in(&allocator));
            }
        } else if let Statement::ExportFromDeclaration(export_from) = stmt {
            if !is_server_only_module_specifier(export_from.source.value.as_str()) {
                client_non_imports.push(stmt.clone_in(&allocator));
            }
        } else if let Statement::ExportNamedDeclaration(export_named) = stmt {
            let mut retained_specs = ArenaVec::new_in(&ast);
            for spec in &export_named.specifiers {
                let name = spec.local.name();
                let is_server = if let ModuleExportName::IdentifierReference(ident) = &spec.local {
                    if let Some(r_id) = ident.reference_id.get() {
                        if let Some(sym_id) = scoping.get_reference(r_id).symbol_id() {
                            isolation_proof.server_symbols.contains_key(&sym_id)
                        } else {
                            isolation_proof
                                .server_symbol_names
                                .contains_key(name.as_str())
                        }
                    } else {
                        isolation_proof
                            .server_symbol_names
                            .contains_key(name.as_str())
                    }
                } else {
                    isolation_proof
                        .server_symbol_names
                        .contains_key(name.as_str())
                };
                if !is_server {
                    retained_specs.push(spec.clone_in(&allocator));
                }
            }
            if !retained_specs.is_empty() {
                let mut new_exp = export_named.clone_in(&allocator);
                new_exp.specifiers = retained_specs;
                client_non_imports.push(Statement::ExportNamedDeclaration(new_exp));
            }
        } else {
            if !isolation_proof.statement_references_server(stmt) {
                client_non_imports.push(stmt.clone_in(&allocator));
            }
        }
    }

    // Stage 2: Collect all referenced symbols in client non-import statements
    let mut ref_collector = ClientReferenceCollector::new(&scoping);
    for stmt in &client_non_imports {
        ref_collector.visit_statement(stmt);
    }

    // Stage 3: Prune imports using reference set
    let mut client_imports = ArenaVec::new_in(&ast);
    client_imports.push(client_builder.build_client_rpc_import(!event_descriptors.is_empty()));

    for stmt in &program.body {
        if let Statement::ImportDeclaration(import_decl) = stmt
            && let Some(pruned_import) = client_builder.prune_client_import(
                import_decl,
                &ref_collector.referenced_symbols,
                &ref_collector.unresolved_names,
                zero_lit,
            )
        {
            client_imports.push(pruned_import);
        }
    }

    // Stage 4: Combine into final client body
    let mut client_body = ArenaVec::new_in(&ast);
    client_body.extend(client_imports);
    client_body.extend(client_non_imports);

    let client_program = Program::new(
        SPAN,
        source_type,
        source,
        ArenaVec::new_in(&ast),
        None,
        ArenaVec::new_in(&ast),
        client_body,
        &ast,
    );

    // 8. Build codegen outputs with sourcemaps
    let mut codegen_options = oxc_codegen::CodegenOptions::default();
    if options.sourcemap.unwrap_or(false) {
        let source_path = options.filename.as_deref().unwrap_or("component.ts");
        codegen_options.source_map_path = Some(std::path::PathBuf::from(source_path));
    }

    let client_codegen = Codegen::new()
        .with_options(codegen_options.clone())
        .build(&client_program);
    let worker_codegen = Codegen::new()
        .with_options(codegen_options)
        .build(&worker_program);

    let client_code = client_codegen.code;
    let client_map = client_codegen.map.map(|m| m.to_json_string());
    let worker_code = worker_codegen.code;
    let worker_map = worker_codegen.map.map(|m| m.to_json_string());

    ServerSplitResult {
        is_server_element: true,
        tag_name,
        class_name: Some(class_name),
        client_code,
        worker_code,
        actions: action_metadata_list,
        loaders: loader_metadata_list,
        diagnostics,
        has_errors,
        zero_lit,
        build_id: Some(build_id.to_string()),
        client_map,
        worker_map,
    }
}
