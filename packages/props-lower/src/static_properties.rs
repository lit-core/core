use crate::ast_helpers::AstHelper;
use oxc_allocator::{ArenaVec, CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;
use std::collections::HashMap;

pub struct ReactiveProp<'a> {
    pub name: String,
    pub options: Option<Expression<'a>>,
}

pub fn inject_or_merge_static_properties<'a>(
    class: &mut Class<'a>,
    reactive_props: Vec<ReactiveProp<'a>>,
    ast: &AstBuilder<'a>,
) {
    if reactive_props.is_empty() {
        return;
    }

    // 1. Check if static properties already exists
    for element in &mut class.body.body {
        match element {
            ClassElement::PropertyDefinition(prop_def) => {
                if prop_def.r#static && prop_def.key.is_specific_static_name("properties") {
                    if let Some(Expression::ObjectExpression(ref mut obj)) = prop_def.value {
                        append_props_to_object(obj, reactive_props, ast);
                        return;
                    }
                }
            }
            ClassElement::MethodDefinition(method_def)
                if method_def.r#static
                    && method_def.kind == MethodDefinitionKind::Get
                    && method_def.key.is_specific_static_name("properties") =>
            {
                if let Some(ref mut body) = method_def.value.body {
                    if let Some(Statement::ReturnStatement(ret_stmt)) = body.statements.first_mut()
                    {
                        if let Some(Expression::ObjectExpression(ref mut obj)) = ret_stmt.argument {
                            append_props_to_object(obj, reactive_props, ast);
                            return;
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // 2. Not found, create new `static properties = { ... };` and insert at index 0
    let mut obj_props = ArenaVec::new_in(ast);
    for prop in reactive_props {
        let key =
            PropertyKey::new_static_identifier(SPAN, ast.allocator().alloc_str(&prop.name), ast);
        let val = prop
            .options
            .unwrap_or_else(|| Expression::new_object_expression(SPAN, ArenaVec::new_in(ast), ast));

        let obj_prop = ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key,
            val,
            false,
            false,
            false,
            ast,
        );
        obj_props.push(obj_prop);
    }

    let obj_expr = Expression::new_object_expression(SPAN, obj_props, ast);
    let static_prop_key = PropertyKey::new_static_identifier(SPAN, "properties", ast);

    let static_prop_element = ClassElement::new_property_definition(
        SPAN,
        PropertyDefinitionType::PropertyDefinition,
        ArenaVec::new_in(ast),
        static_prop_key,
        None,
        Some(obj_expr),
        false,
        true, // static = true
        false,
        false,
        false,
        false,
        false,
        None,
        ast,
    );

    class.body.body.insert(0, static_prop_element);
}

fn append_props_to_object<'a>(
    obj: &mut ObjectExpression<'a>,
    reactive_props: Vec<ReactiveProp<'a>>,
    ast: &AstBuilder<'a>,
) {
    for prop in reactive_props {
        let key =
            PropertyKey::new_static_identifier(SPAN, ast.allocator().alloc_str(&prop.name), ast);
        let val = prop
            .options
            .unwrap_or_else(|| Expression::new_object_expression(SPAN, ArenaVec::new_in(ast), ast));

        let obj_prop = ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key,
            val,
            false,
            false,
            false,
            ast,
        );
        obj.properties.push(obj_prop);
    }
}

/// Computes a canonical signature and descriptive constant identifier for static property descriptor presets.
pub fn serialize_descriptor_preset(expr: &Expression) -> Option<(String, String)> {
    let Expression::ObjectExpression(obj) = expr else {
        return None;
    };
    if obj.properties.is_empty() {
        return None;
    }

    let mut entries = Vec::new();
    let mut has_type_bool = false;
    let mut has_type_str = false;
    let mut has_type_num = false;
    let mut has_reflect_true = false;
    let mut is_state = false;

    for prop_kind in &obj.properties {
        let ObjectPropertyKind::ObjectProperty(prop) = prop_kind else {
            return None;
        };
        let key_name = match &prop.key {
            PropertyKey::StaticIdentifier(id) => id.name.as_str(),
            PropertyKey::StringLiteral(s) => s.value.as_str(),
            _ => return None,
        };

        let val_repr = match &prop.value {
            Expression::Identifier(id) => {
                let id_name = id.name.as_str();
                if key_name == "type" {
                    match id_name {
                        "Boolean" => has_type_bool = true,
                        "String" => has_type_str = true,
                        "Number" => has_type_num = true,
                        _ => {}
                    }
                }
                id_name.to_string()
            }
            Expression::BooleanLiteral(b) => {
                if key_name == "reflect" && b.value {
                    has_reflect_true = true;
                }
                if key_name == "state" && b.value {
                    is_state = true;
                }
                b.value.to_string()
            }
            Expression::StringLiteral(s) => format!("\"{}\"", s.value),
            Expression::NumericLiteral(n) => n.value.to_string(),
            _ => return None, // complex dynamic expressions are not presets
        };

        entries.push(format!("{}:{}", key_name, val_repr));
    }

    entries.sort();
    let sig = entries.join(",");

    let const_name = if is_state {
        "_PROP_STATE".to_string()
    } else if has_type_bool && has_reflect_true {
        "_PROP_BOOL_REFLECT".to_string()
    } else if has_type_bool {
        "_PROP_BOOL".to_string()
    } else if has_type_str && has_reflect_true {
        "_PROP_STRING_REFLECT".to_string()
    } else if has_type_str {
        "_PROP_STRING".to_string()
    } else if has_type_num && has_reflect_true {
        "_PROP_NUM_REFLECT".to_string()
    } else if has_type_num {
        "_PROP_NUM".to_string()
    } else {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        sig.hash(&mut hasher);
        format!("_PROP_PRESET_{:08x}", hasher.finish() as u32)
    };

    Some((sig, const_name))
}

/// Deduplicate property descriptor presets across the module into frozen constants.
pub fn deduplicate_descriptors_in_program<'a>(program: &mut Program<'a>, ast: &AstBuilder<'a>) {
    let mut sig_counts: HashMap<String, usize> = HashMap::new();
    let mut sig_to_const: HashMap<String, String> = HashMap::new();
    let mut sig_to_template: HashMap<String, Expression<'a>> = HashMap::new();

    // Helper to inspect class elements
    fn inspect_class_elements<'a, F>(class: &mut Class<'a>, mut f: F)
    where
        F: FnMut(&mut ObjectExpression<'a>),
    {
        for element in &mut class.body.body {
            match element {
                ClassElement::PropertyDefinition(prop_def) => {
                    if prop_def.r#static && prop_def.key.is_specific_static_name("properties") {
                        if let Some(Expression::ObjectExpression(ref mut obj)) = prop_def.value {
                            f(obj);
                        }
                    }
                }
                ClassElement::MethodDefinition(method_def)
                    if method_def.r#static
                        && method_def.kind == MethodDefinitionKind::Get
                        && method_def.key.is_specific_static_name("properties") =>
                {
                    if let Some(ref mut body) = method_def.value.body {
                        if let Some(Statement::ReturnStatement(ret_stmt)) =
                            body.statements.first_mut()
                        {
                            if let Some(Expression::ObjectExpression(ref mut obj)) =
                                ret_stmt.argument
                            {
                                f(obj);
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    // 1. First pass: count frequencies across all classes
    for stmt in &mut program.body {
        match stmt {
            Statement::ClassDeclaration(class) => {
                inspect_class_elements(class, |obj| {
                    for prop_kind in &obj.properties {
                        if let ObjectPropertyKind::ObjectProperty(prop) = prop_kind {
                            if let Some((sig, const_name)) =
                                serialize_descriptor_preset(&prop.value)
                            {
                                *sig_counts.entry(sig.clone()).or_insert(0) += 1;
                                sig_to_const.entry(sig.clone()).or_insert(const_name);
                                sig_to_template
                                    .entry(sig)
                                    .or_insert_with(|| prop.value.clone_in(ast.allocator()));
                            }
                        }
                    }
                });
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &mut export_decl.declaration {
                    inspect_class_elements(class, |obj| {
                        for prop_kind in &obj.properties {
                            if let ObjectPropertyKind::ObjectProperty(prop) = prop_kind {
                                if let Some((sig, const_name)) =
                                    serialize_descriptor_preset(&prop.value)
                                {
                                    *sig_counts.entry(sig.clone()).or_insert(0) += 1;
                                    sig_to_const.entry(sig.clone()).or_insert(const_name);
                                    sig_to_template
                                        .entry(sig)
                                        .or_insert_with(|| prop.value.clone_in(ast.allocator()));
                                }
                            }
                        }
                    });
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &mut export_decl.declaration
                {
                    inspect_class_elements(class, |obj| {
                        for prop_kind in &obj.properties {
                            if let ObjectPropertyKind::ObjectProperty(prop) = prop_kind {
                                if let Some((sig, const_name)) =
                                    serialize_descriptor_preset(&prop.value)
                                {
                                    *sig_counts.entry(sig.clone()).or_insert(0) += 1;
                                    sig_to_const.entry(sig.clone()).or_insert(const_name);
                                    sig_to_template
                                        .entry(sig)
                                        .or_insert_with(|| prop.value.clone_in(ast.allocator()));
                                }
                            }
                        }
                    });
                }
            }
            _ => {}
        }
    }

    // Check if any preset has count >= 2
    let repeating_sigs: Vec<String> = sig_counts
        .iter()
        .filter(|(_, &count)| count >= 2)
        .map(|(sig, _)| sig.clone())
        .collect();

    if repeating_sigs.is_empty() {
        return;
    }

    // 2. Second pass: replace repeating configurations with identifier references
    for stmt in &mut program.body {
        let helper = AstHelper::new(ast);
        match stmt {
            Statement::ClassDeclaration(class) => {
                inspect_class_elements(class, |obj| {
                    for prop_kind in &mut obj.properties {
                        if let ObjectPropertyKind::ObjectProperty(prop) = prop_kind {
                            if let Some((sig, _)) = serialize_descriptor_preset(&prop.value) {
                                if sig_counts.get(&sig).copied().unwrap_or(0) >= 2 {
                                    if let Some(const_name) = sig_to_const.get(&sig) {
                                        let ident =
                                            helper.ident_ref(ast.allocator().alloc_str(const_name));
                                        prop.value = ident;
                                    }
                                }
                            }
                        }
                    }
                });
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &mut export_decl.declaration {
                    inspect_class_elements(class, |obj| {
                        for prop_kind in &mut obj.properties {
                            if let ObjectPropertyKind::ObjectProperty(prop) = prop_kind {
                                if let Some((sig, _)) = serialize_descriptor_preset(&prop.value) {
                                    if sig_counts.get(&sig).copied().unwrap_or(0) >= 2 {
                                        if let Some(const_name) = sig_to_const.get(&sig) {
                                            let ident = helper
                                                .ident_ref(ast.allocator().alloc_str(const_name));
                                            prop.value = ident;
                                        }
                                    }
                                }
                            }
                        }
                    });
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &mut export_decl.declaration
                {
                    inspect_class_elements(class, |obj| {
                        for prop_kind in &mut obj.properties {
                            if let ObjectPropertyKind::ObjectProperty(prop) = prop_kind {
                                if let Some((sig, _)) = serialize_descriptor_preset(&prop.value) {
                                    if sig_counts.get(&sig).copied().unwrap_or(0) >= 2 {
                                        if let Some(const_name) = sig_to_const.get(&sig) {
                                            let ident = helper
                                                .ident_ref(ast.allocator().alloc_str(const_name));
                                            prop.value = ident;
                                        }
                                    }
                                }
                            }
                        }
                    });
                }
            }
            _ => {}
        }
    }

    // 3. Generate frozen constant declarations: const _PROP_XXX = Object.freeze({ ... });
    let helper = AstHelper::new(ast);
    let mut frozen_constants = Vec::new();
    let mut sorted_repeating_sigs = repeating_sigs;
    sorted_repeating_sigs.sort();

    for sig in sorted_repeating_sigs {
        if let (Some(const_name), Some(template_expr)) =
            (sig_to_const.get(&sig), sig_to_template.remove(&sig))
        {
            let obj_ident = helper.ident_ref("Object");
            let freeze_callee = helper.static_member(obj_ident, "freeze", false);
            let mut freeze_args = ArenaVec::new_in(ast);
            freeze_args.push(Argument::from(template_expr));
            let freeze_call = helper.call_expr(freeze_callee, freeze_args, false);
            let const_stmt =
                helper.const_declaration(ast.allocator().alloc_str(const_name), freeze_call);
            frozen_constants.push(const_stmt);
        }
    }

    // 4. Insert frozen constants right after the last import statement
    let mut last_import_idx = 0;
    for (i, stmt) in program.body.iter().enumerate() {
        if matches!(stmt, Statement::ImportDeclaration(_)) {
            last_import_idx = i + 1;
        }
    }

    for const_stmt in frozen_constants.into_iter().rev() {
        program.body.insert(last_import_idx, const_stmt);
    }
}
