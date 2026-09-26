use std::collections::HashMap;
use oxc_ast::ast::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LitDecoratorKind {
  CustomElement,
  Property,
  State,
  Query,
  QueryAll,
  QueryAsync,
  QueryAssignedElements,
  QueryAssignedNodes,
  EventOptions,
  Localized,
}

impl LitDecoratorKind {
  pub fn from_canonical_name(name: &str) -> Option<Self> {
    match name {
      "customElement" => Some(Self::CustomElement),
      "property" => Some(Self::Property),
      "state" => Some(Self::State),
      "query" => Some(Self::Query),
      "queryAll" => Some(Self::QueryAll),
      "queryAsync" => Some(Self::QueryAsync),
      "queryAssignedElements" => Some(Self::QueryAssignedElements),
      "queryAssignedNodes" => Some(Self::QueryAssignedNodes),
      "eventOptions" => Some(Self::EventOptions),
      "localized" => Some(Self::Localized),
      _ => None,
    }
  }
}

pub fn is_lit_import(specifier: &str) -> bool {
  specifier == "lit"
    || specifier.starts_with("lit/")
    || specifier == "lit-element"
    || specifier.starts_with("lit-element/")
    || specifier.starts_with("@lit/")
}

#[derive(Debug, Default)]
pub struct ImportContext {
  /// Maps local identifier name (as imported in the file) to its LitDecoratorKind
  pub decorator_bindings: HashMap<String, LitDecoratorKind>,
}

impl ImportContext {
  /// Scans program import statements to populate recognized Lit decorator bindings.
  pub fn scan<'a>(program: &Program<'a>) -> Self {
    let mut ctx = Self::default();

    for stmt in &program.body {
      if let Statement::ImportDeclaration(import_decl) = stmt {
        let specifier = import_decl.source.value.as_str();
        if !is_lit_import(specifier) {
          continue;
        }

        if let Some(specifiers) = &import_decl.specifiers {
          for spec in specifiers {
            if let ImportDeclarationSpecifier::ImportSpecifier(named_spec) = spec {
              let canonical_name = named_spec.imported.name();
              if let Some(kind) = LitDecoratorKind::from_canonical_name(canonical_name.as_str()) {
                let local_name = named_spec.local.name.as_str().to_string();
                ctx.decorator_bindings.insert(local_name, kind);
              }
            }
          }
        }
      }
    }

    ctx
  }

  pub fn has_lit_decorators(&self) -> bool {
    !self.decorator_bindings.is_empty()
  }

  pub fn get_decorator_kind(&self, name: &str) -> Option<LitDecoratorKind> {
    self.decorator_bindings.get(name).copied()
  }
}
