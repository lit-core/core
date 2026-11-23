import type { SsrAsyncRenderState } from './compiler-bridge.js';

export function createAsyncRenderState(): SsrAsyncRenderState {
  return {
    nextHostId: 0,
    nextBoundaryId: 0,
    nextChunkId: 0,
    shadowPath: [],
    boundaries: [],
    bootstrapEmitted: false,
  };
}
