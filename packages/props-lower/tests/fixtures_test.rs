use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use props_lower::transform_lit_props;
use std::fs;
use std::path::Path;

#[test]
fn test_all_fixtures_transform_to_valid_ast() {
    let fixtures_dir = Path::new("tests/fixtures");
    assert!(fixtures_dir.exists(), "fixtures dir must exist");

    let mut count = 0;
    for entry in fs::read_dir(fixtures_dir).expect("read dir") {
        let entry = entry.expect("valid entry");
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("js") {
            continue;
        }

        let file_name = path.file_name().unwrap().to_str().unwrap();
        let source = fs::read_to_string(&path).expect("read fixture file");

        let result = transform_lit_props(source, None);
        assert!(
            !result.code.is_empty(),
            "Fixture {} should produce non-empty transformed code",
            file_name
        );

        // Verify AST syntax validity: transformed output MUST be syntactically valid JS/TS
        let allocator = Allocator::default();
        let source_type = SourceType::mjs();
        let parsed = Parser::new(&allocator, &result.code, source_type).parse();
        assert!(
            parsed.diagnostics.is_empty(),
            "Fixture {} generated invalid AST: {:?}",
            file_name,
            parsed.diagnostics
        );

        count += 1;
    }

    assert!(count > 0, "At least one fixture must be tested");
}
