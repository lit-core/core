import { checkStateTypes } from '@lit-core/server-split';
import { reportTransformError } from './errors.js';

const SERVER_METHOD_FAST_CHECK = /@(?:loader|action)\b/;

/**
 * Fails the build (SE109) when a server element types a reactive property as something the JSON state
 * wire cannot carry, such as `Set<string>` or `Date`.
 *
 * Decorator lowering removes field type annotations, so this must run on the author's source. Both
 * the props-lowering plugin (which lowers first) and the server elements plugin call it; once the
 * annotations are gone it finds nothing, so the second call costs a parse and never reports twice.
 */
export function rejectNonJsonStateTypes(context: unknown, code: string, id: string): void {
  if (!SERVER_METHOD_FAST_CHECK.test(code)) return;
  const failure = checkStateTypes(code, id.replace(/^\0/, '')).find((diagnostic) => diagnostic.severity === 'error');
  if (failure) {
    reportTransformError(context as never, 'server-elements', id, new Error(`[${failure.code}] ${failure.message}`));
  }
}
