import type React from 'react';
import type { MorphHost } from './morph-host.js';

/**
 * Visually hidden styling for form proxy input elements.
 * Uses 1px clipped layout to preserve browser constraint validation eligibility
 * while remaining imperceptible in screen layout and accessibility trees.
 */
export const _proxyInputStyle: React.CSSProperties = {
  position: 'absolute',
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  width: '1px',
  whiteSpace: 'nowrap',
  opacity: 0,
  pointerEvents: 'none',
};

/**
 * Type guard evaluating whether an element is an HTMLFormElement or a compatible form facade.
 * Supports standard browser DOM instances, mock test objects, and SSR environments.
 */
export function isFormElement(el: unknown): el is HTMLFormElement {
  if (!el || typeof el !== 'object') return false;
  if (typeof HTMLFormElement !== 'undefined' && el instanceof HTMLFormElement) {
    return true;
  }
  return (el as any).tagName?.toUpperCase?.() === 'FORM';
}

/**
 * Resolves the associated form element for a host element.
 * Checks explicit form attribute first per HTML5 spec, falling back to closest ancestor.
 * Supports both standard HTMLFormElement instances and compliant form facades.
 */
export function findAssociatedForm(element: HTMLElement | null): HTMLFormElement | null {
  if (!element) return null;

  const formId = typeof element.getAttribute === 'function' ? element.getAttribute('form') : null;
  if (formId && typeof document !== 'undefined') {
    const doc = element.ownerDocument || document;
    if (typeof doc?.getElementById === 'function') {
      const resolved = doc.getElementById(formId);
      if (isFormElement(resolved)) {
        return resolved as HTMLFormElement;
      }
    }
  }

  if (typeof element.closest === 'function') {
    const closest = element.closest('form');
    if (isFormElement(closest)) {
      return closest;
    }
  }

  return null;
}

/**
 * Resolves the first <legend> element child of a <fieldset>.
 * Per WHATWG HTML Section 4.10.19, only the first <legend> that is a DIRECT CHILD
 * of the <fieldset> represents the fieldset caption and can exempt form control descendants.
 */
export function getFirstLegendChild(fieldset: HTMLElement): HTMLElement | null {
  if (fieldset.children) {
    for (let i = 0; i < fieldset.children.length; i++) {
      const child = fieldset.children[i];
      if (child.tagName === 'LEGEND') {
        return child as HTMLElement;
      }
    }
    return null;
  }

  if (fieldset.childNodes) {
    for (let i = 0; i < fieldset.childNodes.length; i++) {
      const node = fieldset.childNodes[i];
      const isElementNode = typeof Node !== 'undefined' ? node.nodeType === Node.ELEMENT_NODE : node.nodeType === 1;
      if (isElementNode && (node as Element).tagName === 'LEGEND') {
        return node as HTMLElement;
      }
    }
  }

  if (typeof fieldset.querySelector === 'function') {
    try {
      const candidate = fieldset.querySelector(':scope > legend') || fieldset.querySelector('legend');
      if (candidate && candidate.parentElement === fieldset) {
        return candidate as HTMLElement;
      }
    } catch {
      const candidate = fieldset.querySelector('legend');
      if (candidate && candidate.parentElement === fieldset) {
        return candidate as HTMLElement;
      }
    }
  }

  return null;
}

/**
 * Checks if candidate is descendant of ancestor (or is ancestor itself).
 */
export function isDescendantOf(node: HTMLElement | null, ancestor: HTMLElement): boolean {
  if (!node) return false;
  if (node === ancestor) return true;
  if (typeof ancestor.contains === 'function') {
    return ancestor.contains(node as Node);
  }
  let curr = node.parentElement;
  while (curr) {
    if (curr === ancestor) return true;
    curr = curr.parentElement;
  }
  return false;
}

/**
 * Evaluates whether an element is inside the first <legend> child of a given <fieldset>.
 * WHATWG HTML 4.10.19: only the first legend child of a fieldset is exempt.
 */
export function isInsideFirstLegendOfFieldset(element: HTMLElement | null, fieldset: HTMLElement): boolean {
  if (!element) return false;
  const firstLegend = getFirstLegendChild(fieldset);
  if (!firstLegend) return false;
  return isDescendantOf(element, firstLegend);
}

/**
 * Evaluates whether an element is effectively disabled per WHATWG HTML standard.
 * Adheres strictly to the fieldset disabled inheritance rules including the <legend> descendant exemption.
 */
export function isElementFormDisabled(element: HTMLElement | null, ownDisabled = false): boolean {
  if (ownDisabled) return true;
  if (!element) return false;
  if (typeof element.hasAttribute === 'function' && element.hasAttribute('disabled')) return true;

  let curr = element.parentElement;
  while (curr) {
    if (curr.tagName === 'FIELDSET' && typeof curr.hasAttribute === 'function' && curr.hasAttribute('disabled')) {
      if (!isInsideFirstLegendOfFieldset(element, curr as HTMLElement)) {
        return true;
      }
    }
    curr = curr.parentElement;
  }

  return false;
}

