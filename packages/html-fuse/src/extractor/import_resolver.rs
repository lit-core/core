use oxc_ast::ast::{ImportDeclaration, ImportDeclarationSpecifier};
use std::collections::HashSet;

pub struct ImportResolver {
    pub html_svg_identifiers: HashSet<String>,
}

impl Default for ImportResolver {
    fn default() -> Self {
        Self::new()
    }
}

impl ImportResolver {
    pub fn new() -> Self {
        let mut html_svg_identifiers = HashSet::new();
        html_svg_identifiers.insert("html".to_string());
        html_svg_identifiers.insert("svg".to_string());
        html_svg_identifiers.insert("litHtml".to_string());
        html_svg_identifiers.insert("litSvg".to_string());
        Self {
            html_svg_identifiers,
        }
    }

    pub fn process_import(&mut self, import_decl: &ImportDeclaration) {
        if let Some(specifiers) = &import_decl.specifiers {
            for spec in specifiers {
                if let ImportDeclarationSpecifier::ImportSpecifier(named_spec) = spec {
                    let imported_name = named_spec.imported.name();
                    if imported_name == "html" || imported_name == "svg" {
                        self.html_svg_identifiers
                            .insert(named_spec.local.name.as_str().to_string());
                    }
                }
            }
        }
    }

    pub fn is_target_tag(&self, tag_name: &str) -> bool {
        self.html_svg_identifiers.contains(tag_name)
    }
}
