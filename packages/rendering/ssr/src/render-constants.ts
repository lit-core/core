import { CompilerBridge } from './compiler-bridge.js';
import { SlotManager } from './slot.js';

/** Default deadline for a pending async boundary before its fallback is rendered. */
export const DEFAULT_BOUNDARY_TIMEOUT_MS = 5000;

export const NOOP_RENDER_FN = () => {};

export const EMPTY_EVENT_ATTRS: string[] = [];

export const EMPTY_ADOPTED_URLS: string[] = [];

export const SHARED_DSD_SLOT_MANAGER = new SlotManager();

export const SHARED_STATELESS_COMPILER_BRIDGE = new CompilerBridge();
