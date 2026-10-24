use blake3;
use lightningcss::printer::PrinterOptions;
use lightningcss::rules::CssRule;
use lightningcss::stylesheet::{ParserOptions, StyleSheet};
use lightningcss::traits::ToCss;
use lit_analysis::manifest::StyleInfo;
use serde::{Deserialize, Serialize};

/// Configuration options for scoped CSS transformation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopedCssOptions {
    /// Custom element host tag name (e.g. "cds-button", "scoped-badge").
    pub host_tag: String,
    /// Selector identifying slot boundary elements.
    /// Defaults to "slot, [data-slot-boundary], slot-boundary".
    pub slot_boundary: Option<String>,
    /// Whether the component renders slots requiring donut hole isolation.
    pub has_slots: bool,
    /// React 19 style tag precedence attribute. Defaults to "default".
    pub precedence: Option<String>,
    /// Prefix for the stylesheet identifier. Defaults to "style".
    pub id_prefix: Option<String>,
    /// Whether to minify emitted CSS output. Defaults to true.
    pub minify: bool,
    /// Whether to generate external CSS file output instead of inline JSX.
    pub emit_external_file: bool,
}

impl Default for ScopedCssOptions {
    fn default() -> Self {
        Self {
            host_tag: String::new(),
            slot_boundary: Some("slot, [data-slot-boundary], slot-boundary".to_string()),
            has_slots: true,
            precedence: Some("default".to_string()),
            id_prefix: Some("style".to_string()),
            minify: true,
            emit_external_file: false,
        }
    }
}

/// Output of scoped CSS transformation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopedCssResult {
    /// Transformed and minified CSS string containing @scope blocks.
    pub scoped_css: String,
    /// Content-hashed stylesheet identifier (e.g. "style-cds-button-c4a7e2b109df").
    pub stylesheet_id: String,
    /// Suggested external file name when emit_external_file is true (e.g. "cds-button.css").
    pub external_file_name: Option<String>,
    /// Whether the stylesheet contains rules targeting projected slot content.
    pub has_slotted_rules: bool,
    /// Total count of transformed CSS rules.
    pub rule_count: usize,
}

/// Core compiler entry point for scoped CSS transformation.
pub fn transform_component_styles(
    styles: &[StyleInfo],
    options: &ScopedCssOptions,
) -> Result<ScopedCssResult, String> {
    if styles.is_empty() {
        return Ok(ScopedCssResult {
            scoped_css: String::new(),
            stylesheet_id: String::new(),
            external_file_name: None,
            has_slotted_rules: false,
            rule_count: 0,
        });
    }

    let mut combined_css = String::new();
    for s in styles {
        if !s.css_text.is_empty() {
            combined_css.push_str(&s.css_text);
            combined_css.push('\n');
        }
    }

    if combined_css.trim().is_empty() {
        return Ok(ScopedCssResult {
            scoped_css: String::new(),
            stylesheet_id: String::new(),
            external_file_name: None,
            has_slotted_rules: false,
            rule_count: 0,
        });
    }

    process_component_css(&combined_css, options)
}

