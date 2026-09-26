use std::collections::HashSet;
use lightningcss::printer::PrinterOptions;
use lightningcss::rules::CssRule;
use lightningcss::stylesheet::{ParserOptions, StyleSheet};
use lightningcss::traits::ToCss;
use crate::models::{ExtractedStyle, NormalizedRule, RuleHash, SourceSpan};
use crate::normalizer::hasher::compute_rule_hash;

pub fn normalize_css(extracted: &ExtractedStyle) -> Vec<NormalizedRule> {
  let mut normalized_rules = Vec::new();
  let css_content = &extracted.css_text;

  // Attempt standard lightningcss parsing
  if let Ok(stylesheet) = StyleSheet::parse(css_content, ParserOptions::default()) {
    let printer_opts = || PrinterOptions {
      minify: true,
      ..Default::default()
    };

    parse_rules_recursive(
      &stylesheet.rules.0,
      None,
      &extracted.file_path,
      &extracted.span,
      &printer_opts,
      &mut normalized_rules,
    );
  } else {
    // Graceful fallback for templates with interpolation or non-standard syntax
    fallback_tokenize_rules(css_content, &extracted.file_path, &extracted.span, &mut normalized_rules);
  }

  normalized_rules
}

fn parse_rules_recursive<F>(
  rules: &[CssRule],
  at_rule: Option<&str>,
  file_path: &str,
  span: &SourceSpan,
  printer_opts: &F,
  out: &mut Vec<NormalizedRule>,
) where
  F: Fn() -> PrinterOptions<'static>,
{
  for rule in rules {
    match rule {
      CssRule::Style(style_rule) => {
        let selector_str = match style_rule.selectors.to_css_string(printer_opts()) {
          Ok(s) => s,
          Err(_) => continue,
        };

        let raw_body_str = match style_rule.declarations.to_css_string(printer_opts()) {
          Ok(s) => s,
          Err(_) => continue,
        };

        let declarations = split_and_canonicalize_declarations(&raw_body_str);
        if declarations.is_empty() {
          continue;
        }

        let canonical_body = declarations.join(";");
        let full_css = if let Some(at) = at_rule {
          format!("{} {{\n  {} {{{}}}\n}}", at, selector_str, canonical_body)
        } else {
          format!("{} {{{}}}", selector_str, canonical_body)
        };

        let hash_key = if let Some(at) = at_rule {
          format!("{}|{}", at, selector_str)
        } else {
          selector_str.clone()
        };
        let hash = compute_rule_hash(&hash_key, &canonical_body);

        out.push(NormalizedRule {
          at_rule: at_rule.map(|s| s.to_string()),
          selector: selector_str,
          declarations,
          canonical_body,
          full_canonical_css: full_css,
          hash,
          source_file: file_path.to_string(),
          span: span.clone(),
          is_keyframes_or_media: at_rule.is_some(),
        });
      }
      CssRule::Keyframes(keyframes) => {
        if let Ok(full_css) = keyframes.to_css_string(printer_opts()) {
          let name_str = keyframes
            .name
            .to_css_string(printer_opts())
            .unwrap_or_else(|_| "unknown".to_string());
          let selector = format!("@keyframes {}", name_str);
          let hash = compute_rule_hash(&selector, &full_css);
          out.push(NormalizedRule {
            at_rule: None,
            selector: selector.clone(),
            declarations: Vec::new(),
            canonical_body: full_css.clone(),
            full_canonical_css: full_css,
            hash,
            source_file: file_path.to_string(),
            span: span.clone(),
            is_keyframes_or_media: true,
          });
        }
      }
      CssRule::Media(media) => {
        if let Ok(query_str) = media.query.to_css_string(printer_opts()) {
          let at_str = format!("@media {}", query_str);
          parse_rules_recursive(&media.rules.0, Some(&at_str), file_path, span, printer_opts, out);
        }
      }
      CssRule::Supports(supports) => {
        if let Ok(condition_str) = supports.condition.to_css_string(printer_opts()) {
          let at_str = format!("@supports {}", condition_str);
          parse_rules_recursive(&supports.rules.0, Some(&at_str), file_path, span, printer_opts, out);
        }
      }
      CssRule::LayerBlock(layer) => {
        let layer_name = layer
          .name
          .as_ref()
          .and_then(|n| n.to_css_string(printer_opts()).ok())
          .unwrap_or_default();
        let at_str = if layer_name.is_empty() {
          "@layer".to_string()
        } else {
          format!("@layer {}", layer_name)
        };
        parse_rules_recursive(&layer.rules.0, Some(&at_str), file_path, span, printer_opts, out);
      }
      _ => {}
    }
  }
}

pub fn split_and_canonicalize_declarations(body: &str) -> Vec<String> {
  let mut decls: Vec<String> = body
    .split(';')
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
    .collect();
  decls.sort();
  decls.dedup();
  decls
}

