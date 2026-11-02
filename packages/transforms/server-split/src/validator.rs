use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::{GetSpan, SPAN, Span};
use oxc_syntax::number::NumberBase;

use crate::diagnostics::DiagnosticCode;

#[derive(Debug, Clone, PartialEq)]
pub enum LiteralValue {
    String(String),
    Number(f64),
    Boolean(bool),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ObjectPropertySchema {
    pub key: String,
    pub schema: ValidationSchema,
    pub optional: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ValidationSchema {
    Boolean,
    Number,
    String,
    BigInt,
    LiteralUnion(Vec<LiteralValue>),
    Array(Box<ValidationSchema>),
    Object {
        properties: Vec<ObjectPropertySchema>,
        strict: bool,
    },
    Optional(Box<ValidationSchema>),
}

impl ValidationSchema {
    pub fn to_meta_type_string(&self) -> String {
        match self {
            Self::Boolean => "boolean".to_string(),
            Self::Number => "number".to_string(),
            Self::String => "string".to_string(),
            Self::BigInt => "bigint".to_string(),
            Self::LiteralUnion(lits) => {
                let parts: Vec<String> = lits
                    .iter()
                    .map(|l| match l {
                        LiteralValue::String(s) => format!("\"{}\"", s),
                        LiteralValue::Number(n) => n.to_string(),
                        LiteralValue::Boolean(b) => b.to_string(),
                    })
                    .collect();
                parts.join(" | ")
            }
            Self::Array(elem) => format!("{}[]", elem.to_meta_type_string()),
            Self::Object { properties, .. } => {
                let props: Vec<String> = properties
                    .iter()
                    .map(|p| {
                        format!(
                            "{}{}: {}",
                            p.key,
                            if p.optional { "?" } else { "" },
                            p.schema.to_meta_type_string()
                        )
                    })
                    .collect();
                format!("{{ {} }}", props.join("; "))
            }
            Self::Optional(inner) => format!("{} | undefined", inner.to_meta_type_string()),
        }
    }
}

pub fn extract_param_schema<'a>(
    ts_type: &'a TSType<'a>,
    param_name: &str,
    is_param_optional: bool,
    span: Span,
) -> Result<ValidationSchema, (DiagnosticCode, String, Span)> {
    let schema = match ts_type {
        TSType::TSBooleanKeyword(_) => ValidationSchema::Boolean,
        TSType::TSNumberKeyword(_) => ValidationSchema::Number,
        TSType::TSStringKeyword(_) => ValidationSchema::String,
        TSType::TSBigIntKeyword(_) => ValidationSchema::BigInt,
        TSType::TSUnionType(union_type) => {
            let mut has_undefined = false;
            let mut lits = Vec::new();
            let mut non_literal_schemas = Vec::new();

            for member in &union_type.types {
                match member {
                    TSType::TSUndefinedKeyword(_) => has_undefined = true,
                    TSType::TSLiteralType(lit) => match &lit.literal {
                        TSLiteral::StringLiteral(s) => {
                            lits.push(LiteralValue::String(s.value.as_str().to_string()))
                        }
                        TSLiteral::NumericLiteral(n) => lits.push(LiteralValue::Number(n.value)),
                        TSLiteral::BooleanLiteral(b) => lits.push(LiteralValue::Boolean(b.value)),
                        _ => {
                            return Err((
                                DiagnosticCode::SE102,
                                format!(
                                    "Unsupported literal in union on @action() parameter '{}'.",
                                    param_name
                                ),
                                span,
                            ));
                        }
                    },
                    other => {
                        let sub = extract_param_schema(other, param_name, false, member.span())?;
                        non_literal_schemas.push(sub);
                    }
                }
            }

            let base = if !lits.is_empty() && non_literal_schemas.is_empty() {
                ValidationSchema::LiteralUnion(lits)
            } else if lits.is_empty() && non_literal_schemas.len() == 1 {
                non_literal_schemas.into_iter().next().unwrap()
            } else {
                return Err((
                    DiagnosticCode::SE102,
                    format!(
                        "Complex heterogeneous union on @action() parameter '{}' is not supported. Use a literal union or single primitive type.",
                        param_name
                    ),
                    span,
                ));
            };

            if has_undefined {
                ValidationSchema::Optional(Box::new(base))
            } else {
                base
            }
        }
        TSType::TSArrayType(arr) => {
            let elem_schema = extract_param_schema(&arr.element_type, param_name, false, arr.span)?;
            ValidationSchema::Array(Box::new(elem_schema))
        }
        TSType::TSTypeReference(tref) => {
            let type_name = match &tref.type_name {
                TSTypeName::IdentifierReference(id) => id.name.as_str(),
                _ => "",
            };
            if type_name == "Array"
                && let Some(params) = &tref.type_arguments
                && let Some(first) = params.params.first()
            {
                let elem_schema = extract_param_schema(first, param_name, false, first.span())?;
                return Ok(ValidationSchema::Array(Box::new(elem_schema)));
            }
            return Err((
                DiagnosticCode::SE102,
                format!(
                    "Unsupported type reference '{}' on @action() parameter '{}'. Only primitives, literal unions, arrays, and plain object shapes are supported.",
                    type_name, param_name
                ),
                span,
            ));
        }
        TSType::TSTypeLiteral(type_lit) => {
            let mut properties = Vec::new();
            for member in &type_lit.members {
                match member {
                    TSSignature::TSPropertySignature(prop) => {
                        let key = match &prop.key {
                            PropertyKey::StaticIdentifier(id) => id.name.as_str().to_string(),
                            PropertyKey::StringLiteral(s) => s.value.as_str().to_string(),
                            _ => {
                                return Err((
                                    DiagnosticCode::SE102,
                                    format!(
                                        "Computed or dynamic property key on object parameter '{}' is not supported.",
                                        param_name
                                    ),
                                    prop.span,
                                ));
                            }
                        };
                        let opt = prop.optional;
                        let prop_type = if let Some(type_ann) = &prop.type_annotation {
                            extract_param_schema(
                                &type_ann.type_annotation,
                                &format!("{}.{}", param_name, key),
                                opt,
                                prop.span,
                            )?
                        } else {
                            return Err((
                                DiagnosticCode::SE102,
                                format!(
                                    "Missing type annotation on property '{}.{}'. Action parameters must be explicitly typed.",
                                    param_name, key
                                ),
                                prop.span,
                            ));
                        };
                        properties.push(ObjectPropertySchema {
                            key,
                            schema: prop_type,
                            optional: opt,
                        });
                    }
                    _ => {
                        return Err((
                            DiagnosticCode::SE102,
                            format!(
                                "Method or call signature in object parameter '{}' is rejected by data-only action protocol.",
                                param_name
                            ),
                            span,
                        ));
                    }
                }
            }
            ValidationSchema::Object {
                properties,
                strict: true,
            }
        }
        TSType::TSAnyKeyword(_) | TSType::TSUnknownKeyword(_) => {
            return Err((
                DiagnosticCode::SE102,
                format!(
                    "Explicit or implicit 'any' / 'unknown' on @action() parameter '{}' is forbidden. Specify an explicit data schema.",
                    param_name
                ),
                span,
            ));
        }
        TSType::TSFunctionType(_) => {
            return Err((
                DiagnosticCode::SE102,
                format!(
                    "Function callback on @action() parameter '{}' cannot cross the action RPC wire.",
                    param_name
                ),
                span,
            ));
        }
        _ => {
            return Err((
                DiagnosticCode::SE102,
                format!(
                    "Unsupported TypeScript type on @action() parameter '{}'. Only primitives, literal unions, arrays, and plain object shapes are supported.",
                    param_name
                ),
                span,
            ));
        }
    };

    if is_param_optional && !matches!(schema, ValidationSchema::Optional(_)) {
        Ok(ValidationSchema::Optional(Box::new(schema)))
    } else {
        Ok(schema)
    }
}

/// Builds an AST function declaration:
/// ```js
/// function __lit_validate_<action_name>(args) { ... }
/// ```
pub fn build_validator_function<'a>(
    ast: &AstBuilder<'a>,
    action_name: &str,
    schemas: &[(String, ValidationSchema, bool)],
) -> Statement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    // 1. if (!Array.isArray(args)) throw new TypeError("Action arguments must be an array");
    let is_array_call = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "Array", ast),
            IdentifierName::new(SPAN, "isArray", ast),
            false,
            ast,
        ),
        None,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(Expression::new_identifier(
                SPAN, "args", ast,
            )));
            a
        },
        false,
        ast,
    );
    let not_array =
        Expression::new_unary_expression(SPAN, UnaryOperator::LogicalNot, is_array_call, ast);
    let throw_array_err = Statement::new_throw_statement(
        SPAN,
        Expression::new_new_expression(
            SPAN,
            Expression::new_identifier(SPAN, "TypeError", ast),
            None,
            {
                let mut a = ArenaVec::new_in(ast);
                a.push(Argument::from(Expression::new_string_literal(
                    SPAN,
                    "Action arguments must be an array",
                    None,
                    ast,
                )));
                a
            },
            ast,
        ),
        ast,
    );
    stmts.push(Statement::new_if_statement(
        SPAN,
        not_array,
        throw_array_err,
        None,
        ast,
    ));

    // 2. Validate each parameter
    for (i, (param_name, schema, optional)) in schemas.iter().enumerate() {
        let p_var = ast.allocator().alloc_str(&format!("p{}", i));
        // const p0 = args[0];
        let arg_access = Expression::new_computed_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "args", ast),
            Expression::new_numeric_literal(SPAN, i as f64, None, NumberBase::Decimal, ast),
            false,
            ast,
        );

        let mut decls = ArenaVec::new_in(ast);
        decls.push(VariableDeclarator::new(
            SPAN,
            BindingPattern::new_binding_identifier(SPAN, p_var, ast),
            None,
            Some(arg_access),
            false,
            ast,
        ));
        stmts.push(Statement::new_variable_declaration(
            SPAN,
            VariableDeclarationKind::Const,
            decls,
            false,
            ast,
        ));

        // Generate validation check for p_var
        let checks = build_schema_check(ast, p_var, param_name, schema, *optional, 0);
        for check_stmt in checks {
            stmts.push(check_stmt);
        }
    }

    // 3. return args;
    stmts.push(Statement::new_return_statement(
        SPAN,
        Some(Expression::new_identifier(SPAN, "args", ast)),
        ast,
    ));

    let func_name = ast
        .allocator()
        .alloc_str(&format!("__lit_validate_{}", action_name));
    let mut params_vec = ArenaVec::new_in(ast);
    params_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "args", ast),
        ast,
    ));

    let formal_params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        params_vec,
        None,
        ast,
    );

    let func_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);

    Statement::new_function_declaration(
        SPAN,
        FunctionType::FunctionDeclaration,
        Some(BindingIdentifier::new(SPAN, func_name, ast)),
        false,
        false,
        false,
        None,
        None,
        formal_params,
        None,
        Some(func_body),
        ast,
    )
}

