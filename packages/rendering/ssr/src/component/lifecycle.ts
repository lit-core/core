import { isNothing, resolveDirectiveValue, type SsrDynamicAttribute, type SsrOpcode } from '../compiler-bridge.js';
import { defineElementProperty } from '../element-utils.js';
import { ARIA_MIXIN_ENTRIES, HTMLElementStub, HYDRATE_INTERNALS_ATTR_PREFIX } from '../environment.js';
import { EMPTY_EVENT_ATTRS, NOOP_RENDER_FN } from '../render-constants.js';
import { isValidAttrName } from '../validation.js';
import { findReactiveElementPrototype, getCtorSsrMeta, propDeclToMetaCache, repairShadowedClassFields } from './ctor-meta.js';
import { attachNonStubDomSurface, hasFrozenPrototypeInChain, setInstanceOverride } from './dom-surface.js';
import { buildLightDomStubsFromOpcodes } from './light-dom.js';
import { attributeNameForProperty, convertAttributeToProperty, convertPropertyToAttribute, type PropertyDeclarationLike } from './property-declarations.js';

export interface ComponentLifecycleInput {
  instance: any;
  Ctor: any;
  tagName: string;
  staticAttrs?: Record<string, string>;
  dynamicAttrs?: SsrDynamicAttribute[];
  values?: unknown[];
  lightOpcodes?: { opcodes: SsrOpcode[]; values: unknown[]; start: number; end: number };
  parentHost?: HTMLElementStub | null;
  contextLookup?: (key: unknown) => { found: boolean; value: unknown };
  onError?: (error: unknown, info: { tagName?: string; phase: string }) => void;
  strictLifecycle?: boolean;
  resumable?: boolean;
  deferHydration?: boolean;
  shouldCallConnectedCallback?: (tagName: string, instance: unknown) => boolean;
  skipChangedTracking?: boolean;
}

/** The Lit-internal members that signal a component hooks into its own lifecycle. */
interface LitLifecycleInternals {
  _$EO?: { size?: number };
  __controllers?: { size?: number };
  _controllers?: { size?: number };
  __internals?: unknown;
}

/**
 * True when nothing extends the element's lifecycle: no reactive controllers, no attached
 * internals, no own `connectedCallback` or `willUpdate`. Only then can connect and update be skipped.
 */
export function hasNoLifecycleExtensions(instance: object): boolean {
  const internals = instance as LitLifecycleInternals;
  return (
    !internals._$EO?.size &&
    !internals.__controllers?.size &&
    !internals._controllers?.size &&
    !internals.__internals &&
    !Object.hasOwn(instance, 'connectedCallback') &&
    !Object.hasOwn(instance, 'willUpdate')
  );
}

export const SHARED_EMPTY_CHANGED_MAP = new Map<PropertyKey, unknown>();

