use crate::models::{ExtractedStyle, SourceSpan};
use oxc_ast::ast::{
    CallExpression, Class, ClassElement, Expression, MethodDefinitionKind, PropertyKey, Statement,
    TaggedTemplateExpression, VariableDeclaration,
};
use oxc_ast::Visit;
use oxc_span::Span;
use std::collections::{HashMap, HashSet};

pub struct CssTagVisitor<'a> {
    pub source_code: &'a str,
    pub file_path: &'a str,
    pub extracted_styles: Vec<ExtractedStyle>,
    pub imported_styles_identifiers: HashMap<String, String>, // ident -> import_specifier
    pub css_identifiers: HashSet<String>,
    current_class_name: Option<String>,
    current_tag_name: Option<String>,
}

impl<'a> CssTagVisitor<'a> {
    pub fn new(source_code: &'a str, file_path: &'a str) -> Self {
        let mut css_identifiers = HashSet::new();
        css_identifiers.insert("css".to_string());

        Self {
            source_code,
            file_path,
            extracted_styles: Vec::new(),
            imported_styles_identifiers: HashMap::new(),
            css_identifiers,
            current_class_name: None,
            current_tag_name: None,
        }
    }

    fn compute_span(&self, span: Span) -> SourceSpan {
        let start = span.start as usize;
        let end = span.end as usize;

        let mut line = 1;
        let mut column = 1;

        for (idx, ch) in self.source_code.char_indices() {
            if idx >= start {
                break;
            }
            if ch == '\n' {
                line += 1;
                column = 1;
            } else {
                column += 1;
            }
        }

        SourceSpan {
            start,
            end,
            line,
            column,
        }
    }