fn process_component_css(css: &str, options: &ScopedCssOptions) -> Result<ScopedCssResult, String> {
    let sheet = StyleSheet::parse(css, ParserOptions::default())
        .map_err(|e| format!("failed to parse component styles: {:?}", e))?;

    let printer_opts = || PrinterOptions {
        minify: options.minify,
        ..Default::default()
    };

    let mut top_level_rules = Vec::new();
    let mut internal_rules = Vec::new();
    let mut slotted_rules = Vec::new();
    let mut has_slotted = false;
    let mut rule_count = 0;

    for rule in &sheet.rules.0 {
        rule_count += 1;
        match rule {
            CssRule::Keyframes(_) | CssRule::FontFace(_) | CssRule::Import(_) => {
                if let Ok(s) = rule.to_css_string(printer_opts()) {
                    top_level_rules.push(s);
                }
            }
            CssRule::Style(style_rule) => {
                let sel_str = match style_rule.selectors.to_css_string(printer_opts()) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                let decl_str = match style_rule.declarations.to_css_string(printer_opts()) {
                    Ok(s) => s,
                    Err(_) => continue,
                };

                if sel_str.contains("::slotted") {
                    has_slotted = true;
                    let rewritten = rewrite_slotted_selector(&sel_str);
                    slotted_rules.push(format!("{} {{{}}}", rewritten, decl_str));
                } else {
                    let rewritten = rewrite_internal_selector(&sel_str);
                    internal_rules.push(format!("{} {{{}}}", rewritten, decl_str));
                }
            }
            CssRule::Media(media_rule) => {
                let query = match media_rule.query.to_css_string(printer_opts()) {
                    Ok(q) => q,
                    Err(_) => continue,
                };
                let mut inner_internal = Vec::new();
                for inner_rule in &media_rule.rules.0 {
                    rule_count += 1;
                    if let CssRule::Style(s) = inner_rule {
                        let sel_str = s
                            .selectors
                            .to_css_string(printer_opts())
                            .unwrap_or_default();
                        let decl_str = s
                            .declarations
                            .to_css_string(printer_opts())
                            .unwrap_or_default();
                        if sel_str.contains("::slotted") {
                            has_slotted = true;
                            let rewritten = rewrite_slotted_selector(&sel_str);
                            slotted_rules.push(format!(
                                "@media {} {{{} {{{}}}}}",
                                query, rewritten, decl_str
                            ));
                        } else {
                            let rewritten = rewrite_internal_selector(&sel_str);
                            inner_internal.push(format!("{} {{{}}}", rewritten, decl_str));
                        }
                    }
                }
                if !inner_internal.is_empty() {
                    internal_rules.push(format!(
                        "@media {} {{{}}}",
                        query,
                        inner_internal.join(" ")
                    ));
                }
            }
            CssRule::Supports(supports_rule) => {
                let cond = match supports_rule.condition.to_css_string(printer_opts()) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let mut inner_internal = Vec::new();
                for inner_rule in &supports_rule.rules.0 {
                    rule_count += 1;
                    if let CssRule::Style(s) = inner_rule {
                        let sel_str = s
                            .selectors
                            .to_css_string(printer_opts())
                            .unwrap_or_default();
                        let decl_str = s
                            .declarations
                            .to_css_string(printer_opts())
                            .unwrap_or_default();
                        if sel_str.contains("::slotted") {
                            has_slotted = true;
                            let rewritten = rewrite_slotted_selector(&sel_str);
                            slotted_rules.push(format!(
                                "@supports {} {{{} {{{}}}}}",
                                cond, rewritten, decl_str
                            ));
                        } else {
                            let rewritten = rewrite_internal_selector(&sel_str);
                            inner_internal.push(format!("{} {{{}}}", rewritten, decl_str));
                        }
                    }
                }
                if !inner_internal.is_empty() {
                    internal_rules.push(format!(
                        "@supports {} {{{}}}",
                        cond,
                        inner_internal.join(" ")
                    ));
                }
            }
            _ => {
                if let Ok(s) = rule.to_css_string(printer_opts()) {
                    internal_rules.push(s);
                }
            }
        }
    }

    assemble_scoped_stylesheet(
        top_level_rules,
        internal_rules,
        slotted_rules,
        has_slotted,
        rule_count,
        options,
    )
}

fn assemble_scoped_stylesheet(
    top_level_rules: Vec<String>,
    internal_rules: Vec<String>,
    slotted_rules: Vec<String>,
    has_slotted: bool,
    rule_count: usize,
    options: &ScopedCssOptions,
) -> Result<ScopedCssResult, String> {
    let mut parts = Vec::new();

    // 1. Top-level rules (@keyframes, @font-face, etc.)
    for r in top_level_rules {
        parts.push(r);
    }

    // 2. Donut-scoped internal rules
    if !internal_rules.is_empty() {
        let tag = if options.host_tag.is_empty() {
            "div"
        } else {
            &options.host_tag
        };
        let scope_header = if options.has_slots {
            let boundary = options
                .slot_boundary
                .as_deref()
                .unwrap_or("slot, [data-slot-boundary], slot-boundary");
            format!("@scope ({}) to ({})", tag, boundary)
        } else {
            format!("@scope ({})", tag)
        };
        parts.push(format!(
            "{} {{\n{}\n}}",
            scope_header,
            internal_rules.join("\n")
        ));
    }

    // 3. Slotted rules (@scope (tag) without donut hole)
    if !slotted_rules.is_empty() {
        let tag = if options.host_tag.is_empty() {
            "div"
        } else {
            &options.host_tag
        };
        parts.push(format!(
            "@scope ({}) {{\n{}\n}}",
            tag,
            slotted_rules.join("\n")
        ));
    }

    let full_css = parts.join("\n");

    // Minify and canonicalize final CSS through lightningcss
    let parsed = StyleSheet::parse(&full_css, ParserOptions::default())
        .map_err(|e| format!("failed to parse assembled scoped stylesheet: {:?}", e))?;
    let printer_opts = PrinterOptions {
        minify: options.minify,
        ..Default::default()
    };
    let final_css = parsed
        .to_css(printer_opts)
        .map(|c| c.code)
        .map_err(|e| format!("failed to emit scoped CSS: {:?}", e))?;

    // Calculate deterministic 12-char hex hash from content
    let hash = blake3::hash(final_css.as_bytes()).to_hex().to_string();
    let prefix = options.id_prefix.as_deref().unwrap_or("style");
    let stylesheet_id = if !options.host_tag.is_empty() {
        format!("{}-{}-{}", prefix, options.host_tag, &hash[..12])
    } else {
        format!("{}-{}", prefix, &hash[..12])
    };

    let external_file_name = if options.emit_external_file {
        let tag = if options.host_tag.is_empty() {
            "component"
        } else {
            &options.host_tag
        };
        Some(format!("{}.css", tag))
    } else {
        None
    };

    Ok(ScopedCssResult {
        scoped_css: final_css,
        stylesheet_id,
        external_file_name,
        has_slotted_rules: has_slotted,
        rule_count,
    })
}

