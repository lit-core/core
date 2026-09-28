/**
 * Standard terminal / console reporting utility for benchmarks.
 */

/**
 * Print benchmark start banner.
 * @param {string} title
 * @param {string} [subtitle]
 */
export function printBenchmarkHeader(title, subtitle = '') {
  console.log('\n========================================================================================');
  console.log(`⚡ LIT-CORE BENCHMARK: ${title.toUpperCase()}`);
  console.log('========================================================================================');
  if (subtitle) {
    console.log(`${subtitle}\n`);
  }
}

/**
 * Print completion summary with location of persisted artifacts.
 * @param {string} title
 * @param {Object} artifacts
 * @param {string} [artifacts.jsonPath]
 * @param {string} [artifacts.docPath]
 */
export function printBenchmarkFooter(title, artifacts = {}) {
  console.log('\n========================================================================================');
  console.log(`✓ ${title} BENCHMARK COMPLETE`);
  console.log('========================================================================================');
  if (artifacts.jsonPath) {
    console.log(`  • JSON artifact: ${artifacts.jsonPath}`);
  }
  if (artifacts.docPath) {
    console.log(`  • Documentation: ${artifacts.docPath}`);
  }
  console.log('');
}