export function prepareComponentBindings(input: ComponentLifecycleInput): {
  propDeclarations: Map<string, PropertyDeclarationLike>;
  changedProperties: Map<PropertyKey, unknown>;
  eventAttrs: string[];
} {
  const { instance, Ctor, tagName, staticAttrs, dynamicAttrs, values } = input;
  const meta = getCtorSsrMeta(Ctor);
  const tagUpper = tagName.toUpperCase();
  if (instance instanceof HTMLElementStub) {
    instance.tagName = tagUpper;
    instance.isConnected = true;
    const willFastPathConnect = Boolean(input.skipChangedTracking && meta.canFastPathLifecycle) && hasNoLifecycleExtensions(instance);
    if (!willFastPathConnect && typeof (instance as any).enableUpdating === 'function') {
      setInstanceOverride(instance, 'enableUpdating', NOOP_RENDER_FN, hasFrozenPrototypeInChain(instance));
    }
  } else {
    defineElementProperty(instance, 'tagName', tagUpper);
    defineElementProperty(instance, 'localName', tagName.toLowerCase());
    defineElementProperty(instance, 'isConnected', true);
    if (typeof instance.enableUpdating === 'function') {
      defineElementProperty(instance, 'enableUpdating', NOOP_RENDER_FN);
    }
    attachNonStubDomSurface(instance);
  }

  const { propDeclarations, propNames, accessorProps, attrToProp, observedSet, reflectEntries, reflectionOnlyUpdate } = meta;
  if (accessorProps.length > 0) {
    repairShadowedClassFields(instance, accessorProps);
  }

  const canSkipChangedMap = Boolean(input.skipChangedTracking && reflectionOnlyUpdate !== null && reflectEntries.length === 0 && accessorProps.length === propNames.length);
  const changedProperties = canSkipChangedMap ? SHARED_EMPTY_CHANGED_MAP : new Map<PropertyKey, unknown>();

  if (!canSkipChangedMap) {
    for (let i = 0; i < propNames.length; i++) {
      const prop = propNames[i];
      try {
        if (instance[prop] !== undefined) {
          changedProperties.set(prop, undefined);
        }
      } catch {}
    }
  }

  const hasStaticAttrs = Boolean(staticAttrs);
  const hasDynamicAttrs = Boolean(dynamicAttrs && dynamicAttrs.length > 0 && values);

  if (hasStaticAttrs || hasDynamicAttrs) {
    const setHostAttrAndSyncProperty = (rawName: string, attrValue: string | null) => {
      const lower = rawName.toLowerCase();
      if (lower === 'data-lit-ssr') return;

      const prevAttr = typeof instance.getAttribute === 'function' ? instance.getAttribute(lower) : null;
      if (attrValue === null) {
        if (typeof instance.removeAttribute === 'function') {
          instance.removeAttribute(lower);
        }
      } else if (typeof instance.setAttribute === 'function') {
        instance.setAttribute(lower, attrValue);
      }

      const mapped = attrToProp.get(lower);
      if (typeof instance.attributeChangedCallback === 'function' && (!observedSet || observedSet.has(lower))) {
        instance.attributeChangedCallback(lower, prevAttr, attrValue);
        if (!canSkipChangedMap && mapped && !changedProperties.has(mapped.prop)) {
          changedProperties.set(mapped.prop, undefined);
        }
      } else if (mapped) {
        const converted = convertAttributeToProperty(attrValue, mapped.decl);
        defineElementProperty(instance, mapped.prop, converted);
        if (!canSkipChangedMap && !changedProperties.has(mapped.prop)) {
          changedProperties.set(mapped.prop, undefined);
        }
      } else if (rawName in instance && typeof instance[rawName] !== 'function') {
        instance[rawName] = attrValue === null ? false : attrValue;
        if (!canSkipChangedMap && !changedProperties.has(rawName)) {
          changedProperties.set(rawName, undefined);
        }
      }
    };

    if (staticAttrs) {
      for (const [name, value] of Object.entries(staticAttrs)) {
        setHostAttrAndSyncProperty(name, value);
      }
    }

    let eventAttrs: string[] | null = null;
    if (dynamicAttrs && values) {
      for (let i = 0; i < dynamicAttrs.length; i++) {
        const dyn = dynamicAttrs[i];
        if (dyn.type === 'directive') {
          // ElementPart directives only execute `update(part, args)` on live client DOM elements;
          // per Lit SSR semantics, `render()` must not be invoked on the server.
          continue;
        }
        if (dyn.type === 'event') {
          if (input.resumable && isValidAttrName(`resumes-on-${dyn.name}`)) {
            (eventAttrs ??= []).push(`resumes-on-${dyn.name}`);
          }
          continue;
        }
        if ('name' in dyn && dyn.name) {
          if (dyn.type === 'property') {
            if (dyn.indices && dyn.strings) {
              let formatted = dyn.strings[0] ?? '';
              let omitted = false;
              for (let j = 0; j < dyn.indices.length; j++) {
                const idx = dyn.indices[j];
                const rawVal = idx < values.length ? values[idx] : undefined;
                const resolved = resolveDirectiveValue(rawVal, { type: 3, tagName: tagUpper, name: dyn.name, strings: dyn.strings });
                if (isNothing(resolved)) {
                  omitted = true;
                } else if (resolved !== null && resolved !== undefined) {
                  formatted += String(resolved);
                }
                formatted += dyn.strings[j + 1] ?? '';
              }
              if (!omitted) {
                defineElementProperty(instance, dyn.name, formatted);
                if (!canSkipChangedMap && !changedProperties.has(dyn.name)) {
                  changedProperties.set(dyn.name, undefined);
                }
              }
            } else {
              const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
              const resolved = resolveDirectiveValue(rawVal, { type: 3, tagName: tagUpper, name: dyn.name, strings: dyn.strings });
              if (!isNothing(resolved)) {
                const finalVal =
                  dyn.strings && dyn.strings.length > 1 ? dyn.strings[0] + (resolved !== null && resolved !== undefined ? String(resolved) : '') + dyn.strings.slice(1).join('') : resolved;
                defineElementProperty(instance, dyn.name, finalVal);
                if (!canSkipChangedMap && !changedProperties.has(dyn.name)) {
                  changedProperties.set(dyn.name, undefined);
                }
              }
            }
          } else if (dyn.type === 'boolean') {
            const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
            const resolved = resolveDirectiveValue(rawVal, { type: 4, tagName: tagUpper, name: dyn.name });
            const boolVal = Boolean(resolved) && !isNothing(resolved);
            setHostAttrAndSyncProperty(dyn.name, boolVal ? '' : null);
          } else if (dyn.type === 'attribute') {
            if (dyn.indices && dyn.strings) {
              let formatted = dyn.strings[0] ?? '';
              for (let j = 0; j < dyn.indices.length; j++) {
                const idx = dyn.indices[j];
                const rawVal = idx < values.length ? values[idx] : undefined;
                const resolved = resolveDirectiveValue(rawVal, { type: 1, tagName: tagUpper, name: dyn.name, strings: dyn.strings });
                formatted += !isNothing(resolved) && resolved !== null && resolved !== undefined ? String(resolved) : '';
                formatted += dyn.strings[j + 1] ?? '';
              }
              setHostAttrAndSyncProperty(dyn.name, formatted);
            } else {
              const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
              const resolved = resolveDirectiveValue(rawVal, { type: 1, tagName: tagUpper, name: dyn.name, strings: dyn.strings });
              if (!isNothing(resolved) && resolved !== undefined && resolved !== null) {
                const formatted = dyn.strings && dyn.strings.length > 1 ? dyn.strings[0] + String(resolved) + dyn.strings.slice(1).join('') : String(resolved);
                setHostAttrAndSyncProperty(dyn.name, formatted);
              } else if (isNothing(resolved) || resolved === null || resolved === undefined) {
                setHostAttrAndSyncProperty(dyn.name, null);
              }
            }
          }
        }
      }
    }

    if (input.lightOpcodes && input.lightOpcodes.start < input.lightOpcodes.end) {
      const stubs = buildLightDomStubsFromOpcodes(input.lightOpcodes.opcodes, input.lightOpcodes.values, input.lightOpcodes.start, input.lightOpcodes.end);
      if (instance instanceof HTMLElementStub) {
        instance._ssrLightChildren = stubs.children;
        instance._ssrLightChildNodes = stubs.childNodes;
      } else {
        defineElementProperty(instance, '_ssrLightChildren', stubs.children);
        defineElementProperty(instance, '_ssrLightChildNodes', stubs.childNodes);
      }
    }

    return { propDeclarations, changedProperties, eventAttrs: eventAttrs ?? EMPTY_EVENT_ATTRS };
  }

  if (input.lightOpcodes && input.lightOpcodes.start < input.lightOpcodes.end) {
    const stubs = buildLightDomStubsFromOpcodes(input.lightOpcodes.opcodes, input.lightOpcodes.values, input.lightOpcodes.start, input.lightOpcodes.end);
    if (instance instanceof HTMLElementStub) {
      instance._ssrLightChildren = stubs.children;
      instance._ssrLightChildNodes = stubs.childNodes;
    } else {
      defineElementProperty(instance, '_ssrLightChildren', stubs.children);
      defineElementProperty(instance, '_ssrLightChildNodes', stubs.childNodes);
    }
  }

  return { propDeclarations, changedProperties, eventAttrs: EMPTY_EVENT_ATTRS };
}