/// Constructs a React 19 `<style href={id} precedence="default">{scoped_css}</style>` JSX element.
pub fn build_jsx_style_element<'a>(
    stylesheet_id: &str,
    scoped_css: &str,
    precedence: &str,
    ast: &oxc_ast::builder::AstBuilder<'a>,
) -> oxc_ast::ast::JSXElement<'a> {
    use oxc_allocator::{ArenaVec, GetAllocator};
    use oxc_ast::ast::*;
    use oxc_span::SPAN;

    let tag_name = ast.allocator().alloc_str("style");
    let elem_name = JSXElementName::Identifier(JSXIdentifier::boxed(SPAN, tag_name, ast));

    // href="..."
    let href_attr_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
        SPAN,
        ast.allocator().alloc_str("href"),
        ast,
    ));
    let href_attr_val = Some(JSXAttributeValue::StringLiteral(StringLiteral::boxed(
        SPAN,
        ast.allocator().alloc_str(stylesheet_id),
        None,
        ast,
    )));
    let href_attr = JSXAttributeItem::Attribute(JSXAttribute::boxed(
        SPAN,
        href_attr_name,
        href_attr_val,
        ast,
    ));

    // precedence="..."
    let prec_attr_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
        SPAN,
        ast.allocator().alloc_str("precedence"),
        ast,
    ));
    let prec_attr_val = Some(JSXAttributeValue::StringLiteral(StringLiteral::boxed(
        SPAN,
        ast.allocator().alloc_str(precedence),
        None,
        ast,
    )));
    let prec_attr = JSXAttributeItem::Attribute(JSXAttribute::boxed(
        SPAN,
        prec_attr_name,
        prec_attr_val,
        ast,
    ));

    let mut attrs = ArenaVec::new_in(ast);
    attrs.push(href_attr);
    attrs.push(prec_attr);

    let opening = JSXOpeningElement::boxed(SPAN, elem_name, None, attrs, ast);
    let closing = Some(JSXClosingElement::boxed(
        SPAN,
        JSXElementName::Identifier(JSXIdentifier::boxed(SPAN, tag_name, ast)),
        ast,
    ));

    // Scoped CSS string wrapped in JSXExpressionContainer
    let css_expr =
        Expression::new_string_literal(SPAN, ast.allocator().alloc_str(scoped_css), None, ast);
    let expr_container = JSXChild::ExpressionContainer(JSXExpressionContainer::boxed(
        SPAN,
        JSXExpression::from(css_expr),
        ast,
    ));
    let mut children = ArenaVec::new_in(ast);
    children.push(expr_container);

    JSXElement::new(SPAN, opening, children, closing, ast)
}

