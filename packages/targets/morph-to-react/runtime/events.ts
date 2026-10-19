/**
 * Event utilities for morph-to-react runtime.
 * Implements dual dispatch routing between native DOM events and React prop callbacks.
 */

/**
 * Converts a DOM event type to a React prop callback name.
 * Examples:
 * - 'click' -> 'onClick'
 * - 'cds-button-click' -> 'onCdsButtonClick'
 * - 'cds-checkbox-changed' -> 'onCdsCheckboxChanged'
 * - 'cds-tabs-selected' -> 'onCdsTabsSelected'
 */
export function toEventPropName(eventType: string): string {
  if (!eventType) return '';
  const parts = eventType.split(/[-_:]/);
  const capitalized = parts.map((part) => (part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1) : '')).join('');
  return `on${capitalized}`;
}

/**
 * Stops non-composed internal events at the host boundary in light DOM.
 * In Shadow DOM, non-composed events do not cross the shadow boundary.
 * In light DOM, this guard stops them from bubbling into parent component trees.
 */
export function stopNonComposedEvent(event: Event): void {
  if (!event.composed && typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }
}

/**
 * Attaches boundary guards to stop non-composed events from bubbling out of the host element.
 * Returns a cleanup function that detaches the listeners.
 */
export function attachHostBoundaryGuards(hostElement: HTMLElement): () => void {
  const handler = (event: Event) => {
    if (!event.composed && event.target !== hostElement) {
      event.stopPropagation();
    }
  };

  hostElement.addEventListener('focus', handler, true);
  hostElement.addEventListener('blur', handler, true);
  hostElement.addEventListener('change', handler, true);

  return () => {
    hostElement.removeEventListener('focus', handler, true);
    hostElement.removeEventListener('blur', handler, true);
    hostElement.removeEventListener('change', handler, true);
  };
}

/**
 * Creates a React 19 ref callback that attaches native DOM event listeners with cleanup.
 */
export function createNativeListenerRef(listeners: Record<string, EventListenerOrEventListenerObject | (AddEventListenerOptions & { handleEvent?: EventListener })>) {
  let controller: AbortController | null = null;

  return (node: HTMLElement | null) => {
    if (controller) {
      controller.abort();
      controller = null;
    }

    if (!node) return;

    controller = new AbortController();
    const { signal } = controller;

    for (const [type, listenerDef] of Object.entries(listeners)) {
      if (typeof listenerDef === 'function') {
        node.addEventListener(type, listenerDef, { signal });
      } else if (listenerDef && typeof listenerDef === 'object') {
        const { handleEvent, ...options } = listenerDef as any;
        if (typeof handleEvent === 'function') {
          node.addEventListener(type, handleEvent, { ...options, signal });
        }
      }
    }

    return () => {
      controller?.abort();
      controller = null;
    };
  };
}
