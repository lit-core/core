# Protected file change authorizations

This ledger authorizes necessary modifications to protected paths under milestone execution. Unsigned modifications will trigger integrity check failures in `scripts/check/integrity.mjs`.

### Entry 1: Server elements golden acceptance test
- **File**: `packages/internal/tests/src/suites/server-elements-e2e.test.ts`
- **Authorized by**: teamwork_preview_orchestrator_6
- **Status**: approved
- **Sha256**: 29f864817bf6aa7844b505670660fe0c733c963152abb2ee97c3150357f794be
- **Reason**: Milestone M0 golden end-to-end acceptance test authored to establish failing baseline.

### Entry 2: Edge benchmarks cleanup
- **File**: `packages/internal/tests/src/suites/edge-benchmarks.test.ts`
- **Authorized by**: teamwork_preview_orchestrator_6
- **Status**: approved
- **Sha256**: ea4e0f6e71afe3ac6919af9cf40b41b6dfa46ba2e3abdc036f7032704a915e64
- **Reason**: Milestone M0/M3 removal of hand-written `static __litParts`, fake marker fixtures, and Node.js-conflated Cloudflare 10ms assertion.

### Entry 3: DSD soundness property test cleanup
- **File**: `packages/transforms/dom-paths/tests/dsd_soundness_property.test.ts`
- **Authorized by**: teamwork_preview_orchestrator_6
- **Status**: approved
- **Sha256**: 5d8534bc4b529195224e3099fbfcf041aa955281ad251bb06ba6e5f66a1806aa
- **Reason**: Milestone M0 preparation for sound minimal-marker part addressing.

### Entry 4: Repository check runner
- **File**: `scripts/check/index.mjs`
- **Authorized by**: teamwork_preview_orchestrator_6
- **Status**: approved
- **Sha256**: e334835eb6e30e900925f44c2de5ca9bebba02365eb64e5aff78d57994bd6577
- **Reason**: Milestone M0/S10 integration of unconditional Tier 0 repository integrity check and Tier 1 cargo clippy disallowed-types rules.

### Entry 5: Repository integrity verification script
- **File**: `scripts/check/integrity.mjs`
- **Authorized by**: teamwork_preview_orchestrator_6
- **Status**: approved
- **Sha256**: f4ce94d7ef3daf8c189d3b86daca0f4cd9a87bf0a1da7d1c289b3749df0ea06b
- **Reason**: Slimmed guardrail script enforcing protected paths, Biome configuration hashes, and biome-ignore anti-suppression checks after migrating static analysis to Biome and GritQL.

### Entry 6: Affected packages calculation script
- **File**: `scripts/check/affected.mjs`
- **Authorized by**: teamwork_preview_orchestrator_6
- **Status**: approved
- **Sha256**: 3260d1cdd41c8c73ee9a1f93c7a3e0acabf3c5bab5405b1324a12a26d41a2e65
- **Reason**: Check runner dependency updates for workspace package resolution.

### Entry 7: Native binary freshness checker
- **File**: `scripts/check/native-fresh.mjs`
- **Authorized by**: teamwork_preview_orchestrator_6
- **Status**: approved
- **Sha256**: ac5fbf6c45f451525a482759d10b92e401b88a9741dd149bc29dbce67264cc5c
- **Reason**: Check runner dependency updates for verifying fresh native .node addons.

### Entry 8: Monorepo architectural guidelines
- **File**: `AGENTS.md`
- **Authorized by**: teamwork_preview_orchestrator_6
- **Status**: approved
- **Sha256**: d4fe8930430639b72e481b78dca3b460ee00d7c9c867edcfc648b1951a13fd0d
- **Reason**: Invariant updates enforcing general-purpose neutrality, anti-gaming, and server elements integrity.

### Entry 9: Transform principles skill documentation
- **File**: `.agents/skills/transform-principles/SKILL.md`
- **Authorized by**: teamwork_preview_orchestrator_6
- **Status**: approved
- **Sha256**: 0d7309c909e244228a485341ee42dd4c23ac180152bb120221fec04bf738cc80
- **Reason**: Skill updates detailing AST codegen invariants and server element architectural boundaries.