/// Splits a comma-separated selector string into individual selector items,
/// respecting parentheses, brackets, and quotes.
pub fn split_selector_list(selectors: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut current = String::new();
    let mut paren_depth = 0;
    let mut bracket_depth = 0;
    let mut in_single_quote = false;
    let mut in_double_quote = false;

    for c in selectors.chars() {
        match c {
            '\'' if !in_double_quote => in_single_quote = !in_single_quote,
            '"' if !in_single_quote => in_double_quote = !in_double_quote,
            '(' if !in_single_quote && !in_double_quote => paren_depth += 1,
            ')' if !in_single_quote && !in_double_quote => {
                if paren_depth > 0 {
                    paren_depth -= 1;
                }
            }
            '[' if !in_single_quote && !in_double_quote => bracket_depth += 1,
            ']' if !in_single_quote && !in_double_quote => {
                if bracket_depth > 0 {
                    bracket_depth -= 1;
                }
            }
            ',' if paren_depth == 0
                && bracket_depth == 0
                && !in_single_quote
                && !in_double_quote =>
            {
                let trimmed = current.trim();
                if !trimmed.is_empty() {
                    items.push(trimmed.to_string());
                }
                current.clear();
                continue;
            }
            _ => {}
        }
        current.push(c);
    }

    let trimmed = current.trim();
    if !trimmed.is_empty() {
        items.push(trimmed.to_string());
    }

    items
}

/// Rewrites internal component selectors:
/// - `:host` -> `:scope`
/// - `:host(selector)` -> `:scope:is(selector)`
/// - `:host-context(selector)` -> `:is(selector :scope, :scope:is(selector))`
/// - `:state(name)` -> `[data-state~="name"]`
/// - `:host + :host` or `:scope + :scope` -> `:not(*)`
pub fn rewrite_internal_selector(selector_str: &str) -> String {
    let parts = split_selector_list(selector_str);
    let mut rewritten_parts = Vec::with_capacity(parts.len());

    for part in parts {
        rewritten_parts.push(rewrite_single_internal_selector(&part));
    }

    rewritten_parts.join(", ")
}

fn rewrite_single_internal_selector(sel: &str) -> String {
    let mut s = sel.to_string();

    // 1. Neutralize impossible sibling host combinators
    // :host + :host, :host ~ :host, :scope + :scope, :scope ~ :scope
    s = replace_host_siblings(&s);

    // 2. Rewrite :host-context(sel) -> :is(sel :scope, :scope:is(sel))
    s = replace_functional_pseudo(&s, ":host-context", |inner| {
        format!(":is({} :scope, :scope:is({}))", inner.trim(), inner.trim())
    });

    // 3. Rewrite :host(sel) -> :scope:is(sel)
    s = replace_functional_pseudo(&s, ":host", |inner| format!(":scope:is({})", inner.trim()));

    // 4. Rewrite :state(name) -> [data-state~="name"]
    s = replace_functional_pseudo(&s, ":state", |inner| {
        let clean = inner.trim().trim_matches(|c| c == '\'' || c == '"');
        format!("[data-state~=\"{}\"]", clean)
    });

    // 5. Rewrite bare :host -> :scope
    s = replace_bare_host(&s);

    s
}

/// Rewrites slotted selectors:
/// `::slotted(selector)` -> `:scope [data-slot-boundary] > :is(selector)`
/// `slot[name="..."]::slotted(selector)` -> `:scope [data-slot-boundary][data-slot="..."] > :is(selector)`
pub fn rewrite_slotted_selector(selector_str: &str) -> String {
    let parts = split_selector_list(selector_str);
    let mut rewritten_parts = Vec::with_capacity(parts.len());

    for part in parts {
        rewritten_parts.push(rewrite_single_slotted_selector(&part));
    }

    rewritten_parts.join(", ")
}

fn rewrite_single_slotted_selector(sel: &str) -> String {
    // First rewrite any :host inside slotted rule
    let s = rewrite_single_internal_selector(sel);

    // Look for slot[name="..."]::slotted(...)
    let mut result = String::with_capacity(s.len());
    let mut remainder = s.as_str();

    while let Some(slot_idx) = remainder.find("slot[name=") {
        result.push_str(&remainder[..slot_idx]);
        let match_slice = &remainder[slot_idx..];
        let mut handled = false;
        if let Some(close_bracket) = match_slice.find(']') {
            let attr_part = &match_slice[..close_bracket + 1];
            let after_bracket = &match_slice[close_bracket + 1..];
            if after_bracket.starts_with("::slotted(") {
                let name = extract_slot_name_from_attr(attr_part);
                if let Some(inner) = extract_parenthesized_content(after_bracket, "::slotted") {
                    let total_len = close_bracket + 1 + "::slotted(".len() + inner.len() + 1;
                    let replacement = format!(
                        ":scope [data-slot-boundary][data-slot=\"{}\"] > :is({})",
                        name,
                        inner.trim()
                    );
                    result.push_str(&replacement);
                    remainder = &match_slice[total_len..];
                    handled = true;
                }
            }
        }
        if !handled {
            result.push_str("slot[name=");
            remainder = &match_slice["slot[name=".len()..];
        }
    }
    result.push_str(remainder);

    // Now rewrite generic ::slotted(selector)
    replace_functional_pseudo(&result, "::slotted", |inner| {
        format!(":scope [data-slot-boundary] > :is({})", inner.trim())
    })
}

