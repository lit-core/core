pub fn compute_fragment_hash(canonical_text: &str) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(canonical_text.as_bytes());
    let hex = hasher.finalize().to_hex();
    hex[..12].to_string()
}
