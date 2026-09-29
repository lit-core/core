import { DOM_PATHS_SOURCE } from '@lit-core/dom-paths';
import { NATIVE_RUNTIME_SOURCE } from '@lit-core/native';
import { RESUMABLE_ADAPTER_SOURCE } from '@lit-core/resumable';

export const VIRTUAL_LIT_CORE_MODULES: Record<string, string> = {
  'resumable-adapter': RESUMABLE_ADAPTER_SOURCE,
  resumable: RESUMABLE_ADAPTER_SOURCE,
  'native-runtime': NATIVE_RUNTIME_SOURCE,
  native: NATIVE_RUNTIME_SOURCE,
  reconciler: NATIVE_RUNTIME_SOURCE,
  'dom-paths': DOM_PATHS_SOURCE,
};

export function getVirtualLitCoreModule(subpath: string): string | undefined {
  const clean = subpath.replace(/\.[jt]s$/, '');
  return VIRTUAL_LIT_CORE_MODULES[clean];
}