    fn get_css_tag_name(&self, expr: &Expression<'a>) -> Option<String> {
        match expr {
            Expression::Identifier(ident) => {
                if ident.name == "css" || self.css_identifiers.contains(ident.name.as_str()) {
                    Some(ident.name.to_string())
                } else {
                    None
                }
            }
            Expression::StaticMemberExpression(member) => {
                if member.property.name == "css" {
                    Some("css".to_string())
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    fn extract_css_from_tagged_template(
        &mut self,
        tagged: &TaggedTemplateExpression<'a>,
        component_name: Option<String>,
        tag_name: Option<String>,
        export_name: Option<String>,
        location_kind: &str,
        parent_span: Option<SourceSpan>,
    ) {
        let tag_ident = match self.get_css_tag_name(&tagged.tag) {
            Some(name) => name,
            None => return,
        };

        // Extract raw text from the template quasis
        let mut raw_css = String::new();
        for (i, quasi) in tagged.quasi.quasis.iter().enumerate() {
            raw_css.push_str(quasi.value.raw.as_str());
            if i < tagged.quasi.expressions.len() {
                raw_css.push_str("/*__INTERPOLATION__*/");
            }
        }

        let span = self.compute_span(tagged.span);

        self.extracted_styles.push(ExtractedStyle {
            file_path: self.file_path.to_string(),
            component_name,
            tag_name,
            css_text: raw_css,
            span,
            is_external_module: export_name.is_some(),
            export_name,
            location_kind: location_kind.to_string(),
            parent_span,
            tag_identifier: Some(tag_ident),
        });
    }

    fn extract_css_from_call(
        &mut self,
        call: &CallExpression<'a>,
        component_name: Option<String>,
        tag_name: Option<String>,
        export_name: Option<String>,
        location_kind: &str,
        parent_span: Option<SourceSpan>,
    ) {
        let tag_ident = match self.get_css_tag_name(&call.callee) {
            Some(name) => name,
            None => return,
        };

        if call.arguments.is_empty() {
            return;
        }

        let mut raw_css = String::new();

        if let Some(first_arg) = call.arguments.first() {
            if let Some(expr) = first_arg.as_expression() {
                match expr {
                    Expression::ArrayExpression(arr) => {
                        for elem in &arr.elements {
                            if let Some(e) = elem.as_expression() {
                                match e {
                                    Expression::StringLiteral(lit) => {
                                        raw_css.push_str(lit.value.as_str());
                                    }
                                    Expression::TemplateLiteral(temp) => {
                                        for (i, quasi) in temp.quasis.iter().enumerate() {
                                            raw_css.push_str(quasi.value.raw.as_str());
                                            if i < temp.expressions.len() {
                                                raw_css.push_str("/*__INTERPOLATION__*/");
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                    Expression::StringLiteral(lit) => {
                        raw_css.push_str(lit.value.as_str());
                    }
                    Expression::TemplateLiteral(temp) => {
                        for (i, quasi) in temp.quasis.iter().enumerate() {
                            raw_css.push_str(quasi.value.raw.as_str());
                            if i < temp.expressions.len() {
                                raw_css.push_str("/*__INTERPOLATION__*/");
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        if raw_css.trim().is_empty() {
            return;
        }

        let span = self.compute_span(call.span);

        self.extracted_styles.push(ExtractedStyle {
            file_path: self.file_path.to_string(),
            component_name,
            tag_name,
            css_text: raw_css,
            span,
            is_external_module: export_name.is_some(),
            export_name,
            location_kind: location_kind.to_string(),
            parent_span,
            tag_identifier: Some(tag_ident),
        });
    }

    fn extract_from_expression(
        &mut self,
        expr: &Expression<'a>,
        component_name: Option<String>,
        tag_name: Option<String>,
        export_name: Option<String>,
        location_kind: &str,
        parent_span: Option<SourceSpan>,
    ) {
        match expr {
            Expression::TaggedTemplateExpression(tagged) => {
                self.extract_css_from_tagged_template(
                    tagged,
                    component_name,
                    tag_name,
                    export_name,
                    location_kind,
                    parent_span,
                );
            }
            Expression::CallExpression(call) => {
                self.extract_css_from_call(
                    call,
                    component_name,
                    tag_name,
                    export_name,
                    location_kind,
                    parent_span,
                );
            }
            Expression::ArrayExpression(arr) => {
                let child_kind = if location_kind == "static_property" {
                    "static_property_array_element"
                } else {
                    location_kind
                };
                for elem in &arr.elements {
                    if let Some(e) = elem.as_expression() {
                        self.extract_from_expression(
                            e,
                            component_name.clone(),
                            tag_name.clone(),
                            export_name.clone(),
                            child_kind,
                            parent_span.clone(),
                        );
                    }
                }
            }
            _ => {}
        }
    }

    fn get_decorator_tag_name(&self, class: &Class<'a>) -> Option<String> {
        for decorator in &class.decorators {
            if let Expression::CallExpression(call) = &decorator.expression {
                if let Expression::Identifier(ident) = &call.callee {
                    if ident.name == "customElement" {
                        if let Some(first_arg) = call.arguments.first() {
                            if let Some(Expression::StringLiteral(str_lit)) =
                                first_arg.as_expression()
                            {
                                return Some(str_lit.value.to_string());
                            }
                        }
                    }
                }
            }
        }
        None
    }
}

impl<'a> Visit<'a> for CssTagVisitor<'a> {
    fn visit_import_declaration(&mut self, import_decl: &oxc_ast::ast::ImportDeclaration<'a>) {
        let source_str = import_decl.source.value.to_string();
        if let Some(specifiers) = &import_decl.specifiers {
            for spec in specifiers {
                match spec {
                    oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(s) => {
                        let local_name = s.local.name.to_string();
                        let imported_name = match &s.imported {
                            oxc_ast::ast::ModuleExportName::Identifier(id) => id.name.to_string(),
                            oxc_ast::ast::ModuleExportName::StringLiteral(lit) => {
                                lit.value.to_string()
                            }
                        };
                        if imported_name == "styles"
                            || imported_name.ends_with("Styles")
                            || imported_name == "default"
                        {
                            self.imported_styles_identifiers
                                .insert(local_name.clone(), source_str.clone());
                        }
                        if imported_name == "css" {
                            self.css_identifiers.insert(local_name);
                        }
                    }
                    oxc_ast::ast::ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                        let local_name = s.local.name.to_string();
                        self.imported_styles_identifiers
                            .insert(local_name, source_str.clone());
                    }
                    _ => {}
                }
            }
        }
    }

    fn visit_class(&mut self, class: &Class<'a>) {
        let class_name = class
            .id
            .as_ref()
            .map(|id| id.name.to_string())
            .unwrap_or_else(|| "AnonymousComponent".to_string());

        let tag_name = self.get_decorator_tag_name(class);

        self.current_class_name = Some(class_name.clone());
        self.current_tag_name = tag_name.clone();

        for element in &class.body.body {
            match element {
                ClassElement::PropertyDefinition(prop) => {
                    let is_styles_key = match &prop.key {
                        PropertyKey::StaticIdentifier(id) => id.name == "styles",
                        PropertyKey::Identifier(id) => id.name == "styles",
                        _ => false,
                    };

                    if prop.r#static && is_styles_key {
                        if let Some(value) = &prop.value {
                            let parent_span = Some(self.compute_span(prop.span));
                            self.extract_from_expression(
                                value,
                                Some(class_name.clone()),
                                tag_name.clone(),
                                None,
                                "static_property",
                                parent_span,
                            );
                        }
                    }
                }
                ClassElement::MethodDefinition(method) => {
                    let is_styles_key = match &method.key {
                        PropertyKey::StaticIdentifier(id) => id.name == "styles",
                        PropertyKey::Identifier(id) => id.name == "styles",
                        _ => false,
                    };

                    if method.r#static && method.kind == MethodDefinitionKind::Get && is_styles_key
                    {
                        if let Some(body) = &method.value.body {
                            for stmt in &body.statements {
                                if let Statement::ReturnStatement(ret) = stmt {
                                    if let Some(arg) = &ret.argument {
                                        let parent_span = Some(self.compute_span(ret.span));
                                        self.extract_from_expression(
                                            arg,
                                            Some(class_name.clone()),
                                            tag_name.clone(),
                                            None,
                                            "static_getter",
                                            parent_span,
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        self.current_class_name = None;
        self.current_tag_name = None;
    }

    fn visit_variable_declaration(&mut self, decl: &VariableDeclaration<'a>) {
        for declarator in &decl.declarations {
            if let oxc_ast::ast::BindingPatternKind::BindingIdentifier(id) = &declarator.id.kind {
                let name = id.name.to_string();
                if let Some(init) = &declarator.init {
                    let parent_span = Some(self.compute_span(declarator.span));
                    self.extract_from_expression(
                        init,
                        None,
                        None,
                        Some(name),
                        "variable",
                        parent_span,
                    );
                }
            }
        }
    }

    fn visit_export_default_declaration(
        &mut self,
        decl: &oxc_ast::ast::ExportDefaultDeclaration<'a>,
    ) {
        let parent_span = Some(self.compute_span(decl.span));
        if let Some(expr) = decl.declaration.as_expression() {
            self.extract_from_expression(
                expr,
                None,
                None,
                Some("default".to_string()),
                "export_default",
                parent_span,
            );
        }
    }

    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        let span = self.compute_span(tagged.span);
        let already_extracted = self
            .extracted_styles
            .iter()
            .any(|s| s.span.start == span.start);
        if !already_extracted {
            self.extract_css_from_tagged_template(
                tagged,
                self.current_class_name.clone(),
                self.current_tag_name.clone(),
                None,
                "standalone",
                None,
            );
        }
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let span = self.compute_span(call.span);
        let already_extracted = self
            .extracted_styles
            .iter()
            .any(|s| s.span.start == span.start);
        if !already_extracted {
            self.extract_css_from_call(
                call,
                self.current_class_name.clone(),
                self.current_tag_name.clone(),
                None,
                "standalone",
                None,
            );
        }
    }
}
