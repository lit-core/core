use oxc_ast::ast::*;
use oxc_semantic::Semantic;

pub struct SymbolResolver<'a> {
    pub semantic: &'a Semantic<'a>,
}

#[derive(Debug, Clone)]
pub struct ImportLocation {
    pub import_stmt_index: usize,
    pub specifier_index: usize,
    pub specifier_name: String,
    pub source: String,
}

impl<'a> SymbolResolver<'a> {
    pub fn new(semantic: &'a Semantic<'a>) -> Self {
        Self { semantic }
    }

    /// Check if an identifier is exported from the module.
    pub fn is_identifier_exported(program: &Program, name: &str) -> bool {
        for stmt in &program.body {
            match stmt {
                Statement::ExportDeclaration(export_decl) => match &export_decl.declaration {
                    Declaration::ClassDeclaration(cls) => {
                        if let Some(id) = &cls.id {
                            if id.name.as_str() == name {
                                return true;
                            }
                        }
                    }
                    Declaration::VariableDeclaration(var_decl) => {
                        for decl in &var_decl.declarations {
                            if let BindingPattern::BindingIdentifier(id) = &decl.id {
                                if id.name.as_str() == name {
                                    return true;
                                }
                            }
                        }
                    }
                    _ => {}
                },
                Statement::ExportNamedDeclaration(export_decl) => {
                    for spec in &export_decl.specifiers {
                        if spec.local.name().as_str() == name {
                            return true;
                        }
                    }
                }
                Statement::ExportDefaultDeclaration(export_decl) => {
                    match &export_decl.declaration {
                        ExportDefaultDeclarationKind::Identifier(id) => {
                            if id.name.as_str() == name {
                                return true;
                            }
                        }
                        ExportDefaultDeclarationKind::ClassDeclaration(cls) => {
                            if let Some(id) = &cls.id {
                                if id.name.as_str() == name {
                                    return true;
                                }
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
        false
    }

    /// Locate where a component name is imported in the program.
    pub fn find_import_location(program: &Program, name: &str) -> Option<ImportLocation> {
        for (stmt_idx, stmt) in program.body.iter().enumerate() {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                if let Some(specifiers) = &import_decl.specifiers {
                    for (spec_idx, spec) in specifiers.iter().enumerate() {
                        if let ImportDeclarationSpecifier::ImportSpecifier(named) = spec {
                            if named.local.name.as_str() == name {
                                return Some(ImportLocation {
                                    import_stmt_index: stmt_idx,
                                    specifier_index: spec_idx,
                                    specifier_name: named.imported.name().as_str().to_string(),
                                    source: import_decl.source.value.as_str().to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
        None
    }
}
