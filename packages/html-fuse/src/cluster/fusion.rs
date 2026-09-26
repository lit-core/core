use crate::cluster::frequency::FragmentFrequencyIndex;
use crate::models::HtmlClusterGroup;

pub struct HtmlClusterEngine;

impl HtmlClusterEngine {
    pub fn cluster(
        frequency_index: &FragmentFrequencyIndex,
        threshold: usize,
        min_savings: usize,
    ) -> Vec<HtmlClusterGroup> {
        let mut clusters = Vec::new();

        for (hash, occ) in &frequency_index.fragments {
            if occ.files.len() >= threshold {
                let text_len = occ.sample_fragment.canonical_text.len();
                let net_savings = (occ.files.len().saturating_sub(1)) * text_len;

                if net_savings >= min_savings {
                    let mut sorted_files: Vec<String> = occ.files.iter().cloned().collect();
                    sorted_files.sort();

                    let prefix = if occ.sample_fragment.is_svg {
                        "_fused_svg"
                    } else {
                        "_fused_html"
                    };

                    let cluster_id = format!("{}_{}", prefix, hash);

                    clusters.push(HtmlClusterGroup {
                        id: cluster_id.clone(),
                        canonical_text: occ.sample_fragment.canonical_text.clone(),
                        is_svg: occ.sample_fragment.is_svg,
                        shared_by_files: sorted_files,
                        occurrences_count: occ.total_occurrences,
                        file_name: format!("{}.js", cluster_id),
                    });
                }
            }
        }

        // Sort candidates by length descending so larger parent subtrees are prioritized
        clusters.sort_by(|a, b| b.canonical_text.len().cmp(&a.canonical_text.len()));

        let mut non_subsumed = Vec::new();
        for candidate in clusters {
            let is_subsumed = non_subsumed.iter().any(|parent: &HtmlClusterGroup| {
                parent.canonical_text.contains(&candidate.canonical_text)
                    && candidate.occurrences_count <= parent.occurrences_count
                    && candidate.shared_by_files.iter().all(|f| parent.shared_by_files.contains(f))
            });

            if !is_subsumed {
                non_subsumed.push(candidate);
            }
        }

        // Sort clusters deterministically by ID
        non_subsumed.sort_by(|a, b| a.id.cmp(&b.id));
        non_subsumed
    }
}
