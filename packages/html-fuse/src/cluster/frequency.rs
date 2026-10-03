use crate::models::ExtractedFragment;
use std::collections::{HashMap, HashSet};

pub struct FragmentOccurrences {
    pub sample_fragment: ExtractedFragment,
    pub files: HashSet<String>,
    pub total_occurrences: usize,
}

pub struct FragmentFrequencyIndex {
    pub fragments: HashMap<String, FragmentOccurrences>, // hash -> occurrences
}

impl Default for FragmentFrequencyIndex {
    fn default() -> Self {
        Self::new()
    }
}

impl FragmentFrequencyIndex {
    pub fn new() -> Self {
        Self {
            fragments: HashMap::new(),
        }
    }

    pub fn index_fragments(&mut self, fragments: &[ExtractedFragment]) {
        for frag in fragments {
            let entry =
                self.fragments
                    .entry(frag.hash.clone())
                    .or_insert_with(|| FragmentOccurrences {
                        sample_fragment: frag.clone(),
                        files: HashSet::new(),
                        total_occurrences: 0,
                    });

            entry.files.insert(frag.file_path.clone());
            entry.total_occurrences += 1;
        }
    }
}