fn build_schema_check<'a>(
    ast: &AstBuilder<'a>,
    var_name: &'a str,
    label: &str,
    schema: &ValidationSchema,
    optional: bool,
    depth: usize,
) -> Vec<Statement<'a>> {
    let mut stmts = Vec::new();

    // Check optional: if (var !== undefined) { ... } or if (var === undefined) throw ...
    if optional || matches!(schema, ValidationSchema::Optional(_)) {
        let inner = match schema {
            ValidationSchema::Optional(b) => b.as_ref(),
            _ => schema,
        };

        // if (var !== undefined) { <inner_checks> }
        let test_defined = Expression::new_binary_expression(
            SPAN,
            Expression::new_identifier(SPAN, var_name, ast),
            BinaryOperator::StrictInequality,
            Expression::new_identifier(SPAN, "undefined", ast),
            ast,
        );

        let inner_checks = build_schema_check(ast, var_name, label, inner, false, depth);
        let mut block_stmts = ArenaVec::new_in(ast);
        for s in inner_checks {
            block_stmts.push(s);
        }

        let consequent = Statement::new_block_statement(SPAN, block_stmts, ast);
        stmts.push(Statement::new_if_statement(
            SPAN,
            test_defined,
            consequent,
            None,
            ast,
        ));
        return stmts;
    }

    match schema {
        ValidationSchema::Boolean => {
            // if (typeof var !== "boolean") throw new TypeError("Invalid argument '<label>': expected boolean");
            let typeof_expr = Expression::new_unary_expression(
                SPAN,
                UnaryOperator::Typeof,
                Expression::new_identifier(SPAN, var_name, ast),
                ast,
            );
            let test = Expression::new_binary_expression(
                SPAN,
                typeof_expr,
                BinaryOperator::StrictInequality,
                Expression::new_string_literal(SPAN, "boolean", None, ast),
                ast,
            );
            let msg = ast
                .allocator()
                .alloc_str(&format!("Invalid argument '{}': expected boolean", label));
            stmts.push(build_throw_type_error(ast, test, msg));
        }
        ValidationSchema::String => {
            // if (typeof var !== "string") throw new TypeError("Invalid argument '<label>': expected string");
            let typeof_expr = Expression::new_unary_expression(
                SPAN,
                UnaryOperator::Typeof,
                Expression::new_identifier(SPAN, var_name, ast),
                ast,
            );
            let test = Expression::new_binary_expression(
                SPAN,
                typeof_expr,
                BinaryOperator::StrictInequality,
                Expression::new_string_literal(SPAN, "string", None, ast),
                ast,
            );
            let msg = ast
                .allocator()
                .alloc_str(&format!("Invalid argument '{}': expected string", label));
            stmts.push(build_throw_type_error(ast, test, msg));
        }
        ValidationSchema::Number => {
            // if (!Number.isFinite(var)) throw new TypeError("Invalid argument '<label>': expected number");
            let is_finite_call = Expression::new_call_expression(
                SPAN,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, "Number", ast),
                    IdentifierName::new(SPAN, "isFinite", ast),
                    false,
                    ast,
                ),
                None,
                {
                    let mut a = ArenaVec::new_in(ast);
                    a.push(Argument::from(Expression::new_identifier(
                        SPAN, var_name, ast,
                    )));
                    a
                },
                false,
                ast,
            );
            let not_finite = Expression::new_unary_expression(
                SPAN,
                UnaryOperator::LogicalNot,
                is_finite_call,
                ast,
            );
            let msg = ast
                .allocator()
                .alloc_str(&format!("Invalid argument '{}': expected number", label));
            stmts.push(build_throw_type_error(ast, not_finite, msg));
        }
        ValidationSchema::BigInt => {
            let typeof_expr = Expression::new_unary_expression(
                SPAN,
                UnaryOperator::Typeof,
                Expression::new_identifier(SPAN, var_name, ast),
                ast,
            );
            let test = Expression::new_binary_expression(
                SPAN,
                typeof_expr,
                BinaryOperator::StrictInequality,
                Expression::new_string_literal(SPAN, "bigint", None, ast),
                ast,
            );
            let msg = ast
                .allocator()
                .alloc_str(&format!("Invalid argument '{}': expected bigint", label));
            stmts.push(build_throw_type_error(ast, test, msg));
        }
        ValidationSchema::LiteralUnion(lits) => {
            // if (var !== lit1 && var !== lit2 ...) throw ...
            if let Some(first) = lits.first() {
                let mut test = Expression::new_binary_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, var_name, ast),
                    BinaryOperator::StrictInequality,
                    literal_value_to_expr(ast, first),
                    ast,
                );
                for next_lit in lits.iter().skip(1) {
                    let next_neq = Expression::new_binary_expression(
                        SPAN,
                        Expression::new_identifier(SPAN, var_name, ast),
                        BinaryOperator::StrictInequality,
                        literal_value_to_expr(ast, next_lit),
                        ast,
                    );
                    test = Expression::new_logical_expression(
                        SPAN,
                        test,
                        LogicalOperator::And,
                        next_neq,
                        ast,
                    );
                }
                let msg = ast.allocator().alloc_str(&format!(
                    "Invalid argument '{}': value not in literal union",
                    label
                ));
                stmts.push(build_throw_type_error(ast, test, msg));
            }
        }
        ValidationSchema::Array(elem_schema) => {
            // 1. if (!Array.isArray(var)) throw ...
            let is_array_call = Expression::new_call_expression(
                SPAN,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, "Array", ast),
                    IdentifierName::new(SPAN, "isArray", ast),
                    false,
                    ast,
                ),
                None,
                {
                    let mut a = ArenaVec::new_in(ast);
                    a.push(Argument::from(Expression::new_identifier(
                        SPAN, var_name, ast,
                    )));
                    a
                },
                false,
                ast,
            );
            let not_arr = Expression::new_unary_expression(
                SPAN,
                UnaryOperator::LogicalNot,
                is_array_call,
                ast,
            );
            let msg = ast
                .allocator()
                .alloc_str(&format!("Invalid argument '{}': expected array", label));
            stmts.push(build_throw_type_error(ast, not_arr, msg));

            // 2. for (let __i_depth = 0; __i_depth < var.length; __i_depth++) { ... }
            let i_name = ast.allocator().alloc_str(&format!("__i_{}", depth));
            let elem_name = ast.allocator().alloc_str(&format!("__elem_{}", depth));

            let mut i_decls = ArenaVec::new_in(ast);
            i_decls.push(VariableDeclarator::new(
                SPAN,
                BindingPattern::new_binding_identifier(SPAN, i_name, ast),
                None,
                Some(Expression::new_numeric_literal(
                    SPAN,
                    0.0,
                    None,
                    NumberBase::Decimal,
                    ast,
                )),
                false,
                ast,
            ));
            let for_init = ForStatementInit::VariableDeclaration(VariableDeclaration::boxed(
                SPAN,
                VariableDeclarationKind::Let,
                i_decls,
                false,
                ast,
            ));
            let for_test = Expression::new_binary_expression(
                SPAN,
                Expression::new_identifier(SPAN, i_name, ast),
                BinaryOperator::LessThan,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, var_name, ast),
                    IdentifierName::new(SPAN, "length", ast),
                    false,
                    ast,
                ),
                ast,
            );
            let for_update = Expression::new_update_expression(
                SPAN,
                UpdateOperator::Increment,
                false,
                SimpleAssignmentTarget::new_assignment_target_identifier(SPAN, i_name, ast),
                ast,
            );

            let mut loop_stmts = ArenaVec::new_in(ast);

            // Sparse array / hole check: if (!(__i in var)) throw ...
            let in_test = Expression::new_binary_expression(
                SPAN,
                Expression::new_identifier(SPAN, i_name, ast),
                BinaryOperator::In,
                Expression::new_identifier(SPAN, var_name, ast),
                ast,
            );
            let not_in =
                Expression::new_unary_expression(SPAN, UnaryOperator::LogicalNot, in_test, ast);
            let hole_msg = ast.allocator().alloc_str(&format!(
                "Invalid argument '{}': sparse arrays with holes are not allowed",
                label
            ));
            loop_stmts.push(build_throw_type_error(ast, not_in, hole_msg));

            // const __elem_depth = var[__i_depth];
            let mut elem_decls = ArenaVec::new_in(ast);
            elem_decls.push(VariableDeclarator::new(
                SPAN,
                BindingPattern::new_binding_identifier(SPAN, elem_name, ast),
                None,
                Some(Expression::new_computed_member_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, var_name, ast),
                    Expression::new_identifier(SPAN, i_name, ast),
                    false,
                    ast,
                )),
                false,
                ast,
            ));
            loop_stmts.push(Statement::new_variable_declaration(
                SPAN,
                VariableDeclarationKind::Const,
                elem_decls,
                false,
                ast,
            ));

            // Validate __elem against elem_schema
            let elem_label = format!("{}[*]", label);
            let elem_checks =
                build_schema_check(ast, elem_name, &elem_label, elem_schema, false, depth + 1);
            for s in elem_checks {
                loop_stmts.push(s);
            }

            let loop_body = Statement::new_block_statement(SPAN, loop_stmts, ast);
            stmts.push(Statement::new_for_statement(
                SPAN,
                Some(for_init),
                Some(for_test),
                Some(for_update),
                loop_body,
                ast,
            ));
        }
        ValidationSchema::Object { properties, strict } => {
            // 1. if (typeof var !== "object" || var === null || Array.isArray(var)) throw ...
            let typeof_expr = Expression::new_unary_expression(
                SPAN,
                UnaryOperator::Typeof,
                Expression::new_identifier(SPAN, var_name, ast),
                ast,
            );
            let not_obj = Expression::new_binary_expression(
                SPAN,
                typeof_expr,
                BinaryOperator::StrictInequality,
                Expression::new_string_literal(SPAN, "object", None, ast),
                ast,
            );
            let is_null = Expression::new_binary_expression(
                SPAN,
                Expression::new_identifier(SPAN, var_name, ast),
                BinaryOperator::StrictEquality,
                Expression::new_null_literal(SPAN, ast),
                ast,
            );
            let is_arr = Expression::new_call_expression(
                SPAN,
                Expression::new_static_member_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, "Array", ast),
                    IdentifierName::new(SPAN, "isArray", ast),
                    false,
                    ast,
                ),
                None,
                {
                    let mut a = ArenaVec::new_in(ast);
                    a.push(Argument::from(Expression::new_identifier(
                        SPAN, var_name, ast,
                    )));
                    a
                },
                false,
                ast,
            );
            let not_plain_obj = Expression::new_logical_expression(
                SPAN,
                Expression::new_logical_expression(
                    SPAN,
                    not_obj,
                    LogicalOperator::Or,
                    is_null,
                    ast,
                ),
                LogicalOperator::Or,
                is_arr,
                ast,
            );
            let msg = ast.allocator().alloc_str(&format!(
                "Invalid argument '{}': expected plain object",
                label
            ));
            stmts.push(build_throw_type_error(ast, not_plain_obj, msg));

            // 2. Prototype pollution defense:
            // if (Object.prototype.hasOwnProperty.call(var, "__proto__") || Object.prototype.hasOwnProperty.call(var, "constructor") || Object.prototype.hasOwnProperty.call(var, "prototype"))
            let has_proto = build_has_own_call(ast, var_name, "__proto__");
            let has_constructor = build_has_own_call(ast, var_name, "constructor");
            let has_prototype = build_has_own_call(ast, var_name, "prototype");
            let proto_pollution = Expression::new_logical_expression(
                SPAN,
                Expression::new_logical_expression(
                    SPAN,
                    has_proto,
                    LogicalOperator::Or,
                    has_constructor,
                    ast,
                ),
                LogicalOperator::Or,
                has_prototype,
                ast,
            );
            let pollution_msg = ast.allocator().alloc_str("Prototype pollution rejected");
            stmts.push(build_throw_type_error(ast, proto_pollution, pollution_msg));

            // 3. Strict mode: reject extra unlisted keys
            if *strict {
                let keys_name = ast.allocator().alloc_str(&format!("__keys_{}", depth));
                let k_name = ast.allocator().alloc_str(&format!("__k_{}", depth));
                let key_item_name = ast.allocator().alloc_str(&format!("__key_{}", depth));

                // const __keys = Object.keys(var);
                let mut keys_decls = ArenaVec::new_in(ast);
                let obj_keys_call = Expression::new_call_expression(
                    SPAN,
                    Expression::new_static_member_expression(
                        SPAN,
                        Expression::new_identifier(SPAN, "Object", ast),
                        IdentifierName::new(SPAN, "keys", ast),
                        false,
                        ast,
                    ),
                    None,
                    {
                        let mut a = ArenaVec::new_in(ast);
                        a.push(Argument::from(Expression::new_identifier(
                            SPAN, var_name, ast,
                        )));
                        a
                    },
                    false,
                    ast,
                );
                keys_decls.push(VariableDeclarator::new(
                    SPAN,
                    BindingPattern::new_binding_identifier(SPAN, keys_name, ast),
                    None,
                    Some(obj_keys_call),
                    false,
                    ast,
                ));
                stmts.push(Statement::new_variable_declaration(
                    SPAN,
                    VariableDeclarationKind::Const,
                    keys_decls,
                    false,
                    ast,
                ));

                // for (let __k = 0; __k < __keys.length; __k++) { ... }
                let mut k_decls = ArenaVec::new_in(ast);
                k_decls.push(VariableDeclarator::new(
                    SPAN,
                    BindingPattern::new_binding_identifier(SPAN, k_name, ast),
                    None,
                    Some(Expression::new_numeric_literal(
                        SPAN,
                        0.0,
                        None,
                        NumberBase::Decimal,
                        ast,
                    )),
                    false,
                    ast,
                ));
                let for_init = ForStatementInit::VariableDeclaration(VariableDeclaration::boxed(
                    SPAN,
                    VariableDeclarationKind::Let,
                    k_decls,
                    false,
                    ast,
                ));
                let for_test = Expression::new_binary_expression(
                    SPAN,
                    Expression::new_identifier(SPAN, k_name, ast),
                    BinaryOperator::LessThan,
                    Expression::new_static_member_expression(
                        SPAN,
                        Expression::new_identifier(SPAN, keys_name, ast),
                        IdentifierName::new(SPAN, "length", ast),
                        false,
                        ast,
                    ),
                    ast,
                );
                let for_update = Expression::new_update_expression(
                    SPAN,
                    UpdateOperator::Increment,
                    false,
                    SimpleAssignmentTarget::new_assignment_target_identifier(SPAN, k_name, ast),
                    ast,
                );

                let mut loop_stmts = ArenaVec::new_in(ast);
                // const __key = __keys[__k];
                let mut key_decls = ArenaVec::new_in(ast);
                key_decls.push(VariableDeclarator::new(
                    SPAN,
                    BindingPattern::new_binding_identifier(SPAN, key_item_name, ast),
                    None,
                    Some(Expression::new_computed_member_expression(
                        SPAN,
                        Expression::new_identifier(SPAN, keys_name, ast),
                        Expression::new_identifier(SPAN, k_name, ast),
                        false,
                        ast,
                    )),
                    false,
                    ast,
                ));
                loop_stmts.push(Statement::new_variable_declaration(
                    SPAN,
                    VariableDeclarationKind::Const,
                    key_decls,
                    false,
                    ast,
                ));

                // if (__key !== "p1" && __key !== "p2" ...) throw ...
                let mut unallowed_test: Option<Expression<'a>> = None;
                for p in properties {
                    let neq = Expression::new_binary_expression(
                        SPAN,
                        Expression::new_identifier(SPAN, key_item_name, ast),
                        BinaryOperator::StrictInequality,
                        Expression::new_string_literal(
                            SPAN,
                            ast.allocator().alloc_str(&p.key),
                            None,
                            ast,
                        ),
                        ast,
                    );
                    unallowed_test = Some(match unallowed_test {
                        None => neq,
                        Some(prev) => Expression::new_logical_expression(
                            SPAN,
                            prev,
                            LogicalOperator::And,
                            neq,
                            ast,
                        ),
                    });
                }
                let unexpected_test = unallowed_test
                    .unwrap_or_else(|| Expression::new_boolean_literal(SPAN, true, ast));
                let unexpected_msg = ast.allocator().alloc_str(&format!(
                    "Invalid argument '{}': unexpected unlisted property",
                    label
                ));
                loop_stmts.push(build_throw_type_error(ast, unexpected_test, unexpected_msg));

                let loop_body = Statement::new_block_statement(SPAN, loop_stmts, ast);
                stmts.push(Statement::new_for_statement(
                    SPAN,
                    Some(for_init),
                    Some(for_test),
                    Some(for_update),
                    loop_body,
                    ast,
                ));
            }

            // 4. Nested property checks
            for prop in properties {
                let prop_name_id = ast.allocator().alloc_str(&prop.key);
                let prop_var_name = ast
                    .allocator()
                    .alloc_str(&format!("__prop_{}_{}", depth, prop.key));
                let prop_label = format!("{}.{}", label, prop.key);

                // const __prop_depth_key = var.key;
                let mut prop_decls = ArenaVec::new_in(ast);
                prop_decls.push(VariableDeclarator::new(
                    SPAN,
                    BindingPattern::new_binding_identifier(SPAN, prop_var_name, ast),
                    None,
                    Some(Expression::new_static_member_expression(
                        SPAN,
                        Expression::new_identifier(SPAN, var_name, ast),
                        IdentifierName::new(SPAN, prop_name_id, ast),
                        false,
                        ast,
                    )),
                    false,
                    ast,
                ));
                stmts.push(Statement::new_variable_declaration(
                    SPAN,
                    VariableDeclarationKind::Const,
                    prop_decls,
                    false,
                    ast,
                ));

                if !prop.optional {
                    // if (var.prop === undefined) throw ...
                    let is_undef = Expression::new_binary_expression(
                        SPAN,
                        Expression::new_identifier(SPAN, prop_var_name, ast),
                        BinaryOperator::StrictEquality,
                        Expression::new_identifier(SPAN, "undefined", ast),
                        ast,
                    );
                    let missing_msg = ast
                        .allocator()
                        .alloc_str(&format!("Missing required property '{}'", prop_label));
                    stmts.push(build_throw_type_error(ast, is_undef, missing_msg));

                    // Recursively validate prop.schema
                    let prop_checks = build_schema_check(
                        ast,
                        prop_var_name,
                        &prop_label,
                        &prop.schema,
                        false,
                        depth + 1,
                    );
                    for s in prop_checks {
                        stmts.push(s);
                    }
                } else {
                    // Recursively validate prop.schema if defined
                    let prop_checks = build_schema_check(
                        ast,
                        prop_var_name,
                        &prop_label,
                        &prop.schema,
                        true,
                        depth + 1,
                    );
                    for s in prop_checks {
                        stmts.push(s);
                    }
                }
            }
        }
        ValidationSchema::Optional(inner) => {
            return build_schema_check(ast, var_name, label, inner, true, depth);
        }
    }

    stmts
}

