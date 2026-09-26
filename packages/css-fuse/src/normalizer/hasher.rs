use blake3::Hasher;
use crate::models::RuleHash;

pub fn compute_rule_hash(selector: &str, canonical_body: &str) -> RuleHash {
  let mut hasher = Hasher::new();
  hasher.update(selector.trim().as_bytes());
  hasher.update(b"\0");
  hasher.update(canonical_body.trim().as_bytes());
  let hash_bytes = hasher.finalize();
  RuleHash(hash_bytes.to_hex()[..16].to_string())
}

pub fn compute_cluster_hash(rule_hashes: &[RuleHash]) -> String {
  let mut hasher = Hasher::new();
  let mut sorted_hashes: Vec<String> = rule_hashes.iter().map(|h| h.0.clone()).collect();
  sorted_hashes.sort();
  for h in sorted_hashes {
    hasher.update(h.as_bytes());
    hasher.update(b"\n");
  }
  hasher.finalize().to_hex()[..8].to_string()
}
