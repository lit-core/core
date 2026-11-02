use crate::options::ParamValidationMeta;

/// Computes a minification-safe, deterministic 16-hex BLAKE3 identity hash for an action endpoint.
/// Decoupled from method body AST: hashes canonical (tagName, methodName, normalizedParamSchemas).
pub fn compute_action_hash(
    tag_name: &str,
    action_name: &str,
    params: &[ParamValidationMeta],
) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"lit-action:v3:");
    hasher.update(tag_name.trim().as_bytes());
    hasher.update(b":");
    hasher.update(action_name.trim().as_bytes());
    hasher.update(b":");

    for (i, p) in params.iter().enumerate() {
        hasher.update(format!("p{}:", i).as_bytes());
        hasher.update(p.ts_type.trim().as_bytes());
        hasher.update(b":");
        hasher.update(if p.optional { b"opt;" } else { b"req;" });
    }

    let full_hex = hasher.finalize().to_hex();
    full_hex[0..16].to_string()
}

/// Computes a deterministic 16-hex BLAKE3 hash for template quasis.
pub fn compute_template_id(quasis: &[&str]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"lit-template:v2:");
    hasher.update(&(quasis.len() as u32).to_le_bytes());
    for q in quasis {
        hasher.update(&(q.len() as u32).to_le_bytes());
        hasher.update(q.as_bytes());
    }
    let hex = hasher.finalize().to_hex();
    hex[..16].to_string()
}
