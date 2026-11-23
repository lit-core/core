import { HTMLElementStub } from './environment.js';

export function isElementInstance(value: unknown): value is HTMLElementStub {
  if (value === null || typeof value !== 'object') return false;
  if (value instanceof HTMLElementStub) return true;
  const gHtmlElement = (globalThis as any).HTMLElement;
  if (typeof gHtmlElement === 'function' && value instanceof gHtmlElement) return true;
  return false;
}

export function defineElementProperty(target: any, prop: string, value: any): void {
  try {
    target[prop] = value;
  } catch {
    try {
      Object.defineProperty(target, prop, {
        value,
        configurable: true,
        writable: true,
        enumerable: true,
      });
    } catch {
      // Ignore if property is locked
    }
  }
}
