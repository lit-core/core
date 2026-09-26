pub mod canonicalize;
pub mod hasher;

pub use canonicalize::{normalize_css, subtract_rules_from_css};
pub use hasher::{compute_cluster_hash, compute_rule_hash};
