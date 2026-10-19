import { type MutableRefObject, type Ref, useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { attachFormLifecycle, isElementFormDisabled } from './forms.js';
import { MorphHost } from './morph-host.js';

export interface UseMorphHostResult<T extends MorphHost> {
  host: T;
  elementRef: (node: HTMLElement | null) => void;
  shouldRender: boolean;
  prevPropsRef: MutableRefObject<Record<string, any>>;
}

/**
 * React 19 companion hook for MorphHost instances.
 * Coordinates lifecycle execution, subscription via useSyncExternalStore,
 * prop synchronization without the controlled-component trap, and host element ref augmentation.
 */
export function useMorphHost<T extends MorphHost>(Ctor: new () => T, props: Record<string, any>, forwardedRef?: Ref<any>): UseMorphHostResult<T> {
  // 1. Pure instance instantiation in useRef (safe under React Strict Mode double-render)
  const hostRef = useRef<T | null>(null);
  if (hostRef.current === null) {
    hostRef.current = new Ctor();
  }
  const host = hostRef.current;

  // Keep latest props accessible on host for event callback routing
  host._props = props;

  // 2. Reactive subscription via useSyncExternalStore
  useSyncExternalStore(
    useCallback(
      (notify) => {
        host._subscribers.add(notify);
        return () => {
          host._subscribers.delete(notify);
        };
      },
      [host],
    ),
    useCallback(() => host._version, [host]),
    () => 0,
  );

  // 3. Prop syncing without the controlled-component trap
  const prevPropsRef = useRef<Record<string, any>>({});
  const prevProps = prevPropsRef.current;
  let propsChanged = false;

  for (const key of Object.keys(props)) {
    if (key === 'children' || key.startsWith('on') || key === 'ref') {
      continue;
    }
    // Check both key presence and value inequality (Object.is handles NaN and distinguishes explicit undefined)
    if (!(key in prevProps) || !Object.is(props[key], prevProps[key])) {
      const oldVal = (host as any)[key];
      host._changedProperties.set(key, oldVal);
      (host as any)[key] = props[key];
      prevProps[key] = props[key];
      propsChanged = true;
    }
  }

  // Handle removed props
  const propDefaults = (Ctor as any)._propertyDefaults || {};
  for (const key of Object.keys(prevProps)) {
    if (!(key in props)) {
      const defaultVal = propDefaults[key];
      const oldVal = (host as any)[key];
      host._changedProperties.set(key, oldVal);
      (host as any)[key] = defaultVal;
      delete prevProps[key];
      propsChanged = true;
    }
  }

  if (propsChanged) {
    host._markUpdatePending();
  }

  // 4. Render phase lifecycle evaluation
  const shouldRender = host.shouldUpdate(host._changedProperties);
  if (shouldRender) {
    host.willUpdate(host._changedProperties);
    host.update(host._changedProperties);
  }

  // 5. Connection lifecycle (mount and unmount only)
  useLayoutEffect(() => {
    host.connectedCallback();
    return () => {
      host.disconnectedCallback();
    };
  }, [host]);

  // 6. Post-commit update lifecycle (executes after every committed render)
  useLayoutEffect(() => {
    if (shouldRender && (host._isUpdatePending || !host.hasUpdated)) {
      const changedProperties = new Map(host._changedProperties);

      // Commit the current update state before executing updated()/firstUpdated().
      // This resets _isUpdatePending and clears current changedProperties so any
      // requestUpdate() called within updated() queues a clean new update cycle.
      host._commitUpdate(shouldRender);

      if (!host.hasUpdated) {
        host.firstUpdated(changedProperties);
      }

      host.updated(changedProperties);
    } else {
      // When shouldRender is false, bypass firstUpdated/updated and resolve updateComplete with false
      host._commitUpdate(shouldRender);
    }
  });

  // 6b. Form lifecycle coordination (mount, reset listener, and fieldset disabled observation)

  const isFormAssociated = Boolean(
    (Ctor as any).formAssociated ||
      (host as any)._isFormAssociated ||
      (host as any)._internals ||
      ((host as any).formResetCallback && (host as any).formResetCallback !== MorphHost.prototype.formResetCallback) ||
      ((host as any).formDisabledCallback && (host as any).formDisabledCallback !== MorphHost.prototype.formDisabledCallback) ||
      ((host as any).formStateRestoreCallback && (host as any).formStateRestoreCallback !== MorphHost.prototype.formStateRestoreCallback) ||
      ((host as any).formAssociatedCallback && (host as any).formAssociatedCallback !== MorphHost.prototype.formAssociatedCallback),
  );

  useLayoutEffect(() => {
    if (!isFormAssociated || !host._hostElement) return;

    const cleanup = attachFormLifecycle(host, host._hostElement, () => Boolean(props.disabled));
    return cleanup;
  }, [host, isFormAssociated, host._hostElement, props.disabled]);

  useLayoutEffect(() => {
    if (!isFormAssociated || !host._hostElement) return;

    const nextDisabled = isElementFormDisabled(host._hostElement, Boolean(props.disabled));
    if (nextDisabled !== host._currentFormDisabledState) {
      host._currentFormDisabledState = nextDisabled;
      if (typeof (host as any).formDisabledCallback === 'function') {
        (host as any).formDisabledCallback(nextDisabled);
      }
    }
  }, [host, isFormAssociated, props.disabled]);

  // 7. Host DOM element ref callback with facade augmentation
  const elementRef = useCallback(
    (node: HTMLElement | null) => {
      host._attachHostElement(node);

      if (node) {
        // Expose public properties and methods directly on DOM element as own properties
        augmentElementWithHost(node, host);
      }

      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef && 'current' in forwardedRef) {
        (forwardedRef as any).current = node;
      }
    },
    [host, forwardedRef],
  );

  return {
    host,
    elementRef,
    shouldRender,
    prevPropsRef,
  };
}