fn extract_slot_name_from_attr(attr: &str) -> &str {
    if let Some(start) = attr.find("slot[name=") {
        let rest = &attr[start + "slot[name=".len()..];
        let rest = rest.trim_end_matches(']');
        return rest.trim_matches(|c| c == '\'' || c == '"');
    }
    ""
}

fn replace_host_siblings(sel: &str) -> String {
    let mut out = sel.to_string();
    let patterns = [
        ":host + :host",
        ":host+ :host",
        ":host +:host",
        ":host+:host",
        ":host ~ :host",
        ":host~ :host",
        ":host ~:host",
        ":host~:host",
        ":scope + :scope",
        ":scope+ :scope",
        ":scope +:scope",
        ":scope+:scope",
        ":scope ~ :scope",
        ":scope~ :scope",
        ":scope ~:scope",
        ":scope~:scope",
    ];

    for pat in patterns {
        out = out.replace(pat, ":not(*)");
    }

    out
}

fn replace_bare_host(sel: &str) -> String {
    let mut out = String::new();
    let mut i = 0;
    let chars: Vec<char> = sel.chars().collect();
    let len = chars.len();

    while i < len {
        if i + 5 <= len
            && chars[i] == ':'
            && chars[i + 1] == 'h'
            && chars[i + 2] == 'o'
            && chars[i + 3] == 's'
            && chars[i + 4] == 't'
        {
            // Check following char: cannot be '(' or alphanumeric or '-'
            let next_char = if i + 5 < len {
                Some(chars[i + 5])
            } else {
                None
            };
            let is_bare = match next_char {
                Some('(') | Some('-') => false,
                Some(c) if c.is_ascii_alphanumeric() => false,
                _ => true,
            };

            if is_bare {
                out.push_str(":scope");
                i += 5;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }

    out
}

fn replace_functional_pseudo<F>(sel: &str, pseudo_name: &str, replace_fn: F) -> String
where
    F: Fn(&str) -> String,
{
    let pattern = format!("{}(", pseudo_name);
    if !sel.contains(&pattern) {
        return sel.to_string();
    }

    let mut result = String::with_capacity(sel.len());
    let mut remainder = sel;

    while let Some(start_idx) = remainder.find(&pattern) {
        result.push_str(&remainder[..start_idx]);
        let match_slice = &remainder[start_idx..];
        if let Some(inner) = extract_parenthesized_content(match_slice, pseudo_name) {
            let total_len = pattern.len() + inner.len() + 1; // +1 for closing ')'
            let replacement = replace_fn(inner);
            result.push_str(&replacement);
            remainder = &match_slice[total_len..];
        } else {
            result.push_str(&match_slice[..pattern.len()]);
            remainder = &match_slice[pattern.len()..];
        }
    }
    result.push_str(remainder);

    result
}

fn extract_parenthesized_content<'a>(slice: &'a str, prefix: &str) -> Option<&'a str> {
    let search_prefix = format!("{}(", prefix);
    if !slice.starts_with(&search_prefix) {
        return None;
    }

    let start = search_prefix.len();
    let mut depth = 1;
    let mut in_single = false;
    let mut in_double = false;

    for (byte_offset, c) in slice[start..].char_indices() {
        match c {
            '\'' if !in_double => in_single = !in_single,
            '"' if !in_single => in_double = !in_double,
            '(' if !in_single && !in_double => depth += 1,
            ')' if !in_single && !in_double => {
                depth -= 1;
                if depth == 0 {
                    return Some(&slice[start..start + byte_offset]);
                }
            }
            _ => {}
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_selector_rewrites_unit() {
        assert_eq!(rewrite_internal_selector(":host"), ":scope");
        assert_eq!(rewrite_internal_selector(":host.active"), ":scope.active");
        assert_eq!(
            rewrite_internal_selector(":host([disabled])"),
            ":scope:is([disabled])"
        );
        assert_eq!(
            rewrite_internal_selector(":host-context(.dark-theme)"),
            ":is(.dark-theme :scope, :scope:is(.dark-theme))"
        );
        assert_eq!(
            rewrite_internal_selector(":state(selected)"),
            "[data-state~=\"selected\"]"
        );
        assert_eq!(rewrite_internal_selector(":host + :host"), ":not(*)");
    }

    #[test]
    fn test_slotted_rewrites_unit() {
        assert_eq!(
            rewrite_slotted_selector("::slotted(svg)"),
            ":scope [data-slot-boundary] > :is(svg)"
        );
        assert_eq!(
            rewrite_slotted_selector("slot[name=\"icon\"]::slotted(svg)"),
            ":scope [data-slot-boundary][data-slot=\"icon\"] > :is(svg)"
        );
    }

    #[test]
    fn test_transform_component_styles_donut_scoping() {
        let styles = vec![StyleInfo {
            css_text: r#"
                :host { display: block; }
                :host([disabled]) { opacity: 0.5; }
                :host-context(.dark-theme) { background: #121212; }
                ::slotted(svg) { fill: currentColor; }
                :state(selected) { border-color: #0f62fe; }
            "#
            .to_string(),
            is_shared: false,
            shared_import_path: None,
        }];

        let opts = ScopedCssOptions {
            host_tag: "cds-button".to_string(),
            has_slots: true,
            ..Default::default()
        };

        let res = transform_component_styles(&styles, &opts).unwrap();
        assert!(
            res.scoped_css
                .contains("@scope(cds-button) to (slot,[data-slot-boundary],slot-boundary)")
        );
        assert!(res.scoped_css.contains(":scope{display:block}"));
        assert!(res.scoped_css.contains(":scope[disabled]{opacity:.5}"));
        assert!(res.scoped_css.contains("[data-state~=selected]"));
        assert!(
            res.scoped_css
                .contains(":scope [data-slot-boundary]>:is(svg)")
        );
        assert!(!res.scoped_css.contains(":host"));
        assert!(!res.scoped_css.contains(":host-context"));
        assert!(res.stylesheet_id.starts_with("style-cds-button-"));
        assert_eq!(res.stylesheet_id.len(), "style-cds-button-".len() + 12);
    }

    #[test]
    fn test_transform_component_styles_no_slots() {
        let styles = vec![StyleInfo {
            css_text: ":host { display: inline-flex; }".to_string(),
            is_shared: false,
            shared_import_path: None,
        }];

        let opts = ScopedCssOptions {
            host_tag: "scoped-badge".to_string(),
            has_slots: false,
            ..Default::default()
        };

        let res = transform_component_styles(&styles, &opts).unwrap();
        assert!(res.scoped_css.contains("@scope(scoped-badge){"));
        assert!(!res.scoped_css.contains("to ("));
    }

    #[test]
    fn test_transform_component_styles_external_file() {
        let styles = vec![StyleInfo {
            css_text: ".box { padding: 8px; }".to_string(),
            is_shared: false,
            shared_import_path: None,
        }];

        let opts = ScopedCssOptions {
            host_tag: "my-card".to_string(),
            emit_external_file: true,
            ..Default::default()
        };

        let res = transform_component_styles(&styles, &opts).unwrap();
        assert_eq!(res.external_file_name, Some("my-card.css".to_string()));
    }

    #[test]
    fn test_transform_component_styles_malformed_css_bails_out() {
        let styles = vec![StyleInfo {
            css_text: "@media ( { div { color: red; }".to_string(),
            is_shared: false,
            shared_import_path: None,
        }];

        let opts = ScopedCssOptions {
            host_tag: "bad-elem".to_string(),
            ..Default::default()
        };

        let res = transform_component_styles(&styles, &opts);
        assert!(res.is_err(), "malformed CSS must bail out with Err");
    }

    #[test]
    fn test_repeated_functional_pseudo_replacement_order() {
        let sel = "div:host(.primary) > span:host(.primary)";
        let rewritten = rewrite_internal_selector(sel);
        assert_eq!(
            rewritten,
            "div:scope:is(.primary) > span:scope:is(.primary)"
        );
    }

    #[test]
    fn test_slotted_selector_repeated_target_in_compound() {
        let sel = "slot[name=\"icon\"]::slotted(svg) > slot[name=\"icon\"]::slotted(path)";
        let rewritten = rewrite_slotted_selector(sel);
        assert_eq!(
            rewritten,
            ":scope [data-slot-boundary][data-slot=\"icon\"] > :is(svg) > :scope [data-slot-boundary][data-slot=\"icon\"] > :is(path)"
        );
    }
}
