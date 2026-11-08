use globset::{Glob, GlobSetBuilder};
use oxc_resolver::{ResolveOptions, Resolver};
use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

fn shared_resolver() -> &'static Resolver {
    static RESOLVER: OnceLock<Resolver> = OnceLock::new();
    RESOLVER.get_or_init(|| {
        Resolver::new(ResolveOptions {
            extensions: vec![
                ".ts".into(),
                ".tsx".into(),
                ".js".into(),
                ".jsx".into(),
                ".mjs".into(),
                ".cjs".into(),
            ],
            extension_alias: vec![
                (
                    ".js".into(),
                    vec![".ts".into(), ".tsx".into(), ".js".into(), ".jsx".into()],
                ),
                (".mjs".into(), vec![".mts".into(), ".mjs".into()]),
                (".cjs".into(), vec![".cts".into(), ".cjs".into()]),
            ],
            main_files: vec!["index".into()],
            symlinks: false,
            ..ResolveOptions::default()
        })
    })
}

/// Normalizes a filesystem path by collapsing `.` and `..` components without requiring the path to exist on disk.
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

/// Resolves a relative import specifier from a base source file using `oxc_resolver`,
/// preserving relative path formatting when `base_file` is relative.
pub fn resolve_relative_import(base_file: &str, import_specifier: &str) -> Option<PathBuf> {
    if !import_specifier.starts_with('.') {
        return None;
    }

    let base_path = Path::new(base_file);
    let base_dir = base_path.parent()?;
    let cwd = std::env::current_dir().ok()?;
    let abs_base_dir = if base_dir.is_absolute() {
        normalize_path(base_dir)
    } else {
        normalize_path(&cwd.join(base_dir))
    };

    if let Ok(resolution) = shared_resolver().resolve(&abs_base_dir, import_specifier) {
        let resolved_abs = normalize_path(resolution.path());
        if base_path.is_relative()
            && let Some(rel) = pathdiff::diff_paths(&resolved_abs, normalize_path(&cwd))
        {
            return Some(normalize_path(&rel));
        }
        return Some(resolved_abs);
    }

    None
}

/// Resolves input source files from explicit file lists or include/exclude glob patterns using `globset` and `glob`.
pub fn resolve_project_files(
    explicit_files: Option<&[String]>,
    include: Option<&[String]>,
    exclude: Option<&[String]>,
    normalize_entries: bool,
) -> Vec<String> {
    if let Some(explicit) = explicit_files {
        let mut files: Vec<String> = explicit
            .iter()
            .map(|f| {
                if normalize_entries {
                    normalize_path(Path::new(f)).to_string_lossy().to_string()
                } else {
                    f.clone()
                }
            })
            .collect();
        files.sort();
        files.dedup();
        return files;
    }

    let default_includes = [
        "packages/components/**/src/**/*.ts".to_string(),
        "src/**/*.ts".to_string(),
    ];
    let includes = include.unwrap_or(&default_includes);

    let mut default_excludes = vec![
        "**/*.test.ts".to_string(),
        "**/*.spec.ts".to_string(),
        "**/*.test.js".to_string(),
        "**/*.spec.js".to_string(),
    ];
    if !includes.iter().any(|p| p.contains("node_modules")) {
        default_excludes.push("**/node_modules/**".to_string());
    }
    if !includes
        .iter()
        .any(|p| p.contains("/dist/") || p.contains("dist/**"))
    {
        default_excludes.push("**/dist/**".to_string());
    }
    let excludes = exclude.unwrap_or(&default_excludes);

    let mut exclude_builder = GlobSetBuilder::new();
    let mut fallback_substrings = Vec::new();
    for exc in excludes {
        if let Ok(g) = Glob::new(exc) {
            exclude_builder.add(g);
        } else {
            fallback_substrings.push(exc.as_str());
        }
    }
    let exclude_set = exclude_builder.build().ok();

    let mut matched_files: BTreeSet<String> = BTreeSet::new();

    for pattern in includes {
        if let Ok(entries) = glob::glob(pattern) {
            for entry in entries.flatten() {
                if !entry.is_file() {
                    continue;
                }
                let path_str = if normalize_entries {
                    normalize_path(&entry).to_string_lossy().to_string()
                } else {
                    entry.to_string_lossy().to_string()
                };

                let is_excluded = exclude_set
                    .as_ref()
                    .is_some_and(|set| set.is_match(&path_str))
                    || fallback_substrings.iter().any(|sub| path_str.contains(sub));

                if !is_excluded {
                    matched_files.insert(path_str);
                }
            }
        }
    }

    matched_files.into_iter().collect()
}