/**
 * Native DOM methods on MorphHost that forward to _hostElement and must not overwrite node's native DOM methods.
 */
const MORPH_HOST_DOM_FACADES = new Set([
  'querySelector',
  'querySelectorAll',
  'getAttribute',
  'setAttribute',
  'removeAttribute',
  'hasAttribute',
  'focus',
  'blur',
  'getBoundingClientRect',
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
]);

/**
 * Augments the rendered host DOM element with component properties and methods as own properties.
 * Never monkey-patches Element.prototype, strictly preserving DOM isolation.
 */
function augmentElementWithHost<T extends MorphHost>(node: HTMLElement, host: T): void {
  // 1. Core ReactiveElement lifecycles and helpers
  if (!('updateComplete' in node)) {
    Object.defineProperty(node, 'updateComplete', {
      get: () => host.updateComplete,
      configurable: true,
      enumerable: true,
    });
  }

  if (!('requestUpdate' in node)) {
    Object.defineProperty(node, 'requestUpdate', {
      value: (name?: PropertyKey, oldValue?: unknown) => host.requestUpdate(name, oldValue),
      configurable: true,
      writable: true,
    });
  }

  const seenKeys = new Set<string>();

  // 2. Delegate own instance properties and fields from host
  // Any own property on host not prefixed with '_' (except '_internals') is an author-declared field
  const ownDescriptors = Object.getOwnPropertyDescriptors(host);
  for (const [key, desc] of Object.entries(ownDescriptors)) {
    if (key.startsWith('_') && key !== '_internals') continue;
    seenKeys.add(key);

    const nodeDesc = Object.getOwnPropertyDescriptor(node, key);
    if (nodeDesc) {
      continue;
    }

    try {
      if (desc.get || desc.set) {
        Object.defineProperty(node, key, {
          get: desc.get ? () => (host as any)[key] : undefined,
          set: desc.set
            ? (v: any) => {
                if (typeof (host as any)[key] === 'boolean' && v === '') return;
                (host as any)[key] = v;
              }
            : undefined,
          configurable: true,
          enumerable: desc.enumerable,
        });
      } else {
        Object.defineProperty(node, key, {
          get: () => (host as any)[key],
          set: (v: any) => {
            if (typeof (host as any)[key] === 'boolean' && v === '') return;
            (host as any)[key] = v;
          },
          configurable: true,
          enumerable: true,
        });
      }
    } catch {
      // Ignore unconfigurable native properties
    }
  }

  // 3. Delegate prototype methods and accessors from host class hierarchy (derived to base)
  let proto = Object.getPrototypeOf(host);
  while (proto && proto !== Object.prototype) {
    const isBaseMorphHost = proto === MorphHost.prototype;
    const descriptors = Object.getOwnPropertyDescriptors(proto);

    for (const [key, desc] of Object.entries(descriptors)) {
      if (key === 'constructor' || key.startsWith('_')) continue;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      // On base MorphHost, do not overwrite native DOM methods on node with host facades
      if (isBaseMorphHost && MORPH_HOST_DOM_FACADES.has(key)) {
        continue;
      }

      const nodeDesc = Object.getOwnPropertyDescriptor(node, key);
      if (nodeDesc) {
        continue;
      }

      try {
        if (desc.get || desc.set) {
          Object.defineProperty(node, key, {
            get: desc.get ? () => (host as any)[key] : undefined,
            set: desc.set
              ? (v: any) => {
                  if (typeof (host as any)[key] === 'boolean' && v === '') return;
                  (host as any)[key] = v;
                }
              : undefined,
            configurable: true,
            enumerable: desc.enumerable,
          });
        } else if (typeof desc.value === 'function') {
          Object.defineProperty(node, key, {
            value: desc.value.bind(host),
            configurable: true,
            writable: true,
          });
        }
      } catch {
        // Ignore unconfigurable native properties
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
}
