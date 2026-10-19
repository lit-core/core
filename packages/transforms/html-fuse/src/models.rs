use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HtmlFuseConfig {
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
    pub files: Option<Vec<String>>,
    pub threshold: Option<u32>,
    pub output_dir: Option<String>,
    pub write: Option<bool>,
    pub virtual_imports: Option<bool>,
    pub min_savings: Option<u32>,
    pub min_fragment_length: Option<u32>,
}

impl Default for HtmlFuseConfig {
    fn default() -> Self {
        Self {
            include: Some(vec![
                "packages/components/**/src/**/*.ts".to_string(),
                "src/**/*.ts".to_string(),
            ]),
            exclude: Some(vec![
                "**/*.test.ts".to_string(),
                "**/*.spec.ts".to_string(),
                "**/*.test.js".to_string(),
                "**/*.spec.js".to_string(),
                "**/node_modules/**".to_string(),
                "**/dist/**".to_string(),
            ]),
            files: None,
            threshold: Some(2),
            output_dir: Some(".fused-html".to_string()),
            write: Some(false),
            virtual_imports: Some(true),
            min_savings: None,
            min_fragment_length: Some(15),
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
pub struct ExtractedFragment {
    pub file_path: String,
    pub raw_text: String,
    pub canonical_text: String,
    pub is_svg: bool,
    pub is_full_template: bool,
    pub span: SourceSpan,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HtmlClusterGroup {
    pub id: String,
    pub canonical_text: String,
    pub is_svg: bool,
    pub shared_by_files: Vec<String>,
    pub occurrences_count: usize,
    pub file_name: String,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FusedTemplateInfo {
    pub id: String,
    pub file_name: String,
    pub code: String,
    pub kind: String, // "html" | "svg"
    pub raw_template: String,
    pub shared_by: Vec<String>,
    pub occurrences_count: u32,
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
pub struct HtmlFuseStats {
    pub files_scanned: u32,
    pub templates_scanned: u32,
    pub fragments_extracted: u32,
    pub unique_fragments: u32,
    pub fragments_deduped: u32,
    pub fused_templates_created: u32,
    pub components_rewritten: u32,
    pub bytes_saved: u32,
}

#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HtmlFuseResult {
    pub fused_templates: Vec<FusedTemplateInfo>,
    pub rewritten_files: Vec<RewrittenFileInfo>,
    pub diagnostics: Vec<Diagnostic>,
    pub stats: HtmlFuseStats,
}
