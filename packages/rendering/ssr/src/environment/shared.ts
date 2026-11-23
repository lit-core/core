import { type CSSStyleSheetStub, ValidityStateStub } from './constructable.js';
import type { HTMLElementStub } from './html-element.js';

export const SHARED_VALIDITY_STATE = Object.freeze(new ValidityStateStub()) as ValidityStateStub;

export const EMPTY_STYLE_SHEETS: CSSStyleSheetStub[] = Object.freeze([]) as unknown as CSSStyleSheetStub[];

export const EMPTY_ARRAY: any[] = Object.freeze([]) as unknown as any[];

export const NOOP_FN = () => {};

export const TRUE_FN = () => true;

export const EMPTY_LIGHT_CHILDREN: HTMLElementStub[] = Object.freeze([]) as unknown as HTMLElementStub[];

export const EMPTY_LIGHT_NODES: any[] = Object.freeze([]) as unknown as any[];
