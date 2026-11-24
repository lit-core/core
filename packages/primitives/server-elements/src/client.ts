/** Public entry point for browser-side action dispatch and event binding. The implementation lives in `client-runtime/`. */
export {
  __litActionRpc,
  __litBindEvents,
  type ActionEventDetail,
  bindFormAction,
  type DispatchActionOptions,
  dispatchServerAction,
  type EventDescriptor,
  executePatches,
  hydrateClientState,
} from './client-runtime/index.js';
export { isReloadRequired } from './errors.js';
export { ACTION_ERROR_EVENT, ACTION_SUCCESS_EVENT } from './protocol.js';
