use std::path::{Component, Path, PathBuf};

pub fn normalize_path(path: &Path) -> PathBuf {
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if let Some(Component::Normal(_)) = components.last() {
                    components.pop();
                } else {
                    components.push(component);
                }
            }
            _ => components.push(component),
        }
    }
    components.into_iter().collect()
}

pub fn resolve_relative_import(base_file: &str, import_specifier: &str) -> Option<PathBuf> {
    if !import_specifier.starts_with('.') {
        return None; // External package import, skip
    }

    let base_dir = Path::new(base_file).parent()?;
    let direct_path = normalize_path(&base_dir.join(import_specifier));

    // If path ends with .js, check if corresponding .ts exists
    if import_specifier.ends_with(".js") {
        let ts_specifier = import_specifier.trim_end_matches(".js").to_string() + ".ts";
        let ts_path = normalize_path(&base_dir.join(&ts_specifier));
        if ts_path.exists() && ts_path.is_file() {
            return Some(ts_path);
        }
    }

    if direct_path.exists() && direct_path.is_file() {
        return Some(direct_path);
    }

    // Try appending .ts, .js, .tsx, .jsx
    for ext in &[".ts", ".js", ".tsx", ".jsx"] {
        let candidate = normalize_path(&base_dir.join(format!("{}{}", import_specifier, ext)));
        if candidate.exists() && candidate.is_file() {
            return Some(candidate);
        }
    }

    // Try index files
    for ext in &["index.ts", "index.js"] {
        let candidate = normalize_path(&direct_path.join(ext));
        if candidate.exists() && candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}
