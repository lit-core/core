pub use lit_analysis::html_collapse::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_collapse_simple_tags() {
        let input = vec!["\n  <div>\n    <span>Hello</span>\n  </div>\n"];
        let output = collapse_template_quasis(&input);
        assert_eq!(output[0], "<div><span>Hello</span></div>");
    }

    #[test]
    fn test_collapse_strip_comments() {
        let input =
            vec!["\n  <div>\n    <!-- Remove this comment -->\n    <p>Test</p>\n  </div>\n"];
        let output = collapse_template_quasis(&input);
        assert_eq!(output[0], "<div><p>Test</p></div>");
    }

    #[test]
    fn test_collapse_tag_attributes() {
        let input = vec![
            "\n  <button\n    class=\"btn\"\n    type=\"button\"\n    disabled\n  >\n    Click\n  </button>\n",
        ];
        let output = collapse_template_quasis(&input);
        assert_eq!(
            output[0],
            "<button class=\"btn\" type=\"button\" disabled> Click</button>"
        );
    }

    #[test]
    fn test_preserve_pre_code_textarea() {
        let input = vec![
            "\n  <div>\n    <pre>\n      line 1\n      line 2\n    </pre>\n    <code>  let x = 1;  </code>\n    <textarea>\n      text here\n    </textarea>\n  </div>\n",
        ];
        let output = collapse_template_quasis(&input);
        assert!(output[0].contains("<pre>\n      line 1\n      line 2\n    </pre>"));
        assert!(output[0].contains("<code>  let x = 1;  </code>"));
        assert!(output[0].contains("<textarea>\n      text here\n    </textarea>"));
        assert!(!output[0].starts_with("\n"));
    }

    #[test]
    fn test_svg_collapse() {
        let input = vec![
            "\n  <svg viewBox=\"0 0 100 100\">\n    <circle cx=\"50\" cy=\"50\" r=\"40\" />\n    <path d=\"M0 0\" />\n  </svg>\n",
        ];
        let output = collapse_template_quasis(&input);
        assert_eq!(
            output[0],
            "<svg viewBox=\"0 0 100 100\"><circle cx=\"50\" cy=\"50\" r=\"40\"/><path d=\"M0 0\"/></svg>"
        );
    }

    #[test]
    fn test_expression_holes_preserved() {
        let input = vec![
            "\n  <div class=\"",
            "\">\n    <span>",
            "</span>\n  </div>\n",
        ];
        let output = collapse_template_quasis(&input);
        assert_eq!(output[0], "<div class=\"");
        assert_eq!(output[1], "\"><span>");
        assert_eq!(output[2], "</span></div>");
    }

    #[test]
    fn test_preserve_across_holes() {
        let input = vec!["<pre>  ", "  </pre>"];
        let output = collapse_template_quasis(&input);
        assert_eq!(output[0], "<pre>  ");
        assert_eq!(output[1], "  </pre>");
    }

    #[test]
    fn test_dynamic_tag_with_attributes() {
        let input = vec!["\n  <", "\n    part=\"btn\"\n    class=", "\n  ></", ">\n"];
        let output = collapse_template_quasis(&input);
        assert_eq!(output[0], "<");
        assert_eq!(output[1], " part=\"btn\" class=");
        assert_eq!(output[2], "></");
        assert_eq!(output[3], ">");
    }

    #[test]
    fn test_dynamic_tag_self_contained() {
        let input = vec!["<", ">", "</", ">"];
        let output = collapse_template_quasis(&input);
        assert_eq!(output[0], "<");
        assert_eq!(output[1], ">");
        assert_eq!(output[2], "</");
        assert_eq!(output[3], ">");
    }

    #[test]
    fn test_ambiguous_context_bailout() {
        let input_comment = vec!["<div><!-- unclosed comment \n  <span>test</span>"];
        let output_comment = collapse_template_quasis(&input_comment);
        assert_eq!(output_comment[0], input_comment[0]);

        let input_quote = vec!["<div class=\"unclosed string \n  here>"];
        let output_quote = collapse_template_quasis(&input_quote);
        assert_eq!(output_quote[0], input_quote[0]);
    }
}
