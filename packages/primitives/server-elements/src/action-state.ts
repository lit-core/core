import type { ActionState } from './types.js';

export interface ReactiveHost {
  requestUpdate(): void;
  addController?(controller: unknown): void;
}

const DEFAULT_STATE: ActionState = {
  status: 'idle',
  isPending: false,
  isSuccess: false,
  isError: false,
  error: null,
  data: null,
};

/**
 * Controller managing reactive execution states and pending tracking for server actions.
 */
export class ActionStateController {
  private readonly _host: ReactiveHost;
  private readonly _states = new Map<string, ActionState>();

  constructor(host: ReactiveHost) {
    this._host = host;
    if (typeof host.addController === 'function') {
      host.addController(this);
    }
  }

  isActionPending(actionName: string): boolean {
    return this._states.get(actionName)?.isPending ?? false;
  }

  getActionState<T = unknown>(actionName: string): ActionState<T> {
    const s = this._states.get(actionName);
    if (!s) return DEFAULT_STATE as ActionState<T>;
    return s as ActionState<T>;
  }

  setPending(actionName: string): void {
    const prev = this.getActionState(actionName);
    this._states.set(actionName, {
      status: 'pending',
      isPending: true,
      isSuccess: false,
      isError: false,
      error: null,
      data: prev.data,
    });
    this._host.requestUpdate();
  }

  setSuccess<T>(actionName: string, data: T | null = null): void {
    this._states.set(actionName, {
      status: 'success',
      isPending: false,
      isSuccess: true,
      isError: false,
      error: null,
      data,
    });
    this._host.requestUpdate();
  }

  setError(actionName: string, error: Error): void {
    this._states.set(actionName, {
      status: 'error',
      isPending: false,
      isSuccess: false,
      isError: true,
      error,
      data: null,
    });
    this._host.requestUpdate();
  }

  reset(actionName: string): void {
    this._states.delete(actionName);
    this._host.requestUpdate();
  }
}
