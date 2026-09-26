use std::collections::{HashMap, HashSet};
use crate::models::{NormalizedRule, RuleHash};

#[derive(Default)]
pub struct FrequencyIndex {
  /// (at_rule, selector, declaration) -> Set of source files
  pub decl_occurrences: HashMap<(Option<String>, String, String), HashSet<String>>,
  /// Keyframes / whole rules: hash -> (NormalizedRule, Set of source files)
  pub whole_rules: HashMap<RuleHash, (NormalizedRule, HashSet<String>)>,
  /// Map of all rule hashes for stats
  pub rule_map: HashMap<RuleHash, NormalizedRule>,
}

impl FrequencyIndex {
  pub fn new() -> Self {
    Self::default()
  }

  pub fn index_rules(&mut self, rules: &[NormalizedRule]) {
    for rule in rules {
      self
        .rule_map
        .entry(rule.hash.clone())
        .or_insert_with(|| rule.clone());

      if rule.is_keyframes_or_media && rule.selector.starts_with("@keyframes") {
        let entry = self
          .whole_rules
          .entry(rule.hash.clone())
          .or_insert_with(|| (rule.clone(), HashSet::new()));
        entry.1.insert(rule.source_file.clone());
      } else {
        for decl in &rule.declarations {
          let key = (rule.at_rule.clone(), rule.selector.clone(), decl.clone());
          self
            .decl_occurrences
            .entry(key)
            .or_default()
            .insert(rule.source_file.clone());
        }
      }
    }
  }
}