fn build_throw_type_error<'a>(
    ast: &AstBuilder<'a>,
    test: Expression<'a>,
    message: &'a str,
) -> Statement<'a> {
    let mut args = ArenaVec::new_in(ast);
    args.push(Argument::from(Expression::new_string_literal(
        SPAN, message, None, ast,
    )));
    let new_err = Expression::new_new_expression(
        SPAN,
        Expression::new_identifier(SPAN, "TypeError", ast),
        None,
        args,
        ast,
    );
    let throw_stmt = Statement::new_throw_statement(SPAN, new_err, ast);
    Statement::new_if_statement(SPAN, test, throw_stmt, None, ast)
}

fn build_has_own_call<'a>(
    ast: &AstBuilder<'a>,
    var_name: &'a str,
    prop_name: &'a str,
) -> Expression<'a> {
    // Object.prototype.hasOwnProperty.call(var, prop_name)
    let has_own_prop = Expression::new_static_member_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "Object", ast),
            IdentifierName::new(SPAN, "prototype", ast),
            false,
            ast,
        ),
        IdentifierName::new(SPAN, "hasOwnProperty", ast),
        false,
        ast,
    );
    let call_expr = Expression::new_static_member_expression(
        SPAN,
        has_own_prop,
        IdentifierName::new(SPAN, "call", ast),
        false,
        ast,
    );

    let mut args = ArenaVec::new_in(ast);
    args.push(Argument::from(Expression::new_identifier(
        SPAN, var_name, ast,
    )));
    args.push(Argument::from(Expression::new_string_literal(
        SPAN, prop_name, None, ast,
    )));

    Expression::new_call_expression(SPAN, call_expr, None, args, false, ast)
}

fn literal_value_to_expr<'a>(ast: &AstBuilder<'a>, lit: &LiteralValue) -> Expression<'a> {
    match lit {
        LiteralValue::String(s) => {
            Expression::new_string_literal(SPAN, ast.allocator().alloc_str(s), None, ast)
        }
        LiteralValue::Number(n) => {
            Expression::new_numeric_literal(SPAN, *n, None, NumberBase::Decimal, ast)
        }
        LiteralValue::Boolean(b) => Expression::new_boolean_literal(SPAN, *b, ast),
    }
}
