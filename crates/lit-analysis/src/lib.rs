use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{SourceType, Span};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub mod classify;
pub mod decorator;
pub mod diagnostics;
pub mod manifest;
pub mod property;
pub mod symbol;
pub mod template_ir;

pub use classify::{BailoutReason, ClassificationTier, ComponentClassifier};
pub use decorator::{DecoratorExtractor, ExtractedDecorator, LitDecoratorKind};
pub use diagnostics::{Diagnostic, DiagnosticCode, DiagnosticSeverity};
pub use manifest::{
    ComponentRef, EventInfo, LibraryManifest, LitComponentInfo, ManifestScanner, ModuleManifest,
    ShadowRootOptions, SlotInfo, StyleInfo,
};
pub use property::{PropertyInfo, PropertyModelExtractor, PropertyType};
pub use symbol::{CanonicalLitSymbol, HeritageProof, SymbolProofContext};
pub use template_ir::{
    AttributePart, AttributePrefix, AttributeValue, ElementNamespace, TemplateAttribute,
    TemplateElement, TemplateIR, TemplateNode, TemplateParser, TemplateSlot,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LitModuleAnalysis {
    pub components: Vec<LitComponentInfo>,
    pub manifest: ModuleManifest,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, thiserror::Error)]
pub enum AnalysisError {
    #[error("Failed to parse JavaScript/TypeScript source: {0}")]
    ParseError(String),
    #[error("Internal analysis error: {0}")]
    Internal(String),
}

/// Primary analysis entry point for a Lit module.
pub fn analyze_lit_module(
    allocator: &Allocator,
    source_text: &str,
    file_path: &str,
) -> Result<LitModuleAnalysis, AnalysisError> {
    let source_type =
        SourceType::from_path(Path::new(file_path)).unwrap_or_else(|_| SourceType::ts());

    let parsed = Parser::new(allocator, source_text, source_type).parse();
    if !parsed.diagnostics.is_empty() && parsed.program.body.is_empty() {
        let first_err = &parsed.diagnostics[0];
        return Err(AnalysisError::ParseError(first_err.to_string()));
    }

    let program = parsed.program;
    let semantic_ret = SemanticBuilder::new().build(&program);
    let scoping = semantic_ret.semantic.into_scoping();

    let symbol_ctx = SymbolProofContext::scan(&program, &scoping, source_text);

    let mut components = Vec::new();
    let mut diagnostics = Vec::new();

    // Scan for class declarations and export declarations
    for stmt in &program.body {
        match stmt {
            oxc_ast::ast::Statement::ClassDeclaration(cls) => {
                analyze_class_node(
                    &program,
                    cls,
                    &symbol_ctx,
                    &mut components,
                    &mut diagnostics,
                );
            }
            oxc_ast::ast::Statement::ExportDefaultDeclaration(exp) => {
                if let oxc_ast::ast::ExportDefaultDeclarationKind::ClassDeclaration(cls) =
                    &exp.declaration
                {
                    analyze_class_node(
                        &program,
                        cls,
                        &symbol_ctx,
                        &mut components,
                        &mut diagnostics,
                    );
                }
            }
            oxc_ast::ast::Statement::ExportDeclaration(exp) => {
                if let oxc_ast::ast::Declaration::ClassDeclaration(cls) = &exp.declaration {
                    analyze_class_node(
                        &program,
                        cls,
                        &symbol_ctx,
                        &mut components,
                        &mut diagnostics,
                    );
                }
            }
            _ => {}
        }
    }

    let manifest = ModuleManifest {
        file_path: file_path.to_string(),
        components: components.clone(),
    };

    Ok(LitModuleAnalysis {
        components,
        manifest,
        diagnostics,
    })
}

