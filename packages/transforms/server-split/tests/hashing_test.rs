use server_split::compute_action_hash;
use server_split::options::ParamValidationMeta;

#[test]
fn test_action_hash_deterministic_and_16_hex() {
    let meta = vec![ParamValidationMeta {
        name: "name".to_string(),
        ts_type: "string".to_string(),
        optional: false,
    }];

    let hash1 = compute_action_hash("user-profile", "updateName", &meta);
    let hash2 = compute_action_hash("user-profile", "updateName", &meta);

    assert_eq!(hash1, hash2, "Action hash must be deterministic");
    assert_eq!(
        hash1.len(),
        16,
        "Action hash must be exactly 16 hex characters"
    );
    assert!(
        hash1.chars().all(|c| c.is_ascii_hexdigit()),
        "Action hash must be hex"
    );

    // Parameter renaming invariance (only ts_type and optionality matter)
    let meta2 = vec![ParamValidationMeta {
        name: "n".to_string(),
        ts_type: "string".to_string(),
        optional: false,
    }];

    let hash_renamed = compute_action_hash("user-profile", "updateName", &meta2);
    assert_eq!(
        hash1, hash_renamed,
        "Action hash must be invariant under parameter renaming"
    );

    let hash3 = compute_action_hash("user-profile", "deleteUser", &[]);
    assert_ne!(
        hash1, hash3,
        "Different actions must produce different hashes"
    );
}
