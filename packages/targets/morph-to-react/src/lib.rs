use lit_analysis::analyze_lit_module;
use napi_derive::napi;
use oxc_allocator::{Allocator, CloneIn};
use serde::{Deserialize, Serialize};

pub mod cache;
pub mod emit_bailout;
pub mod emit_css;
pub mod emit_host;
pub mod emit_jsx;
pub mod emit_types;

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct AnalyzeOptions {
    pub filename: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PropertyDto {
    pub name: String,
    pub property_type: String,
    pub attribute: Option<String>,
    pub reflect: bool,
    pub has_changed: Option<String>,
    pub no_accessor: bool,
    pub is_state: bool,
    pub default_value: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EventDto {
    pub name: String,
    pub prop_name: String,
    pub detail_type: Option<String>,
    pub bubbles: bool,
    pub cancelable: bool,
    pub composed: bool,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SlotDto {
    pub name: Option<String>,
    pub has_fallback: bool,
    pub inspected: bool,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StyleDto {
    pub css_text: String,
    pub is_shared: bool,
    pub shared_import_path: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ComponentDto {
    pub tag_name: Option<String>,
    pub class_name: String,
    pub component_name: String,
    pub tier: String,
    pub properties: Vec<PropertyDto>,
    pub events: Vec<EventDto>,
    pub slots: Vec<SlotDto>,
    pub styles: Vec<StyleDto>,
    pub template: Option<serde_json::Value>,
    pub super_class: Option<String>,
    pub mixins: Vec<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DiagnosticDto {
    pub code: String,
    pub severity: String,
    pub message: String,
    pub span_start: u32,
    pub span_end: u32,
    pub universal_lit_hint: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AnalysisResultDto {
    pub components: Vec<ComponentDto>,
    pub diagnostics: Vec<DiagnosticDto>,
    pub manifest_file_path: String,
}

#[napi]
pub fn analyze_lit(
    source: String,
    options: Option<AnalyzeOptions>,
) -> Result<AnalysisResultDto, napi::Error> {
    let filename = options
        .as_ref()
        .and_then(|o| o.filename.clone())
        .unwrap_or_else(|| "file.ts".to_string());

    let allocator = Allocator::default();
    let analysis = analyze_lit_module(&allocator, &source, &filename)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let components = analysis
        .components
        .into_iter()
        .map(|c| {
            let tier_str = match &c.tier {
                lit_analysis::ClassificationTier::Tier0Pure => "Tier0Pure".to_string(),
                lit_analysis::ClassificationTier::Tier1Hosted => "Tier1Hosted".to_string(),
                lit_analysis::ClassificationTier::Tier2HostedWithFacade => {
                    "Tier2HostedWithFacade".to_string()
                }
                lit_analysis::ClassificationTier::Bailout { .. } => "Bailout".to_string(),
            };

            ComponentDto {
                tag_name: c.tag_name,
                class_name: c.class_name,
                component_name: c.component_name,
                tier: tier_str,
                properties: c
                    .properties
                    .into_iter()
                    .map(|p| PropertyDto {
                        name: p.name,
                        property_type: format!("{:?}", p.property_type),
                        attribute: p.attribute,
                        reflect: p.reflect,
                        has_changed: p.has_changed,
                        no_accessor: p.no_accessor,
                        is_state: p.is_state,
                        default_value: p.default_value,
                    })
                    .collect(),
                events: c
                    .events
                    .into_iter()
                    .map(|e| EventDto {
                        name: e.name,
                        prop_name: e.prop_name,
                        detail_type: e.detail_type,
                        bubbles: e.bubbles,
                        cancelable: e.cancelable,
                        composed: e.composed,
                    })
                    .collect(),
                slots: c
                    .slots
                    .into_iter()
                    .map(|s| SlotDto {
                        name: s.name,
                        has_fallback: s.has_fallback,
                        inspected: s.inspected,
                    })
                    .collect(),
                styles: c
                    .styles
                    .into_iter()
                    .map(|s| StyleDto {
                        css_text: s.css_text,
                        is_shared: s.is_shared,
                        shared_import_path: s.shared_import_path,
                    })
                    .collect(),
                template: c.template.and_then(|t| serde_json::to_value(t).ok()),
                super_class: c.super_class,
                mixins: c.mixins,
            }
        })
        .collect();

    let diagnostics = analysis
        .diagnostics
        .into_iter()
        .map(|d| DiagnosticDto {
            code: d.code.as_str().to_string(),
            severity: format!("{:?}", d.severity),
            message: d.message,
            span_start: d.span.0,
            span_end: d.span.1,
            universal_lit_hint: d.universal_lit_hint,
        })
        .collect();

    Ok(AnalysisResultDto {
        components,
        diagnostics,
        manifest_file_path: analysis.manifest.file_path,
    })
}

#[napi]
pub fn parse_lit_template(
    quasis: Vec<String>,
    expression_count: u32,
) -> Result<serde_json::Value, napi::Error> {
    let quasis_ref: Vec<&str> = quasis.iter().map(|s| s.as_str()).collect();
    let ir =
        lit_analysis::TemplateParser::parse_lit_template(&quasis_ref, expression_count as usize)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    serde_json::to_value(ir).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KnownComponentDto {
    pub component_name: String,
    pub import_path: Option<String>,
    pub tag_name: Option<String>,
}

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct CompileOptionsDto {
    pub file_path: Option<String>,
    pub emit_css: Option<bool>,
    pub emit_dts: Option<bool>,
    pub known_tags: Option<std::collections::HashMap<String, String>>,
    pub component_registry: Option<std::collections::HashMap<String, KnownComponentDto>>,
    pub stylesheet_id_prefix: Option<String>,
    pub target_tier: Option<String>,
    pub strip_prefix: Option<String>,
    pub tag_suffix: Option<String>,
    pub is_server: Option<bool>,
    pub no_cache: Option<bool>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CompileResultDto {
    pub code: String,
    pub css: Option<String>,
    pub stylesheet_id: Option<String>,
    pub tier: String,
    pub component_name: String,
    pub tag_name: Option<String>,
    pub diagnostics: Vec<DiagnosticDto>,
    pub dts: Option<String>,
}

fn extract_render_info<'a>(
    allocator: &'a Allocator,
    program: &'a oxc_ast::ast::Program<'a>,
    class_name: &str,
    symbol_ctx: &lit_analysis::SymbolProofContext,
) -> (
    Vec<oxc_ast::ast::Expression<'a>>,
    Vec<oxc_ast::ast::Statement<'a>>,
) {
    use oxc_ast::ast::*;

    for stmt in &program.body {
        let class_opt = match stmt {
            Statement::ClassDeclaration(c) => Some(c.as_ref()),
            Statement::ExportDeclaration(decl) => {
                if let Declaration::ClassDeclaration(c) = &decl.declaration {
                    Some(c.as_ref())
                } else {
                    None
                }
            }
            Statement::ExportDefaultDeclaration(decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(c) = &decl.declaration {
                    Some(c.as_ref())
                } else {
                    None
                }
            }
            _ => None,
        };

        if let Some(c) = class_opt {
            let is_match =
                c.id.as_ref()
                    .map(|id| id.name.as_str() == class_name)
                    .unwrap_or(true);

            if is_match {
                for elem in &c.body.body {
                    if let ClassElement::MethodDefinition(method) = elem {
                        if !method.r#static && method.key.is_specific_static_name("render") {
                            if let Some(body) = &method.value.body {
                                let mut preceding: Vec<&Statement<'a>> = Vec::new();
                                for body_stmt in &body.statements {
                                    if let Statement::ReturnStatement(ret) = body_stmt {
                                        if let Some(arg) = &ret.argument {
                                            let mut curr = arg;
                                            while let Expression::ParenthesizedExpression(p) = curr
                                            {
                                                curr = &p.expression;
                                            }
                                            if let Expression::TaggedTemplateExpression(tagged) =
                                                curr
                                            {
                                                if symbol_ctx.is_lit_html_tag(&tagged.tag)
                                                    || symbol_ctx.is_lit_svg_tag(&tagged.tag)
                                                {
                                                    let mut exprs = Vec::new();
                                                    for e in &tagged.quasi.expressions {
                                                        exprs.push(e.clone_in(allocator));
                                                    }
                                                    let mut pre = Vec::new();
                                                    for s in preceding {
                                                        pre.push(s.clone_in(allocator));
                                                    }
                                                    return (exprs, pre);
                                                }
                                            }
                                        }
                                    } else {
                                        preceding.push(body_stmt);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    (Vec::new(), Vec::new())
}

fn find_component_class<'a>(
    program: &'a oxc_ast::ast::Program<'a>,
    class_name: &str,
) -> Option<&'a oxc_ast::ast::Class<'a>> {
    use oxc_ast::ast::*;

    for stmt in &program.body {
        let class_opt = match stmt {
            Statement::ClassDeclaration(c) => Some(c.as_ref()),
            Statement::ExportDeclaration(decl) => {
                if let Declaration::ClassDeclaration(c) = &decl.declaration {
                    Some(c.as_ref())
                } else {
                    None
                }
            }
            Statement::ExportDefaultDeclaration(decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(c) = &decl.declaration {
                    Some(c.as_ref())
                } else {
                    None
                }
            }
            _ => None,
        };

        if let Some(c) = class_opt {
            let is_match =
                c.id.as_ref()
                    .map(|id| id.name.as_str() == class_name)
                    .unwrap_or(true);

            if is_match {
                return Some(c);
            }
        }
    }

    None
}

#[napi]
pub fn compile_module(
    source_text: String,
    options: Option<CompileOptionsDto>,
) -> Result<CompileResultDto, napi::Error> {
    let opts = options.unwrap_or_default();
    let file_path = opts
        .file_path
        .clone()
        .unwrap_or_else(|| "component.ts".to_string());

    let use_cache = !opts.no_cache.unwrap_or(false);
    let cache_key = if use_cache {
        let key = cache::compute_cache_key(&source_text, &file_path, &opts);
        if let Some(cached) = cache::get_cached(&key) {
            return Ok(cached);
        }
        Some(key)
    } else {
        None
    };

    let allocator = Allocator::default();

    // 1. Analyze Lit module using lit_analysis
    let analysis = analyze_lit_module(&allocator, &source_text, &file_path)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    if analysis.components.is_empty() {
        return Ok(CompileResultDto {
            code: source_text,
            css: None,
            stylesheet_id: None,
            tier: "None".to_string(),
            component_name: String::new(),
            tag_name: None,
            diagnostics: Vec::new(),
            dts: None,
        });
    }

    // 2. Build tag registry for child tag rewriting and cross-component resolution
    let tag_registry = emit_jsx::ComponentTagRegistry::new(
        &analysis.components,
        opts.known_tags.as_ref(),
        opts.component_registry.as_ref(),
    );

    // 3. Parse source AST to extract render() expressions & preceding statements
    let source_type = oxc_span::SourceType::from_path(&file_path).unwrap_or_else(|_| {
        oxc_span::SourceType::default()
            .with_typescript(true)
            .with_jsx(true)
    });
    let parsed = oxc_parser::Parser::new(&allocator, &source_text, source_type).parse();
    let scoping = oxc_semantic::SemanticBuilder::new()
        .build(&parsed.program)
        .semantic
        .into_scoping();
    let symbol_ctx =
        lit_analysis::SymbolProofContext::scan(&parsed.program, &scoping, &source_text);

    let emit_css_flag = opts.emit_css.unwrap_or(false);
    let mut component_programs = Vec::new();
    let mut all_scoped_css = Vec::new();
    let mut primary_stylesheet_id = None;
    let mut primary_component_name = String::new();
    let mut primary_tag_name = None;
    let mut reported_tier = "Tier0Pure".to_string();

    for (idx, comp) in analysis.components.iter().enumerate() {
        let comp_tier_str = match &comp.tier {
            lit_analysis::ClassificationTier::Tier0Pure => "Tier0Pure",
            lit_analysis::ClassificationTier::Tier1Hosted => "Tier1Hosted",
            lit_analysis::ClassificationTier::Tier2HostedWithFacade => "Tier2HostedWithFacade",
            lit_analysis::ClassificationTier::Bailout { .. } => "Bailout",
        };

        let comp_effective_tier = opts.target_tier.as_deref().unwrap_or(comp_tier_str);
        let comp_is_tier1 = comp_effective_tier == "Tier1Hosted"
            || comp_effective_tier == "Tier2HostedWithFacade"
            || opts.tag_suffix.is_some();

        let mut comp_tag = comp.tag_name.clone().unwrap_or_else(|| {
            lit_analysis::PropertyModelExtractor::to_kebab_case(&comp.class_name)
        });
        if let Some(suffix) = &opts.tag_suffix {
            comp_tag.push_str(suffix);
        }

        let (scoped_css, stylesheet_id) = if !comp.styles.is_empty() {
            let css_opts = emit_css::ScopedCssOptions {
                host_tag: comp_tag.clone(),
                slot_boundary: Some("slot, [data-slot-boundary], slot-boundary".to_string()),
                has_slots: comp.template.as_ref().map(|t| t.has_slots).unwrap_or(false)
                    || !comp.slots.is_empty(),
                precedence: Some("default".to_string()),
                id_prefix: opts
                    .stylesheet_id_prefix
                    .clone()
                    .or_else(|| Some("style".to_string())),
                minify: true,
                emit_external_file: emit_css_flag,
            };
            let css_res = emit_css::transform_component_styles(&comp.styles, &css_opts)
                .map_err(napi::Error::from_reason)?;
            (Some(css_res.scoped_css), Some(css_res.stylesheet_id))
        } else {
            (None, None)
        };

        if let Some(css) = &scoped_css {
            all_scoped_css.push(css.clone());
        }

        let (expressions, preceding_statements) =
            extract_render_info(&allocator, &parsed.program, &comp.class_name, &symbol_ctx);

        let prog = if comp_effective_tier == "Bailout" {
            emit_bailout::emit_bailout_component(
                &allocator,
                comp,
                scoped_css.as_deref(),
                stylesheet_id.as_deref(),
                emit_css_flag,
                &comp_tag,
            )
            .map_err(napi::Error::from_reason)?
        } else if comp_is_tier1 {
            let original_class = find_component_class(&parsed.program, &comp.class_name);
            emit_host::emit_tier1_component(
                &allocator,
                comp,
                scoped_css.as_deref(),
                stylesheet_id.as_deref(),
                emit_css_flag,
                &expressions,
                &preceding_statements,
                original_class,
                &comp_tag,
                &opts,
                Some(tag_registry.clone()),
                Some(&symbol_ctx),
            )
            .map_err(napi::Error::from_reason)?
        } else {
            emit_jsx::emit_tier0_component(
                &allocator,
                comp,
                scoped_css.as_deref(),
                stylesheet_id.as_deref(),
                emit_css_flag,
                &expressions,
                &preceding_statements,
                Some(tag_registry.clone()),
                Some(&symbol_ctx),
            )
            .map_err(napi::Error::from_reason)?
        };

        if idx == 0 {
            primary_component_name = comp.component_name.clone();
            primary_tag_name = Some(comp_tag);
            primary_stylesheet_id = stylesheet_id;
            reported_tier = if comp_effective_tier == "Bailout" {
                "Bailout".to_string()
            } else if comp_is_tier1 && comp_tier_str == "Tier0Pure" && opts.target_tier.is_none() {
                "Tier1Hosted".to_string()
            } else {
                comp_effective_tier.to_string()
            };
        }

        component_programs.push(prog);
    }

    // 4. Combine AST programs if multi-component, or serialize single program
    let ast_program = if component_programs.len() == 1 {
        component_programs.into_iter().next().unwrap()
    } else {
        let mut combined_imports = Vec::new();
        let mut combined_decls = Vec::new();
        let mut has_react_import = false;
        let mut has_runtime_import = false;
        let mut seen_sources = std::collections::HashSet::new();

        for prog in component_programs {
            for stmt in prog.body {
                match &stmt {
                    oxc_ast::ast::Statement::ImportDeclaration(decl) => {
                        let src = decl.source.value.as_str();
                        if src == "react" {
                            if !has_react_import {
                                has_react_import = true;
                                combined_imports.push(stmt);
                            }
                        } else if src == "@lit-core/morph-to-react/runtime" {
                            if !has_runtime_import {
                                has_runtime_import = true;
                                combined_imports.push(stmt);
                            }
                        } else if seen_sources.insert(src.to_string()) {
                            combined_imports.push(stmt);
                        }
                    }
                    _ => {
                        combined_decls.push(stmt);
                    }
                }
            }
        }

        let ast = oxc_ast::builder::AstBuilder::new(&allocator);
        let mut final_stmts = oxc_allocator::ArenaVec::new_in(&ast);
        for imp in combined_imports {
            final_stmts.push(imp);
        }
        for decl in combined_decls {
            final_stmts.push(decl);
        }

        oxc_ast::ast::Program::new(
            oxc_span::SPAN,
            oxc_span::SourceType::jsx(),
            "",
            oxc_allocator::ArenaVec::new_in(&ast),
            None,
            oxc_allocator::ArenaVec::new_in(&ast),
            final_stmts,
            &ast,
        )
    };

    let code = oxc_codegen::Codegen::new().build(&ast_program).code;

    // 5. Emit .d.ts TypeScript declaration file if requested
    let emit_dts_flag = opts.emit_dts.unwrap_or(true);
    let dts = if emit_dts_flag {
        let dts_allocator = Allocator::default();
        let mut dts_pieces = Vec::new();
        for comp in &analysis.components {
            let original_class = find_component_class(&parsed.program, &comp.class_name);
            let comp_tier_str = match &comp.tier {
                lit_analysis::ClassificationTier::Tier0Pure => "Tier0Pure",
                lit_analysis::ClassificationTier::Tier1Hosted => "Tier1Hosted",
                lit_analysis::ClassificationTier::Tier2HostedWithFacade => "Tier2HostedWithFacade",
                lit_analysis::ClassificationTier::Bailout { .. } => "Bailout",
            };
            let comp_effective_tier = opts.target_tier.as_deref().unwrap_or(comp_tier_str);
            let comp_is_tier1 = comp_effective_tier == "Tier1Hosted"
                || comp_effective_tier == "Tier2HostedWithFacade"
                || opts.tag_suffix.is_some();
            let dts_str = emit_types::emit_dts_declarations(
                &dts_allocator,
                comp,
                original_class,
                comp_is_tier1,
            )
            .map_err(napi::Error::from_reason)?;
            dts_pieces.push(dts_str);
        }
        Some(dts_pieces.join("\n\n"))
    } else {
        None
    };

    let diagnostics = analysis
        .diagnostics
        .into_iter()
        .map(|d| DiagnosticDto {
            code: d.code.as_str().to_string(),
            severity: format!("{:?}", d.severity),
            message: d.message,
            span_start: d.span.0,
            span_end: d.span.1,
            universal_lit_hint: d.universal_lit_hint,
        })
        .collect();

    let combined_css = if !all_scoped_css.is_empty() {
        Some(all_scoped_css.join("\n"))
    } else {
        None
    };

    let result = CompileResultDto {
        code,
        css: if emit_css_flag { combined_css } else { None },
        stylesheet_id: primary_stylesheet_id,
        tier: reported_tier,
        component_name: primary_component_name,
        tag_name: primary_tag_name,
        diagnostics,
        dts,
    };

    if let Some(key) = cache_key {
        cache::put_cached(key, result.clone());
    }

    Ok(result)
}

#[napi]
pub fn clear_compile_cache() {
    cache::clear_cache();
}

#[napi]
pub fn get_compile_cache_size() -> u32 {
    cache::cache_size() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compile_module_tier0() {
        let code = r#"
            import { LitElement, html } from 'lit';
            export class LeafBadge extends LitElement {
                render() {
                    return html`<div class="badge-wrapper"><span class="badge">Active</span></div>`;
                }
            }
        "#;
        let res = compile_module(code.to_string(), None).unwrap();
        assert_eq!(res.tier, "Tier0Pure");
        assert_eq!(res.component_name, "LeafBadge");
        assert_eq!(res.tag_name, Some("leaf-badge".to_string()));
        assert!(res.code.contains("export function LeafBadge("));
        assert!(res.code.contains(r#"className="badge-wrapper""#));
        assert!(res.code.contains(r#"className="badge""#));
        assert!(res.code.contains("Active"));
    }

    #[test]
    fn test_compile_module_with_scoped_css() {
        let code = r#"
            import { LitElement, html, css } from 'lit';
            export class ScopedBadge extends LitElement {
                static styles = css`
                    :host { display: inline-flex; }
                    .badge-text { font-size: 1rem; color: #161616; }
                `;
                render() {
                    return html`<span class="badge-text">Tag</span>`;
                }
            }
        "#;
        let opts = CompileOptionsDto {
            emit_css: Some(true),
            ..Default::default()
        };
        let res = compile_module(code.to_string(), Some(opts)).unwrap();
        assert_eq!(res.tier, "Tier0Pure");
        assert!(res.css.is_some());
        let css = res.css.unwrap();
        assert!(css.contains("@scope(scoped-badge)"));
        assert!(css.contains(".badge-text"));
    }

    #[test]
    fn test_compile_module_tier1_hosted() {
        let code = r#"
            import { LitElement, html, property } from 'lit';
            export class HostedCard extends LitElement {
                @property({ type: Boolean, reflect: true })
                active = false;

                focus() {
                    return true;
                }

                render() {
                    return html`<div class="card-inner"><span>Content</span></div>`;
                }
            }
        "#;
        let opts = CompileOptionsDto {
            target_tier: Some("Tier1Hosted".to_string()),
            tag_suffix: Some("-r".to_string()),
            ..Default::default()
        };
        let res = compile_module(code.to_string(), Some(opts)).unwrap();
        assert_eq!(res.tier, "Tier1Hosted");
        assert_eq!(res.component_name, "HostedCard");
        assert_eq!(res.tag_name, Some("hosted-card-r".to_string()));
        assert!(res.code.contains("class HostedCardHost extends MorphHost"));
        assert!(res.code.contains("focus()"));
        assert!(res.code.contains("export const HostedCard = forwardRef("));
        assert!(res.code.contains("<hosted-card-r"));
        assert!(res.code.contains("active="));
    }

    #[test]
    fn test_compile_module_inheritance_f65() {
        let code = r#"
            import { LitElement, html, property } from 'lit';
            export class BaseCard extends LitElement {
                @property({ type: String })
                header = 'Base Title';

                focus() {
                    return true;
                }

                render() {
                    return html`<div class="card-base"><h3>${this.header}</h3></div>`;
                }
            }

            export class SpecializedCard extends BaseCard {
                @property({ type: Boolean })
                elevated = false;

                render() {
                    return html`<div class="card-specialized"><h3>${this.header}</h3></div>`;
                }
            }
        "#;
        let opts = CompileOptionsDto {
            target_tier: Some("Tier1Hosted".to_string()),
            ..Default::default()
        };
        let res = compile_module(code.to_string(), Some(opts)).unwrap();
        println!("INHERITANCE CODE:\n{}", res.code);
        assert!(res.code.contains("class BaseCardHost extends MorphHost"));
        assert!(res.code.contains("export const BaseCard = forwardRef("));
        assert!(res
            .code
            .contains("class SpecializedCardHost extends BaseCardHost"));
        assert!(res.code.contains("...super._propertyDefaults"));
        assert!(res
            .code
            .contains("export const SpecializedCard = forwardRef("));
    }

    #[test]
    fn test_compile_module_mixin_f66() {
        let code = r#"
            import { LitElement, html, property } from 'lit';
            export const DisabledMixin = (superClass: any) => class extends superClass {
                @property({ type: Boolean })
                disabled = false;
            };

            export class MixedCard extends DisabledMixin(LitElement) {
                @property({ type: String })
                title = 'Card Title';

                render() {
                    return html`<div class="card" ?data-disabled="${this.disabled}"><h4>${this.title}</h4></div>`;
                }
            }
        "#;
        let opts = CompileOptionsDto {
            target_tier: Some("Tier1Hosted".to_string()),
            ..Default::default()
        };
        let res = compile_module(code.to_string(), Some(opts)).unwrap();
        assert!(res
            .code
            .contains("class MixedCardHost extends DisabledMixin(MorphHost)"));
        assert!(res.code.contains("export const MixedCard = forwardRef("));
    }

    #[test]
    fn test_compile_module_child_custom_element_f67_f68() {
        let code = r#"
            import { LitElement, html, property } from 'lit';
            export class StatusBanner extends LitElement {
                @property({ type: String })
                iconName = 'info';

                @property({ type: Boolean })
                active = true;

                handleIconClick(e: any) {}

                render() {
                    return html`
                        <div class="banner">
                            <my-icon .name="${this.iconName}" ?active="${this.active}" @icon-click="${this.handleIconClick}"></my-icon>
                            <foreign-grid cols="3">
                                <unknown-badge variant="success">OK</unknown-badge>
                            </foreign-grid>
                        </div>
                    `;
                }
            }
        "#;
        let mut known_tags = std::collections::HashMap::new();
        known_tags.insert("my-icon".to_string(), "MyIcon".to_string());
        let opts = CompileOptionsDto {
            target_tier: Some("Tier1Hosted".to_string()),
            known_tags: Some(known_tags),
            ..Default::default()
        };
        let res = compile_module(code.to_string(), Some(opts)).unwrap();
        // F67: Compiled child custom element rewritten
        assert!(res.code.contains("<MyIcon"));
        assert!(res
            .code
            .contains(r#"import { MyIcon } from "./my-icon.js""#));
        assert!(res.code.contains("name="));
        assert!(res.code.contains("onIconClick="));
        assert!(!res.code.contains("<my-icon"));
        assert!(!res.code.contains(".name="));
        assert!(!res.code.contains("@icon-click="));

        // F68: Uncompiled child custom element preserved
        assert!(res.code.contains(r#"<foreign-grid cols="3">"#));
        assert!(res.code.contains(r#"<unknown-badge variant="success">"#));
        assert!(!res.code.contains("<ForeignGrid"));
        assert!(!res.code.contains("<UnknownBadge"));
    }

    #[test]
    fn test_compile_module_dts_f69_f70() {
        let code = r#"
            import { LitElement, html, property } from 'lit';
            export interface SelectionDetail {
                selectedId: string;
                index: number;
            }

            export class SelectList extends LitElement {
                @property({ type: String })
                value = '';

                @property({ type: Boolean })
                open = false;

                private notifySelection(id: string, index: number) {
                    this.dispatchEvent(new CustomEvent<SelectionDetail>('item-select', {
                        bubbles: true,
                        composed: true,
                        detail: { selectedId: id, index },
                    }));
                }

                private notifyChange() {
                    this.dispatchEvent(new CustomEvent('list-change'));
                }

                render() {
                    return html`<ul><slot></slot></ul>`;
                }
            }
        "#;
        let opts = CompileOptionsDto {
            emit_dts: Some(true),
            target_tier: Some("Tier1Hosted".to_string()),
            ..Default::default()
        };
        let res = compile_module(code.to_string(), Some(opts)).unwrap();
        assert!(res.dts.is_some());
        let dts = res.dts.unwrap();
        println!("DTS CODE:\n{}", dts);
        // F69: .d.ts structure
        assert!(
            dts.contains("import type * as React from \"react\";")
                || dts.contains("import type * as React from 'react';")
        );
        assert!(
            dts.contains("import type { MorphHost } from \"@lit-core/morph-to-react/runtime\";")
                || dts
                    .contains("import type { MorphHost } from '@lit-core/morph-to-react/runtime';")
        );
        assert!(dts.contains(
            "export interface SelectListProps extends React.HTMLAttributes<HTMLElement>"
        ));
        assert!(dts.contains("value?: string;"));
        assert!(dts.contains("open?: boolean;"));
        assert!(dts.contains("export declare class SelectListHost extends MorphHost"));
        assert!(dts.contains("export declare const SelectList: React.ForwardRefExoticComponent<"));

        // F70: strongly-typed event callbacks
        assert!(dts.contains("onItemSelect?: (event: CustomEvent<SelectionDetail>) => void;"));
        assert!(dts.contains("onListChange?: (event: CustomEvent<unknown>) => void;"));
    }

    #[test]
    fn test_compile_module_bailout_f83() {
        let code = r#"
            import { LitElement, html } from 'lit';
            import { asyncAppend } from 'lit/directives/async-append.js';

            export class StreamingView extends LitElement {
                render() {
                    return html`<div>${asyncAppend(this.stream)}</div>`;
                }
            }
        "#;
        let res = compile_module(code.to_string(), None).unwrap();
        assert_eq!(res.tier, "Bailout");
        assert_eq!(res.component_name, "StreamingView");
        assert!(res
            .code
            .contains("export const StreamingView = forwardRef("));
        assert!(res.code.contains("<streaming-view"));
        assert!(res.code.contains("ref={elementRef}"));
        assert!(res.diagnostics.iter().any(|d| d.code == "LIT101"));
    }

    #[test]
    fn test_compile_module_incremental_cache_f82() {
        let code = r#"
            import { LitElement, html } from 'lit';
            export class CachedButton extends LitElement {
                render() {
                    return html`<button>Click</button>`;
                }
            }
        "#;
        let res1 = compile_module(code.to_string(), None).unwrap();
        assert_eq!(res1.component_name, "CachedButton");
        assert!(get_compile_cache_size() >= 1);

        // Second call hits cache
        let res2 = compile_module(code.to_string(), None).unwrap();
        assert_eq!(res2.code, res1.code);

        // Disabling cache works
        let res3 = compile_module(
            code.to_string(),
            Some(CompileOptionsDto {
                no_cache: Some(true),
                ..Default::default()
            }),
        )
        .unwrap();
        assert_eq!(res3.code, res1.code);
    }
}
