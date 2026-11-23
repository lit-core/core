export class CustomEventStub<T = unknown> {
  readonly type: string;
  readonly detail: T | null;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  defaultPrevented = false;
  /** @internal */
  _propagationStopped = false;
  /** @internal */
  _immediatePropagationStopped = false;
  target: any = null;
  currentTarget: any = null;

  constructor(type: string, eventInitDict?: CustomEventInit<T>) {
    this.type = type;
    this.detail = (eventInitDict?.detail as T) ?? null;
    this.bubbles = eventInitDict?.bubbles ?? false;
    this.cancelable = eventInitDict?.cancelable ?? false;
    this.composed = eventInitDict?.composed ?? false;
  }

  preventDefault(): void {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  stopPropagation(): void {
    this._propagationStopped = true;
  }

  stopImmediatePropagation(): void {
    this._propagationStopped = true;
    this._immediatePropagationStopped = true;
  }
}

/**
 * W3C Web Components Community Group Context key type.
 */
export type Context<KeyType = unknown, ValueType = unknown> = KeyType & {
  readonly __context__?: ValueType;
};

/**
 * Create a typed context key per the W3C Web Components Community Group Context protocol.
 */
export function createContext<ValueType, KeyType = unknown>(key: KeyType): Context<KeyType, ValueType> {
  return key as Context<KeyType, ValueType>;
}

export type ContextCallback<ValueType> = (value: ValueType, unsubscribe?: () => void) => void;

/**
 * Standard W3C `context-request` event.
 */
export class ContextRequestEvent<T extends Context<unknown, unknown> = Context<unknown, unknown>> extends CustomEventStub<null> {
  readonly context: T;
  readonly callback: ContextCallback<T extends Context<unknown, infer V> ? V : unknown>;
  readonly subscribe?: boolean;

  constructor(context: T, callback: ContextCallback<T extends Context<unknown, infer V> ? V : unknown>, subscribe?: boolean) {
    super('context-request', { bubbles: true, cancelable: true, composed: true });
    this.context = context;
    this.callback = callback;
    this.subscribe = subscribe;
  }
}

export interface KeyboardEventInitLike {
  key?: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

export class KeyboardEventStub {
  readonly type: string;
  readonly key: string;
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  defaultPrevented = false;

  constructor(type: string, init?: KeyboardEventInitLike) {
    this.type = type;
    this.key = init?.key ?? '';
    this.code = init?.code ?? '';
    this.altKey = init?.altKey ?? false;
    this.ctrlKey = init?.ctrlKey ?? false;
    this.metaKey = init?.metaKey ?? false;
    this.shiftKey = init?.shiftKey ?? false;
    this.bubbles = init?.bubbles ?? false;
    this.cancelable = init?.cancelable ?? false;
    this.composed = init?.composed ?? false;
  }

  preventDefault(): void {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  stopPropagation(): void {}

  stopImmediatePropagation(): void {}
}

export class MutationObserverStub {
  observe(_target?: any, _options?: any): void {}
  disconnect(): void {}
  takeRecords(): any[] {
    return [];
  }
}

export class ResizeObserverStub {
  observe(_target?: any, _options?: any): void {}
  unobserve(_target?: any): void {}
  disconnect(): void {}
}

export class IntersectionObserverStub {
  observe(_target?: any): void {}
  unobserve(_target?: any): void {}
  disconnect(): void {}
  takeRecords(): any[] {
    return [];
  }
}

export interface ReactiveControllerLike {
  hostConnected?(): void;
  hostDisconnected?(): void;
  hostUpdate?(): void;
  hostUpdated?(): void;
}