export function executeComponentLifecycleAndReflection(
  instance: any,
  tagName: string,
  propDeclarations: Map<string, PropertyDeclarationLike>,
  changedProperties: Map<PropertyKey, unknown>,
  options: {
    parentHost?: HTMLElementStub | null;
    contextLookup?: (key: unknown) => { found: boolean; value: unknown };
    onError?: (error: unknown, info: { tagName?: string; phase: string }) => void;
    strictLifecycle?: boolean;
    deferHydration?: boolean;
    shouldCallConnectedCallback?: (tagName: string, instance: unknown) => boolean;
  } = {},
): void {
  if (instance instanceof HTMLElementStub) {
    instance._ssrParentHost = options.parentHost ?? null;
    if (options.contextLookup) {
      instance._ssrContextLookup = options.contextLookup;
    }
  } else {
    defineElementProperty(instance, '_ssrParentHost', options.parentHost ?? null);
    if (options.parentHost && typeof instance.__resolveFullEventPath === 'function' && typeof (options.parentHost as any).__resolveFullEventPath === 'function') {
      defineElementProperty(instance, '__eventTargetParent', options.parentHost);
    }
    if (options.contextLookup) {
      defineElementProperty(instance, '_ssrContextLookup', options.contextLookup);
    }
  }

  const meta = propDeclToMetaCache.get(propDeclarations);
  const fastSkippedChanged = changedProperties === SHARED_EMPTY_CHANGED_MAP && meta !== undefined && meta.reflectionOnlyUpdate !== null && meta.reflectEntries.length === 0;
  if (fastSkippedChanged && meta.canFastPathLifecycle && instance instanceof HTMLElementStub && !options.shouldCallConnectedCallback && hasNoLifecycleExtensions(instance)) {
    (instance as any).isUpdatePending = false;
    return;
  }

  const propNames = fastSkippedChanged ? EMPTY_EVENT_ATTRS : meta ? meta.propNames : Array.from(propDeclarations.keys());
  let preConnectValues: unknown[] | null = null;
  if (!fastSkippedChanged && propNames.length > 0) {
    preConnectValues = new Array(propNames.length);
    for (let i = 0; i < propNames.length; i++) {
      try {
        preConnectValues[i] = instance[propNames[i]];
      } catch {}
    }
  }

  const reactiveProto = findReactiveElementPrototype(instance);

  const shouldConnect = options.shouldCallConnectedCallback ? options.shouldCallConnectedCallback(tagName, instance) : true;
  if (shouldConnect) {
    try {
      instance.connectedCallback?.();
    } catch (err) {
      options.onError?.(err, { tagName, phase: 'connectedCallback' });
      if (options.strictLifecycle) {
        throw err;
      }
    }
  }

  if (preConnectValues) {
    for (let i = 0; i < propNames.length; i++) {
      const prop = propNames[i];
      try {
        const cur = instance[prop];
        const prev = preConnectValues[i];
        if (!Object.is(cur, prev) || (cur !== undefined && !changedProperties.has(prop))) {
          if (!changedProperties.has(prop)) {
            changedProperties.set(prop, prev);
          }
        }
      } catch {}
    }
  }

  if (reactiveProto) {
    // Run Lit's genuine ReactiveElement update cycle (`shouldUpdate` -> `willUpdate` -> controller `hostUpdate` -> reflection-only `ReactiveElement.prototype.update`)
    // synchronously without enqueuing a phantom `requestUpdate()` / `scheduleUpdate()` microtask.
    const useDefine = hasFrozenPrototypeInChain(instance);
    const prevUpdate = instance.update;
    const prevFirstUpdated = instance.firstUpdated;
    const prevUpdated = instance.updated;
    const updateOverride =
      fastSkippedChanged && meta.reflectionOnlyUpdate
        ? meta.reflectionOnlyUpdate
        : function (this: any, changed: Map<PropertyKey, unknown>) {
            for (const [k, v] of changed.entries()) {
              if (!changedProperties.has(k)) {
                changedProperties.set(k, v);
              }
            }
            reactiveProto.update.call(this, changed);
          };

    setInstanceOverride(instance, 'update', updateOverride, useDefine);
    setInstanceOverride(instance, 'firstUpdated', NOOP_RENDER_FN, useDefine);
    setInstanceOverride(instance, 'updated', NOOP_RENDER_FN, useDefine);

    try {
      setInstanceOverride(instance, 'isUpdatePending', true, useDefine);
      instance.performUpdate();
    } catch (err) {
      options.onError?.(err, { tagName, phase: 'willUpdate' });
      throw err;
    } finally {
      setInstanceOverride(instance, 'update', prevUpdate, useDefine);
      setInstanceOverride(instance, 'firstUpdated', prevFirstUpdated, useDefine);
      setInstanceOverride(instance, 'updated', prevUpdated, useDefine);
    }
  } else {
    try {
      instance.willUpdate?.(changedProperties);
    } catch (err) {
      options.onError?.(err, { tagName, phase: 'willUpdate' });
      throw err;
    }
    if (typeof instance._invokeControllersHostUpdate === 'function') {
      instance._invokeControllersHostUpdate();
    }
  }

  // Reflect ElementInternals AOM ARIA properties onto host attributes when unset on the host.
  const internals = instance?.__internals;
  if (internals && typeof internals === 'object') {
    for (let i = 0; i < ARIA_MIXIN_ENTRIES.length; i++) {
      const entry = ARIA_MIXIN_ENTRIES[i];
      const value = internals[entry[0]];
      if (value !== undefined && value !== null && value !== '') {
        const ariaAttr = entry[1];
        if (!(typeof instance.hasAttribute === 'function' && instance.hasAttribute(ariaAttr))) {
          const strVal = String(value);
          instance.setAttribute?.(ariaAttr, strVal);
          instance.setAttribute?.(`${HYDRATE_INTERNALS_ATTR_PREFIX}${ariaAttr}`, strVal);
        }
      }
    }
  }

  // Ensure all declared `reflect: true` properties (including lowered or non-ReactiveElement classes)
  // reflect their post-willUpdate values onto the host element's attributes.
  if (meta) {
    const reflectEntries = meta.reflectEntries;
    for (let i = 0; i < reflectEntries.length; i++) {
      const { prop, attrName, decl } = reflectEntries[i];
      let val: unknown;
      try {
        val = instance[prop];
      } catch {
        continue;
      }
      if (val === undefined && !changedProperties.has(prop) && !(typeof instance.hasAttribute === 'function' && instance.hasAttribute(attrName))) {
        continue;
      }
      const attrVal = convertPropertyToAttribute(val, decl);
      if (attrVal === undefined) {
        continue;
      }
      if (attrVal === null) {
        instance.removeAttribute?.(attrName);
      } else {
        instance.setAttribute?.(attrName, String(attrVal));
      }
    }
  } else {
    for (const [prop, decl] of propDeclarations.entries()) {
      if (decl.reflect !== true) continue;
      const attrName = attributeNameForProperty(prop, decl);
      if (!attrName) continue;
      let val: unknown;
      try {
        val = instance[prop];
      } catch {
        continue;
      }
      if (val === undefined && !changedProperties.has(prop) && !(typeof instance.hasAttribute === 'function' && instance.hasAttribute(attrName))) {
        continue;
      }
      const attrVal = convertPropertyToAttribute(val, decl);
      if (attrVal === undefined) {
        continue;
      }
      if (attrVal === null) {
        if (typeof instance.removeAttribute === 'function') {
          instance.removeAttribute(attrName);
        }
      } else if (typeof instance.setAttribute === 'function') {
        instance.setAttribute(attrName, String(attrVal));
      }
    }
  }
}

export function prepareAndRunComponentLifecycle(input: ComponentLifecycleInput): {
  propDeclarations: Map<string, PropertyDeclarationLike>;
  changedProperties: Map<PropertyKey, unknown>;
  eventAttrs: string[];
} {
  const prepared = prepareComponentBindings(input);
  executeComponentLifecycleAndReflection(input.instance, input.tagName, prepared.propDeclarations, prepared.changedProperties, {
    parentHost: input.parentHost,
    contextLookup: input.contextLookup,
    onError: input.onError,
    strictLifecycle: input.strictLifecycle,
    deferHydration: input.deferHydration,
    shouldCallConnectedCallback: input.shouldCallConnectedCallback,
  });
  return prepared;
}
