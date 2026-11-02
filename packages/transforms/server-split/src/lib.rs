pub mod client_builder;
pub mod dependency;
pub mod diagnostics;
pub mod hashing;
pub mod isolation;
pub mod options;
pub mod symbol;
pub mod transform;
pub mod validator;
pub mod worker_builder;
pub mod worker_entry;

pub use crate::hashing::{compute_action_hash, compute_template_id};
pub use crate::options::*;
pub use crate::transform::transform_code;
pub use crate::worker_entry::{
    WorkerEntryAction, WorkerEntryElement, WorkerEntryOptions, build_worker_entry_code,
};
use napi_derive::napi;

#[napi]
pub fn split_server_element(
    source: String,
    options: Option<ServerSplitOptions>,
) -> ServerSplitResult {
    transform_code(&source, options.unwrap_or_default())
}

#[napi]
pub fn compile_worker_entry(options: Option<WorkerEntryOptions>) -> String {
    build_worker_entry_code(options.unwrap_or_default())
}
