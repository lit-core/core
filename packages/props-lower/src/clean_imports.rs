use oxc_allocator::ArenaVec;
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::lit_import_scanner::{is_lit_import, ImportContext};

pub fn clean_lit_import<'a>(
    import_decl: &mut ImportDeclaration<'a>,
    import_ctx: &ImportContext,
    referenced_names: &std::collections::HashSet<String>,
    ast: &AstBuilder<'a>,
) -> bool {
    let specifier = import_decl.source.value.as_str();
    if !is_lit_import(specifier) {
        return true;
    }

    let Some(specifiers) = &mut import_decl.specifiers else {
        return true;
    };

    let old_specs = std::mem::replace(specifiers, ArenaVec::new_in(ast));
    let mut new_specs = ArenaVec::new_in(ast);

    for mut spec in old_specs {
        match &mut spec {
            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                let imported_name = named.imported.name();
                let local_name = named.local.name.as_str();
                if imported_name.as_str() == "localized" {
                    named.imported = ModuleExportName::IdentifierName(IdentifierName::new(
                        SPAN,
                        "updateWhenLocaleChanges",
                        ast,
                    ));
                    if local_name == "localized" {
                        named.local = BindingIdentifier::new(SPAN, "updateWhenLocaleChanges", ast);
                    }
                    new_specs.push(spec);
                } else if import_ctx.get_decorator_kind(local_name).is_some() {
                    // Only strip if NO references remain in the program!
                    if referenced_names.contains(local_name) {
                        new_specs.push(spec);
                    }
                } else {
                    new_specs.push(spec);
                }
            }
            _ => {
                new_specs.push(spec);
            }
        }
    }

    if new_specs.is_empty() {
        false
    } else {
        *specifiers = new_specs;
        true
    }
}
