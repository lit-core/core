export const LIT_NOTHING = Symbol.for('lit-nothing');

export const LIT_NO_CHANGE = Symbol.for('lit-noChange');

export const SSR_ASYNC_BOUNDARY = Symbol.for('lit-core-ssr-async-boundary');

export function isNothing(val: unknown): boolean {
  if (val === LIT_NOTHING || val === LIT_NO_CHANGE) return true;
  if (typeof val === 'symbol') {
    const desc = val.description;
    return desc === 'lit-nothing' || desc === 'lit-noChange';
  }
  return false;
}
