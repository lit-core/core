import { HTMLElementStub } from '../environment.js';
import { SHARED_STATELESS_COMPILER_BRIDGE } from '../render-constants.js';
import { attributeNameForProperty, collectPropertyDeclarations, type PropertyDeclarationLike } from './property-declarations.js';

export interface CtorSsrMeta {
  propDeclarations: Map<string, PropertyDeclarationLike>;
  propNames: string[];
  accessorProps: string[];
  reflectEntries: Array<{ prop: string; attrName: string; decl: PropertyDeclarationLike }>;
  attrToProp: Map<string, { prop: string; decl: PropertyDeclarationLike }>;
  observedSet: Set<string> | null;
  defaultTemplateOpenTag: string;
  plainNoCssFuseShadowPrefix: string;
  reflectionOnlyUpdate: ((changed: Map<PropertyKey, unknown>) => void) | null;
  canFastPathLifecycle: boolean;
  isServerElementCtor: boolean;
  isHydratableLitHost: boolean;
}

export const reactiveElementObjCache = new WeakMap<object, any | null>();
export const ctorSsrMetaCache = new WeakMap<object, CtorSsrMeta>();
export const propDeclToMetaCache = new WeakMap<Map<string, PropertyDeclarationLike>, CtorSsrMeta>();

export function findPrototypeAccessor(proto: any, prop: string): PropertyDescriptor | undefined {
  let cur = proto;
  while (cur && cur !== HTMLElementStub.prototype && cur !== Object.prototype) {
    const desc = Object.getOwnPropertyDescriptor(cur, prop);
    if (desc && (typeof desc.get === 'function' || typeof desc.set === 'function')) {
      return desc;
    }
    cur = Object.getPrototypeOf(cur);
  }
  return undefined;
}

export function findReactiveElementPrototype(instance: any): any | null {
  const start = Object.getPrototypeOf(instance);
  if (!start || typeof start !== 'object') return null;
  const cached = reactiveElementObjCache.get(start);
  if (cached !== undefined) {
    return cached;
  }
  let cur = start;
  while (cur && cur !== HTMLElementStub.prototype && cur !== Object.prototype) {
    if (Object.hasOwn(cur, 'performUpdate') && Object.hasOwn(cur, 'update')) {
      reactiveElementObjCache.set(start, cur);
      return cur;
    }
    cur = Object.getPrototypeOf(cur);
  }
  reactiveElementObjCache.set(start, null);
  return null;
}

export function getCtorSsrMeta(Ctor: any): CtorSsrMeta {
  if (typeof Ctor === 'function') {
    const cached = ctorSsrMetaCache.get(Ctor);
    if (cached !== undefined) {
      return cached;
    }
  }

  const propDeclarations = collectPropertyDeclarations(Ctor);
  const propNames: string[] = [];
  const accessorProps: string[] = [];
  const reflectEntries: Array<{ prop: string; attrName: string; decl: PropertyDeclarationLike }> = [];
  const attrToProp = new Map<string, { prop: string; decl: PropertyDeclarationLike }>();
  const targetPrototype = Ctor?.prototype;

  for (const [prop, decl] of propDeclarations.entries()) {
    propNames.push(prop);
    const attrName = attributeNameForProperty(prop, decl);
    if (attrName) {
      attrToProp.set(attrName, { prop, decl });
      if (decl.reflect === true) {
        reflectEntries.push({ prop, attrName, decl });
      }
    }
    if (targetPrototype) {
      const acc = findPrototypeAccessor(targetPrototype, prop);
      if (acc && typeof acc.set === 'function') {
        accessorProps.push(prop);
      }
    }
  }

  const observed: string[] | undefined = Ctor?.observedAttributes;
  const observedSet = Array.isArray(observed) ? new Set(observed.map((a) => String(a).toLowerCase())) : null;
  const shadowOpts = Ctor?.shadowRootOptions;
  const shadowMode = shadowOpts?.mode === 'closed' ? 'closed' : 'open';
  const delegatesAttr = shadowOpts?.delegatesFocus ? ' shadowrootdelegatesfocus' : '';
  const defaultTemplateOpenTag = `<template shadowrootmode="${shadowMode}"${delegatesAttr}>`;

  let reflectionOnlyUpdate: ((changed: Map<PropertyKey, unknown>) => void) | null = null;
  let reactiveProto: any = null;
  let litElementProto: any = null;
  if (targetPrototype) {
    let cur = targetPrototype;
    while (cur && cur !== HTMLElementStub.prototype && cur !== Object.prototype) {
      if (litElementProto === null && cur.constructor && Object.hasOwn(cur.constructor, '_$litElement$') && cur.constructor._$litElement$ === true) {
        litElementProto = cur;
      }
      if (reactiveProto === null && Object.hasOwn(cur, 'performUpdate') && Object.hasOwn(cur, 'update')) {
        reactiveProto = cur;
        const baseReactiveUpdate = cur.update;
        reflectionOnlyUpdate = function (this: any, changed: Map<PropertyKey, unknown>) {
          baseReactiveUpdate.call(this, changed);
        };
      }
      if (litElementProto !== null && reactiveProto !== null) {
        break;
      }
      cur = Object.getPrototypeOf(cur);
    }
  }

  const canFastPathLifecycle = Boolean(
    targetPrototype &&
      reactiveProto !== null &&
      litElementProto !== null &&
      targetPrototype.connectedCallback === litElementProto.connectedCallback &&
      targetPrototype.createRenderRoot === litElementProto.createRenderRoot &&
      targetPrototype.shouldUpdate === reactiveProto.shouldUpdate &&
      targetPrototype.performUpdate === reactiveProto.performUpdate &&
      targetPrototype.willUpdate === reactiveProto.willUpdate &&
      reflectEntries.length === 0 &&
      accessorProps.length === propNames.length,
  );

  const isServerElementCtor = Boolean(
    Ctor?.[Symbol.for('@lit-core/server-elements/element')] || Ctor?.[Symbol.for('@lit-core/server-elements/loader')] || Ctor?.[Symbol.for('@lit-core/server-elements/action')],
  );
  const isHydratableLitHost = Boolean(Ctor?._$litElement$) && !isServerElementCtor;
  const plainNoCssFuseShadowPrefix = defaultTemplateOpenTag + SHARED_STATELESS_COMPILER_BRIDGE.styleDeduplicator.resolveDefaultStyleTag(Ctor, false).styleTag;

  const meta: CtorSsrMeta = {
    propDeclarations,
    propNames,
    accessorProps,
    reflectEntries,
    attrToProp,
    observedSet,
    defaultTemplateOpenTag,
    plainNoCssFuseShadowPrefix,
    reflectionOnlyUpdate,
    canFastPathLifecycle,
    isServerElementCtor,
    isHydratableLitHost,
  };
  if (typeof Ctor === 'function') {
    ctorSsrMetaCache.set(Ctor, meta);
  }
  propDeclToMetaCache.set(propDeclarations, meta);
  return meta;
}

export function repairShadowedClassFields(instance: any, accessorProps: readonly string[]): void {
  for (let i = 0; i < accessorProps.length; i++) {
    const prop = accessorProps[i];
    if (!Object.hasOwn(instance, prop)) continue;
    const ownDesc = Object.getOwnPropertyDescriptor(instance, prop);
    if (ownDesc && 'value' in ownDesc && ownDesc.configurable) {
      const currentValue = ownDesc.value;
      delete instance[prop];
      if (currentValue !== undefined) {
        instance[prop] = currentValue;
      }
    }
  }
}