### Entry 10: Biome configuration and architectural overrides
- **File**: `biome.json`
- **Authorized by**: user_approved_biome_migration
- **Status**: approved
- **Sha256**: 3cdd37278c4a9fbc9babff59799f462d17bf3c4157977fb365fd5be63d8196d8
- **Reason**: Generalized multi-package architectural lint overrides and GritQL plugin bindings.

### Entry 11: Workspace Clippy disallowed types configuration
- **File**: `clippy.toml`
- **Authorized by**: user_approved_biome_migration
- **Status**: approved
- **Sha256**: e25f5cd8175beffdd4c3e80850635ae33fd1eb82f0c8586d12118a421206bc16
- **Reason**: Workspace Clippy guardrail banning std::backtrace::Backtrace call-stack inspection in Rust crates.

### Entry 12: GritQL benchmark literal HTML rule
- **File**: `scripts/biome-plugins/no-benchmark-literal-html.grit`
- **Authorized by**: user_approved_biome_migration
- **Status**: approved
- **Sha256**: b0186c1eab978a1e5244cc011e86f1955db5580db7660bc886727437a2f27ac3
- **Reason**: AST lint plugin banning hardcoded Declarative Shadow DOM and marker literals in benchmark runners.

### Entry 13: GritQL benchmark Math.max clamping rule
- **File**: `scripts/biome-plugins/no-benchmark-math-max.grit`
- **Authorized by**: user_approved_biome_migration
- **Status**: approved
- **Sha256**: b069488824c931038f3bf80f0d662346a62aa21ed544cbf7033412febfa17e29
- **Reason**: AST lint plugin banning Math.max clamping in benchmark feature and scenario runners.

### Entry 14: GritQL global and prototype mutation rule
- **File**: `scripts/biome-plugins/no-global-or-proto-mutation.grit`
- **Authorized by**: user_approved_biome_migration
- **Status**: approved
- **Sha256**: 6cf0dd4139ff161b84b62864711882a08973e0c3116ffe52ac95a2069d514cbd
- **Reason**: Generalized AST lint plugin banning prototype and globalThis.document mutations across production packages.

### Entry 15: GritQL handwritten compiler part table rule
- **File**: `scripts/biome-plugins/no-handwritten-compiler-parts.grit`
- **Authorized by**: user_approved_biome_migration
- **Status**: approved
- **Sha256**: 1c080590f30e8602396a2f207ec9fd99caeae5a523eb8d3985d39ebcd71f4907
- **Reason**: AST lint plugin banning hand-authored __litParts tables and <?start fixtures outside unit tests.

### Entry 16: GritQL HTML character and regex scanner rule
- **File**: `scripts/biome-plugins/no-html-char-scanner.grit`
- **Authorized by**: user_approved_biome_migration
- **Status**: approved
- **Sha256**: b23fa22e999be4586ed17c5fd2a0239eb456406fb7083442d4c561bdd6c4013b
- **Reason**: Generalized AST lint plugin banning ad-hoc HTML character loops and tag regex scanners across runtime and compiler packages.

### Entry 17: GritQL library shim and test simulator rule
- **File**: `scripts/biome-plugins/no-library-shims.grit`
- **Authorized by**: user_approved_biome_migration
- **Status**: approved
- **Sha256**: 2eee1810f8a2cf01abdb3615b0b06c899b2a89c8a9d8ebdb0fb8126d06c6403a
- **Reason**: Generalized AST lint plugin banning library-specific runtime shims and test simulators in production packages.

### Entry 18: GritQL call-stack inspection rule
- **File**: `scripts/biome-plugins/no-stack-inspection.grit`
- **Authorized by**: user_approved_biome_migration
- **Status**: approved
- **Sha256**: 01b12136d834a5d87977391e1e2cdaa0ca30fa79ed1583146ad110a374c87cb1
- **Reason**: AST lint plugin banning Error.stack inspection and test-name branching in production packages.

### Entry 19: GritQL unbranded duck-typing rule
- **File**: `scripts/biome-plugins/no-unbranded-duck-typing.grit`
- **Authorized by**: user_approved_biome_migration
- **Status**: approved
- **Sha256**: e8f5021dd23767865d05c421cbc667900a0be6b55bfe9ac94b5f8a900c1c8b97
- **Reason**: Generalized AST lint plugin banning unbranded 'in' duck-typing for raw markup and runtime descriptors.
