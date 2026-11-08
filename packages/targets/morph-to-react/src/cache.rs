use crate::{CompileOptionsDto, CompileResultDto};
use dashmap::DashMap;
use std::sync::OnceLock;

const MAX_CACHE_ENTRIES: usize = 2048;

fn compile_cache() -> &'static DashMap<String, CompileResultDto> {
    static COMPILE_CACHE: OnceLock<DashMap<String, CompileResultDto>> = OnceLock::new();
    COMPILE_CACHE.get_or_init(DashMap::new)
}

/// Computes a deterministic 64-character hex BLAKE3 content hash key
/// from the source code, file path, and relevant compiler options.
pub fn compute_cache_key(source: &str, file_path: &str, opts: &CompileOptionsDto) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"morph_to_react_cache_v1:");
    hasher.update(file_path.as_bytes());
    hasher.update(b"\0");
    hasher.update(source.as_bytes());
    hasher.update(b"\0");

    if let Some(suffix) = &opts.tag_suffix {
        hasher.update(b"tag_suffix:");
        hasher.update(suffix.as_bytes());
        hasher.update(b"\0");
    }
    if let Some(tier) = &opts.target_tier {
        hasher.update(b"target_tier:");
        hasher.update(tier.as_bytes());
        hasher.update(b"\0");
    }
    if let Some(emit_css) = opts.emit_css {
        hasher.update(if emit_css {
            b"emit_css:1\0"
        } else {
            b"emit_css:0\0"
        });
    }
    if let Some(emit_dts) = opts.emit_dts {
        hasher.update(if emit_dts {
            b"emit_dts:1\0"
        } else {
            b"emit_dts:0\0"
        });
    }
    if let Some(prefix) = &opts.strip_prefix {
        hasher.update(b"strip_prefix:");
        hasher.update(prefix.as_bytes());
        hasher.update(b"\0");
    }
    if let Some(prefix) = &opts.stylesheet_id_prefix {
        hasher.update(b"stylesheet_id_prefix:");
        hasher.update(prefix.as_bytes());
        hasher.update(b"\0");
    }
    if let Some(is_server) = opts.is_server {
        hasher.update(if is_server {
            b"is_server:1\0"
        } else {
            b"is_server:0\0"
        });
    }
    if let Some(tags) = &opts.known_tags {
        let mut sorted: Vec<(&String, &String)> = tags.iter().collect();
        sorted.sort_by_key(|(k, _)| *k);
        for (k, v) in sorted {
            hasher.update(b"known_tag:");
            hasher.update(k.as_bytes());
            hasher.update(b"=");
            hasher.update(v.as_bytes());
            hasher.update(b"\0");
        }
    }

    hasher.finalize().to_hex().to_string()
}

/// Retrieves a cached compilation result by its content-hashed key.
pub fn get_cached(key: &str) -> Option<CompileResultDto> {
    compile_cache().get(key).map(|entry| entry.value().clone())
}

/// Stores a compilation result in the global cache.
pub fn put_cached(key: String, result: CompileResultDto) {
    let cache = compile_cache();
    if cache.len() >= MAX_CACHE_ENTRIES {
        cache.clear();
    }
    cache.insert(key, result);
}

/// Clears the global compilation cache.
pub fn clear_cache() {
    compile_cache().clear();
}

/// Returns the current number of cached module compilations.
pub fn cache_size() -> usize {
    compile_cache().len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_hashing_and_retrieval() {
        clear_cache();
        assert_eq!(cache_size(), 0);

        let opts = CompileOptionsDto::default();
        let key1 = compute_cache_key("export class A {}", "a.ts", &opts);
        let key2 = compute_cache_key("export class A {}", "a.ts", &opts);
        assert_eq!(key1, key2);

        let key3 = compute_cache_key("export class B {}", "a.ts", &opts);
        assert_ne!(key1, key3);

        let dummy = CompileResultDto {
            code: "export function A() {}".to_string(),
            css: None,
            stylesheet_id: None,
            tier: "Tier0Pure".to_string(),
            component_name: "A".to_string(),
            tag_name: Some("my-a".to_string()),
            diagnostics: Vec::new(),
            dts: None,
        };

        put_cached(key1.clone(), dummy.clone());
        assert_eq!(cache_size(), 1);

        let retrieved = get_cached(&key1);
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().code, "export function A() {}");

        clear_cache();
        assert_eq!(cache_size(), 0);
        assert!(get_cached(&key1).is_none());
    }
}
