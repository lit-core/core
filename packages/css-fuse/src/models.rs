use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FuseConfig {
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
    pub files: Option<Vec<String>>,
    pub threshold: Option<u32>,
    pub output_dir: Option<String>,
    pub write: Option<bool>,
    pub virtual_imports: Option<bool>,
}

impl Default for FuseConfig {
    fn default() -> Self {
        Self {
            include: Some(vec!["packages/components/**/src/**/*.ts".to_string()]),
            exclude: Some(vec![
                "**/*.test.ts".to_string(),
                "**/*.spec.ts".to_string(),
                "**/node_modules/**".to_string(),
                "**/dist/**".to_string(),
            ]),
            files: None,
            threshold: Some(2),
            output_dir: Some(".fused".to_string()),
            write: Some(false),
            virtual_imports: Some(false),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceSpan {
    pub start: usize,
    pub end: usize,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedStyle {
    pub file_path: String,
    pub component_name: Option<String>,
    pub tag_name: Option<String>,
    pub css_text: String,
    pub span: SourceSpan,
    pub is_external_module: bool,
    pub export_name: Option<String>,
    pub location_kind: String, // "static_property", "static_property_array_element", "static_getter", "variable", "export_default", "standalone"
    pub parent_span: Option<SourceSpan>,
    pub tag_identifier: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RuleHash(pub String);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedRule {
    pub at_rule: Option<String>,
    pub selector: String,
    pub declarations: Vec<String>,
    pub canonical_body: String,
    pub full_canonical_css: String,
    pub hash: RuleHash,
    pub source_file: String,
    pub span: SourceSpan,
    pub is_keyframes_or_media: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterGroup {
    pub id: String,
    pub rules: Vec<NormalizedRule>,
    pub shared_by_files: Vec<String>,
    pub fused_sheet_name: String,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FusedSheetInfo {
    pub id: String,
    pub file_name: String,
    pub code: String,
    pub rules_count: u32,
    pub shared_by: Vec<String>,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewrittenFileInfo {
    pub file_path: String,
    pub original_code: String,
    pub transformed_code: String,
    pub fused_imports: Vec<String>,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub severity: String, // "error" | "warning" | "info"
    pub code: String,
    pub message: String,
    pub file_path: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FuseStats {
    pub files_scanned: u32,
    pub styles_extracted: u32,
    pub total_rules: u32,
    pub unique_rules: u32,
    pub rules_deduped: u32,
    pub fused_sheets_created: u32,
    pub components_rewritten: u32,
    pub bytes_saved: u32,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FuseResult {
    pub fused_sheets: Vec<FusedSheetInfo>,
    pub rewritten_files: Vec<RewrittenFileInfo>,
    pub diagnostics: Vec<Diagnostic>,
    pub stats: FuseStats,
}
