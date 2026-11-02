/**
 * Self-contained in-memory ESM source for `virtual:lit-core/hydrate-support`
 * (and its alias `virtual:lit-core/resumable-adapter`).
 *
 * Built directly from the compiled standalone ES2022 `hydrate-core.js` module so
 * `@lit-core/resumable/client` and `virtual:lit-core/hydrate-support` execute the
 * exact same runtime with zero duplicated source code.
 */

function loadHydrateCoreSource(): string {
  const proc = (globalThis as any).process;
  const fs = proc?.getBuiltinModule?.('node:fs');
  const urlMod = proc?.getBuiltinModule?.('node:url');
  if (!fs || !urlMod?.fileURLToPath) {
    throw new Error('[@lit-core/resumable] Node fs/url builtin modules are required to load virtual:lit-core/hydrate-support at build time.');
  }

  const candidates = [new URL('./client/hydrate-core.js', import.meta.url), new URL('../lib/client/hydrate-core.js', import.meta.url)];
  for (const candidate of candidates) {
    const filePath = urlMod.fileURLToPath(candidate);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  }

  throw new Error('[@lit-core/resumable] Compiled lib/client/hydrate-core.js not found. Build @lit-core/resumable first.');
}

const hydrateCoreJs = loadHydrateCoreSource();

export const HYDRATE_SUPPORT_SOURCE = `import { _$LH } from 'lit/html.js';
${hydrateCoreJs}
const __litHydrateRuntime = createHydrationRuntime(_$LH);
export const RESUMED_EVENT_FLAG = __litHydrateRuntime.RESUMED_EVENT_FLAG;
export const parseComponentState = __litHydrateRuntime.parseComponentState;
export const restoreComponentState = __litHydrateRuntime.restoreComponentState;
export const restoreStateFromHostAttribute = __litHydrateRuntime.restoreStateFromHostAttribute;
export const hydrate = __litHydrateRuntime.hydrate;
export const hydrateTemplateRoot = __litHydrateRuntime.hydrateTemplateRoot;
export const updateHydratedRoot = __litHydrateRuntime.updateHydratedRoot;
export const bindTemplateEventHandlers = __litHydrateRuntime.bindTemplateEventHandlers;
export const bindDataActionDelegation = __litHydrateRuntime.bindDataActionDelegation;
export const hydrateShadowRoots = __litHydrateRuntime.hydrateShadowRoots;
export const digestForTemplateResult = __litHydrateRuntime.digestForTemplateResult;
export const withResumable = __litHydrateRuntime.withResumable;
export const patchPrototypeForHydration = __litHydrateRuntime.patchPrototypeForHydration;
export const installLitHydrationSupport = __litHydrateRuntime.installLitHydrationSupport;
export const installResumableAdapter = __litHydrateRuntime.installResumableAdapter;
export const createReplayedEvent = __litHydrateRuntime.createReplayedEvent;
export const replayEvent = __litHydrateRuntime.replayEvent;
export const replayQueue = __litHydrateRuntime.replayQueue;
installLitHydrationSupport();
`;

export const RESUMABLE_ADAPTER_SOURCE = HYDRATE_SUPPORT_SOURCE;