/// Fallback tokenizer when lightningcss cannot parse entire template (e.g. interpolations)
fn fallback_tokenize_rules(
  css: &str,
  file_path: &str,
  span: &SourceSpan,
  out: &mut Vec<NormalizedRule>,
) {
  let mut current = String::new();
  let mut in_brace = false;
  let mut selector = String::new();

  for ch in css.chars() {
    if ch == '{' && !in_brace {
      in_brace = true;
      selector = current.trim().to_string();
      current.clear();
    } else if ch == '}' && in_brace {
      in_brace = false;
      let body = current.trim().to_string();
      current.clear();

      if !selector.is_empty() && !body.is_empty() {
        let declarations = split_and_canonicalize_declarations(&body);
        let canonical_body = declarations.join(";");
        let full_css = format!("{} {{{}}}", selector, canonical_body);
        let hash = compute_rule_hash(&selector, &canonical_body);
        out.push(NormalizedRule {
          at_rule: None,
          selector: selector.clone(),
          declarations,
          canonical_body,
          full_canonical_css: full_css,
          hash,
          source_file: file_path.to_string(),
          span: span.clone(),
          is_keyframes_or_media: selector.starts_with('@'),
        });
      }
      selector.clear();
    } else {
      current.push(ch);
    }
  }
}

/// Subtract extracted shared rules from a component's local stylesheet.
/// Returns Some(remaining_css) if local rules/overrides remain, or None if completely deduplicated.
pub fn subtract_rules_from_css(
  extracted_style: &ExtractedStyle,
  shared_rules_for_file: &[NormalizedRule],
) -> Option<String> {
  let extracted_rules = normalize_css(extracted_style);
  if extracted_rules.is_empty() {
    return None;
  }

  // Build lookup of extracted declarations: (at_rule, selector) -> HashSet<declaration>
  let mut extracted_decls: HashSet<(Option<String>, String, String)> = HashSet::new();
  let mut extracted_keyframes: HashSet<RuleHash> = HashSet::new();

  for rule in shared_rules_for_file {
    if rule.is_keyframes_or_media && rule.selector.starts_with("@keyframes") {
      extracted_keyframes.insert(rule.hash.clone());
    } else {
      for decl in &rule.declarations {
        extracted_decls.insert((rule.at_rule.clone(), rule.selector.clone(), decl.clone()));
      }
    }
  }

  // Iterate over original rules and subtract extracted declarations
  let mut remaining_rules_by_at: Vec<(Option<String>, String, Vec<String>)> = Vec::new();
  let mut remaining_keyframes: Vec<String> = Vec::new();

  for rule in &extracted_rules {
    if rule.is_keyframes_or_media && rule.selector.starts_with("@keyframes") {
      if !extracted_keyframes.contains(&rule.hash) {
        remaining_keyframes.push(rule.full_canonical_css.clone());
      }
      continue;
    }

    let mut remaining_decls = Vec::new();
    for decl in &rule.declarations {
      let key = (rule.at_rule.clone(), rule.selector.clone(), decl.clone());
      if !extracted_decls.contains(&key) {
        remaining_decls.push(decl.clone());
      }
    }

    if !remaining_decls.is_empty() {
      remaining_rules_by_at.push((rule.at_rule.clone(), rule.selector.clone(), remaining_decls));
    }
  }

  if remaining_rules_by_at.is_empty() && remaining_keyframes.is_empty() {
    return None;
  }

  // Format remaining rules into clean CSS
  let mut out = String::new();

  // Group by at_rule
  let mut current_at: Option<String> = None;
  let mut at_buffer = Vec::new();

  let flush_at = |at: &Option<String>, buffer: &mut Vec<String>, out: &mut String| {
    if buffer.is_empty() {
      return;
    }
    if let Some(at_str) = at {
      out.push_str(at_str);
      out.push_str(" {\n");
      for rule_str in buffer.drain(..) {
        for line in rule_str.lines() {
          out.push_str("  ");
          out.push_str(line);
          out.push('\n');
        }
      }
      out.push_str("}\n\n");
    } else {
      for rule_str in buffer.drain(..) {
        out.push_str(&rule_str);
        out.push_str("\n\n");
      }
    }
  };

  for (at_rule, selector, decls) in remaining_rules_by_at {
    if at_rule != current_at {
      flush_at(&current_at, &mut at_buffer, &mut out);
      current_at = at_rule;
    }

    let mut rule_str = format!("{} {{\n", selector);
    for d in decls {
      rule_str.push_str("  ");
      if let Some((prop, val)) = d.split_once(':') {
        rule_str.push_str(prop.trim());
        rule_str.push_str(": ");
        rule_str.push_str(val.trim());
      } else {
        rule_str.push_str(&d);
      }
      rule_str.push_str(";\n");
    }
    rule_str.push('}');
    at_buffer.push(rule_str);
  }

  flush_at(&current_at, &mut at_buffer, &mut out);

  for kf in remaining_keyframes {
    out.push_str(&kf);
    out.push_str("\n\n");
  }

  let trimmed = out.trim();
  if trimmed.is_empty() {
    None
  } else {
    Some(trimmed.to_string())
  }
}
