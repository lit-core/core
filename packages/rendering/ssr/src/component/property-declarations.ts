import { HTMLElementStub } from '../environment.js';

export interface PropertyDeclarationLike {
  attribute?: boolean | string;
  type?: unknown;
  converter?: ((value: string | null, type?: unknown) => unknown) | { fromAttribute?: (value: string | null, type?: unknown) => unknown; toAttribute?: (value: unknown, type?: unknown) => unknown };
  reflect?: boolean;
  state?: boolean;
}

export function collectPropertyDeclarations(Ctor: any): Map<string, PropertyDeclarationLike> {
  const map = new Map<string, PropertyDeclarationLike>();
  if (!Ctor) return map;

  try {
    if (typeof Ctor.finalize === 'function') {
      Ctor.finalize();
    }
  } catch {}

  if (Ctor.elementProperties instanceof Map) {
    for (const [key, decl] of Ctor.elementProperties.entries()) {
      if (typeof key === 'string' && decl && typeof decl === 'object') {
        map.set(key, decl as PropertyDeclarationLike);
      }
    }
  }

  // Walk prototype constructors for static `properties` declarations (e.g. props-lower or vanilla classes)
  const ctors: any[] = [];
  let cur = Ctor;
  while (cur && typeof cur === 'function' && cur !== HTMLElementStub && cur !== Function.prototype) {
    ctors.push(cur);
    cur = Object.getPrototypeOf(cur);
  }
  for (let i = ctors.length - 1; i >= 0; i--) {
    const propsObj = ctors[i].properties;
    if (propsObj && typeof propsObj === 'object') {
      for (const [key, decl] of Object.entries(propsObj)) {
        if (!map.has(key)) {
          map.set(key, (decl && typeof decl === 'object' ? decl : {}) as PropertyDeclarationLike);
        }
      }
    }
  }

  return map;
}

export function attributeNameForProperty(prop: string, decl: PropertyDeclarationLike): string | null {
  if (decl.state === true || decl.attribute === false) {
    return null;
  }
  if (typeof decl.attribute === 'string') {
    return decl.attribute.toLowerCase();
  }
  return prop.toLowerCase();
}

export function defaultFromAttribute(value: string | null, type?: unknown): unknown {
  if (type === Boolean) {
    return value !== null;
  }
  if (type === Number) {
    return value === null ? null : Number(value);
  }
  if (type === Object || type === Array) {
    if (value === null) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

export function defaultToAttribute(value: unknown, type?: unknown): unknown {
  if (type === Boolean) {
    return value ? '' : null;
  }
  if (type === Object || type === Array) {
    return value == null ? value : JSON.stringify(value);
  }
  return value == null ? value : String(value);
}

export function convertPropertyToAttribute(value: unknown, decl: PropertyDeclarationLike): unknown {
  const converter = decl.converter;
  if (converter && typeof converter === 'object' && typeof converter.toAttribute === 'function') {
    return converter.toAttribute(value, decl.type);
  }
  return defaultToAttribute(value, decl.type);
}

export function convertAttributeToProperty(value: string | null, decl: PropertyDeclarationLike): unknown {
  const converter = decl.converter;
  if (typeof converter === 'function') {
    return converter(value, decl.type);
  }
  if (converter && typeof converter === 'object' && typeof converter.fromAttribute === 'function') {
    return converter.fromAttribute(value, decl.type);
  }
  return defaultFromAttribute(value, decl.type);
}