/**
 * Attaches a MutationObserver to all ancestor fieldsets to observe disabled attribute mutations.
 */
export function attachFormDisabledObserver(hostElement: HTMLElement | null, getOwnDisabled: () => boolean, callback: (disabled: boolean) => void): () => void {
  if (!hostElement || typeof MutationObserver === 'undefined') {
    return () => {};
  }

  let lastDisabled = isElementFormDisabled(hostElement, getOwnDisabled());

  const observer = new MutationObserver(() => {
    const nextDisabled = isElementFormDisabled(hostElement, getOwnDisabled());
    if (nextDisabled !== lastDisabled) {
      lastDisabled = nextDisabled;
      callback(nextDisabled);
    }
  });

  let curr = hostElement.parentElement;
  while (curr) {
    if (curr.tagName === 'FIELDSET') {
      observer.observe(curr, { attributes: true, attributeFilter: ['disabled'] });
    }
    curr = curr.parentElement;
  }

  return () => {
    observer.disconnect();
  };
}

/**
 * Attaches a reset listener to the associated form element.
 * Returns a cleanup function that detaches the listener.
 */
export function attachFormResetListener(hostElement: HTMLElement | null, callback: () => void): () => void {
  if (!hostElement) return () => {};
  const form = findAssociatedForm(hostElement);
  if (!form || typeof form.addEventListener !== 'function') return () => {};

  form.addEventListener('reset', callback);
  return () => {
    if (typeof form.removeEventListener === 'function') {
      form.removeEventListener('reset', callback);
    }
  };
}

/**
 * Attaches unified form lifecycle coordination to a MorphHost instance.
 * Synchronizes form association, form reset callback, and ancestor fieldset disabled observations.
 */
export function attachFormLifecycle(host: MorphHost, hostElement: HTMLElement | null, getOwnDisabled: () => boolean): () => void {
  if (!hostElement) return () => {};

  const form = findAssociatedForm(hostElement);
  host._form = form;

  if (typeof (host as any).formAssociatedCallback === 'function') {
    try {
      (host as any).formAssociatedCallback(form);
    } catch (err) {
      console.error('Error in formAssociatedCallback:', err);
    }
  }

  const initialDisabled = isElementFormDisabled(hostElement, getOwnDisabled());
  host._currentFormDisabledState = initialDisabled;
  if (initialDisabled && typeof (host as any).formDisabledCallback === 'function') {
    try {
      (host as any).formDisabledCallback(true);
    } catch (err) {
      console.error('Error in initial formDisabledCallback:', err);
    }
  }

  const cleanReset = attachFormResetListener(hostElement, () => {
    if (typeof (host as any).formResetCallback === 'function') {
      try {
        (host as any).formResetCallback();
      } catch (err) {
        console.error('Error in formResetCallback:', err);
      }
    }
  });

  const cleanDisabled = attachFormDisabledObserver(hostElement, getOwnDisabled, (nextDisabled) => {
    if (nextDisabled !== host._currentFormDisabledState) {
      host._currentFormDisabledState = nextDisabled;
      if (typeof (host as any).formDisabledCallback === 'function') {
        try {
          (host as any).formDisabledCallback(nextDisabled);
        } catch (err) {
          console.error('Error in formDisabledCallback:', err);
        }
      }
    }
  });

  return () => {
    cleanReset();
    cleanDisabled();
    host._form = null;
    if (typeof (host as any).formAssociatedCallback === 'function') {
      try {
        (host as any).formAssociatedCallback(null);
      } catch (err) {
        console.error('Error in cleanup formAssociatedCallback:', err);
      }
    }
  };
}

/**
 * Synchronizes constraint validity from proxy element or host to target.
 */
export function forwardValidity(target: HTMLInputElement | null, customError: string | null): void {
  if (!target) return;
  target.setCustomValidity(customError || '');
}

/**
 * Synchronizes value to an input or textarea while preserving cursor selection.
 * Prevents cursor jumping to the end of input fields on active typing.
 */
export function syncInputValue(element: HTMLInputElement | HTMLTextAreaElement | null, value: string): void {
  if (!element) return;
  const normalizedValue = value ?? '';
  if (element.value === normalizedValue) return;

  if (typeof document !== 'undefined' && document.activeElement === element) {
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const direction = element.selectionDirection;

    element.value = normalizedValue;

    if (start !== null && end !== null) {
      element.setSelectionRange(start, end, direction || undefined);
    }
  } else {
    element.value = normalizedValue;
  }
}

/**
 * Synchronizes checked and indeterminate properties on an input checkbox/radio element.
 */
export function syncInputChecked(element: HTMLInputElement | null, checked: boolean, indeterminate = false): void {
  if (!element) return;
  if (element.checked !== checked) {
    element.checked = checked;
  }
  if (element.indeterminate !== indeterminate) {
    element.indeterminate = indeterminate;
  }
}
