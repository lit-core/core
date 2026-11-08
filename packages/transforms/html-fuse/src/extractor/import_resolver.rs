pub use lit_analysis::symbol::SymbolProofContext;

pub fn is_canonical_lit_specifier(src: &str) -> bool {
    SymbolProofContext::is_canonical_lit_specifier(src)
}