fn analyze_class_node<'a>(
    program: &'a oxc_ast::ast::Program<'a>,
    class: &'a oxc_ast::ast::Class<'a>,
    ctx: &SymbolProofContext<'a>,
    components: &mut Vec<LitComponentInfo>,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let class_name = class
        .id
        .as_ref()
        .map(|id| id.name.as_str().to_string())
        .unwrap_or_else(|| "AnonymousComponent".to_string());

    let heritage = ctx.prove_heritage(class);

    let (is_lit, super_class_name, mixins) = match heritage {
        HeritageProof::ProvenLitElement { mixins, .. } => {
            (true, Some("LitElement".to_string()), mixins)
        }
        HeritageProof::ProvenReactiveElement { mixins, .. } => {
            (true, Some("ReactiveElement".to_string()), mixins)
        }
        HeritageProof::LocalSubclass {
            base_class_name,
            mixins,
        } => (true, Some(base_class_name), mixins),
        HeritageProof::CrossModuleSubclass {
            imported_name,
            mixins,
            ..
        } => {
            let is_known_element = imported_name == "LitElement"
                || imported_name == "ReactiveElement"
                || imported_name == "MorphHost"
                || imported_name.ends_with("Element")
                || imported_name.ends_with("Host");
            if !is_known_element {
                diagnostics.push(Diagnostic::unresolvable_inheritance(
                    &class_name,
                    &imported_name,
                    class.span,
                ));
            }
            (true, Some(imported_name), mixins)
        }
        HeritageProof::ContractualLitElement { mixins, .. } => (true, None, mixins),
        HeritageProof::UnrelatedClass | HeritageProof::Unresolved => (false, None, Vec::new()),
    };

    if !is_lit {
        return;
    }

    // 1. Extract decorators across class body and transpiled helper calls
    let mut class_decorators = DecoratorExtractor::extract_class_decorators(class, ctx);
    let mut member_decorators = DecoratorExtractor::extract_member_decorators(class, ctx);
    let transpiled_decorators =
        DecoratorExtractor::extract_transpiled_helpers(program, &class_name, ctx);

    for td in transpiled_decorators {
        if td.target_member.is_some() {
            member_decorators.push(td);
        } else {
            class_decorators.push(td);
        }
    }

    let mut all_decorators = class_decorators.clone();
    all_decorators.extend(member_decorators.clone());

    // 2. Custom element tag name
    let tag_name =
        DecoratorExtractor::extract_custom_element_tag(program, &class_name, &class_decorators);
    let component_name = ManifestScanner::derive_component_name(tag_name.as_deref(), &class_name);

    // 3. Properties extraction
    let properties = PropertyModelExtractor::extract_all(
        program,
        class,
        &class_name,
        &all_decorators,
        Some(ctx.source_text),
    );

    // 4. Template IR extraction from render() method
    let template = extract_component_template(class, ctx);

    // 5. Slots extraction
    let slots = ManifestScanner::extract_slots(Some(class), template.as_ref(), Some(ctx));

    // 6. Events extraction
    let events = ManifestScanner::extract_events(class, template.as_ref(), &all_decorators);

    // 7. Styles extraction
    let styles = ManifestScanner::extract_styles(class, ctx);

    // 8. Shadow root options
    let shadow_root_options = ManifestScanner::extract_shadow_root_options(class);

    // 9. Component classification
    let tier = ComponentClassifier::classify(
        class,
        &properties,
        &events,
        &slots,
        shadow_root_options.as_ref(),
        template.as_ref(),
        &all_decorators,
        ctx,
    );

    // 10. Generate diagnostics based on tier classification
    match &tier {
        ClassificationTier::Bailout { reasons } => {
            for reason in reasons {
                let diag = match reason {
                    BailoutReason::UnsupportedDirective { name, span } => {
                        Diagnostic::unsupported_directive(name, Span::new(span.0, span.1))
                    }
                    BailoutReason::UnresolvableThisEscape { expression, span } => {
                        Diagnostic::escaping_this(expression, Span::new(span.0, span.1))
                    }
                    BailoutReason::DynamicTagName { span } => {
                        Diagnostic::dynamic_tag_name(Span::new(span.0, span.1))
                    }
                    BailoutReason::UnresolvableInheritance { base_class, span } => {
                        Diagnostic::unresolvable_inheritance(
                            &class_name,
                            base_class,
                            Span::new(span.0, span.1),
                        )
                    }
                    BailoutReason::DirectShadowRootAccess { operation, span } => {
                        Diagnostic::shadow_root_access(operation, Span::new(span.0, span.1))
                    }
                    BailoutReason::ConflictingEventNames {
                        event_name,
                        camel_name,
                        span,
                    } => Diagnostic::conflicting_event_names(
                        event_name,
                        camel_name,
                        Span::new(span.0, span.1),
                    ),
                };
                diagnostics.push(diag);
            }
        }
        ClassificationTier::Tier0Pure => {
            diagnostics.push(Diagnostic::tier0_pure_info(&class_name));
        }
        _ => {}
    }

    components.push(LitComponentInfo {
        tag_name,
        class_name,
        component_name,
        tier,
        properties,
        events,
        slots,
        styles,
        shadow_root_options,
        template,
        super_class: super_class_name,
        mixins,
    });
}

fn extract_component_template<'a>(
    class: &'a oxc_ast::ast::Class<'a>,
    ctx: &SymbolProofContext<'a>,
) -> Option<TemplateIR> {
    for element in &class.body.body {
        if let oxc_ast::ast::ClassElement::MethodDefinition(method) = element {
            if !method.r#static && method.key.is_specific_static_name("render") {
                if let Some(body) = &method.value.body {
                    for stmt in &body.statements {
                        if let oxc_ast::ast::Statement::ReturnStatement(ret) = stmt {
                            if let Some(arg) = &ret.argument {
                                let mut curr = arg;
                                while let oxc_ast::ast::Expression::ParenthesizedExpression(p) =
                                    curr
                                {
                                    curr = &p.expression;
                                }
                                if let oxc_ast::ast::Expression::TaggedTemplateExpression(tagged) =
                                    curr
                                {
                                    if ctx.is_lit_html_tag(&tagged.tag)
                                        || ctx.is_lit_svg_tag(&tagged.tag)
                                        || is_html_or_svg_tag_fallback(&tagged.tag)
                                    {
                                        let quasis: Vec<&str> = tagged
                                            .quasi
                                            .quasis
                                            .iter()
                                            .map(|q| q.value.raw.as_str())
                                            .collect();
                                        let expr_count = tagged.quasi.expressions.len();
                                        return TemplateParser::parse_lit_template(
                                            &quasis, expr_count,
                                        )
                                        .ok();
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

fn is_html_or_svg_tag_fallback(expr: &oxc_ast::ast::Expression) -> bool {
    match expr {
        oxc_ast::ast::Expression::Identifier(id) => id.name == "html" || id.name == "svg",
        oxc_ast::ast::Expression::StaticMemberExpression(mem) => {
            mem.property.name == "html" || mem.property.name == "svg"
        }
        _ => false,
    }
}
