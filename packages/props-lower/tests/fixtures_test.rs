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

        // Verify genuine AST transformation per fixture rather than superficial diagnostics check
        match file_name {
            "carbon_button.js" => {
                assert!(
                    !result.code.contains("__decorate"),
                    "carbon_button.js must eliminate transpiled __decorate calls"
                );
                assert!(
                    result.code.contains("createProperty")
                        || result.code.contains("static properties"),
                    "carbon_button.js must lower properties to createProperty or static properties"
                );
                assert!(result.code.contains("disabled"));
                assert!(result.code.contains("kind"));
                assert!(result.code.contains("size"));
            }
            "spectrum_button.js" => {
                assert!(
                    !result.code.contains("@property"),
                    "spectrum_button.js must eliminate @property decorators"
                );
                assert!(
                    result.code.contains("static properties"),
                    "spectrum_button.js must synthesize static properties"
                );
                assert!(result.code.contains("emphasized"));
                assert!(result.code.contains("holdAffordance"));
            }
            "standard_lit_element.js" => {
                assert!(
                    !result.code.contains("@customElement"),
                    "standard_lit_element.js must eliminate @customElement decorator"
                );
                assert!(
                    !result.code.contains("@property"),
                    "standard_lit_element.js must eliminate @property decorator"
                );
                assert!(
                    !result.code.contains("@state"),
                    "standard_lit_element.js must eliminate @state decorator"
                );
                assert!(
                    result.code.contains("customElements.define"),
                    "standard_lit_element.js must emit customElements.define"
                );
                assert!(
                    result.code.contains("static properties"),
                    "standard_lit_element.js must synthesize static properties"
                );
            }
            _ => {}
        }

        count += 1;
    }

    assert!(count > 0, "At least one fixture must be tested");
}
