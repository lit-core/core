import React, { Children, Fragment, isValidElement, type ReactNode } from 'react';

export { isValidElement };

export interface PartitionedSlots {
  defaultChildren: ReactNode[];
  namedSlots: Record<string, ReactNode[]>;
}

/**
 * Partitions child elements into default and named slot buckets.
 * Recursively flattens fragments so slot="..." on fragments or nested elements works as expected.
 */
export function partitionSlots(children: ReactNode): PartitionedSlots {
  const defaultChildren: ReactNode[] = [];
  const namedSlots: Record<string, ReactNode[]> = {};

  function traverse(nodes: ReactNode) {
    Children.forEach(nodes, (child) => {
      if (child === null || child === undefined || child === false || child === '') {
        return;
      }
      if (isValidElement(child)) {
        if (child.type === Fragment) {
          traverse((child.props as any)?.children);
          return;
        }
        const slot = (child.props as any)?.slot;
        if (typeof slot === 'string' && slot.length > 0) {
          if (!namedSlots[slot]) {
            namedSlots[slot] = [];
          }
          namedSlots[slot].push(child);
          return;
        }
      }
      defaultChildren.push(child);
    });
  }

  traverse(children);

  return {
    defaultChildren,
    namedSlots,
  };
}

/**
 * Zero-box slot boundary component.
 * Uses display: contents to avoid introducing box formatting contexts,
 * while providing an observable DOM anchor for MutationObserver or slot queries.
 */
export interface SlotBoundaryProps extends React.HTMLAttributes<HTMLElement> {
  onSlotChange?: (e: Event) => void;
  onSlotchange?: (e: Event) => void;
}

export function augmentSlotBoundaryNode(node: HTMLElement): void {
  if (!('assignedElements' in node)) {
    Object.defineProperty(node, 'assignedElements', {
      value: function assignedElements(options?: { flatten?: boolean }): Element[] {
        const elements: Element[] = [];
        for (let i = 0; i < this.children.length; i++) {
          const child = this.children[i];
          if (child.tagName.toLowerCase() === 'slot-boundary' && options?.flatten) {
            elements.push(...(child as any).assignedElements(options));
          } else {
            elements.push(child);
          }
        }
        return elements;
      },
      configurable: true,
      writable: true,
    });
  }

  if (!('assignedNodes' in node)) {
    Object.defineProperty(node, 'assignedNodes', {
      value: function assignedNodes(options?: { flatten?: boolean }): Node[] {
        const nodes: Node[] = [];
        for (let i = 0; i < this.childNodes.length; i++) {
          const child = this.childNodes[i];
          const isElementNode = typeof Node !== 'undefined' ? child.nodeType === Node.ELEMENT_NODE : child.nodeType === 1;
          if (isElementNode && (child as Element).tagName.toLowerCase() === 'slot-boundary' && options?.flatten) {
            nodes.push(...(child as any).assignedNodes(options));
          } else {
            nodes.push(child);
          }
        }
        return nodes;
      },
      configurable: true,
      writable: true,
    });
  }
}

/**
 * Attaches a MutationObserver to the slot boundary element to dispatch synthetic slotchange events,
 * and augments the element with HTMLSlotElement facade methods (.assignedElements(), .assignedNodes()).
 */
export function attachSlotBoundary(node: HTMLElement | null, onSlotChange?: (e: Event) => void): (() => void) | undefined {
  if (!node) return;

  augmentSlotBoundaryNode(node);

  if (typeof MutationObserver === 'undefined') return;

  const observer = new MutationObserver(() => {
    const event = new CustomEvent('slotchange', {
      bubbles: false,
      cancelable: false,
    });
    node.dispatchEvent(event);
    if (typeof onSlotChange === 'function') {
      try {
        onSlotChange(event);
      } catch (err) {
        console.error('Error in onSlotChange handler:', err);
      }
    }
  });

  observer.observe(node, {
    childList: true,
    subtree: false,
  });

  return () => {
    observer.disconnect();
  };
}

export const SlotBoundary = React.forwardRef<HTMLElement, SlotBoundaryProps>(function SlotBoundary(props, forwardedRef) {
  const { children, style, onSlotChange, onSlotchange, ...rest } = props;
  const slotChangeHandler = onSlotChange || onSlotchange;
  const innerRef = React.useRef<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node) return;
    return attachSlotBoundary(node, slotChangeHandler);
  }, [slotChangeHandler]);

  const setRef = React.useCallback(
    (node: HTMLElement | null) => {
      innerRef.current = node;
      if (node) {
        augmentSlotBoundaryNode(node);
      }
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef && 'current' in forwardedRef) {
        (forwardedRef as any).current = node;
      }
    },
    [forwardedRef],
  );

  return React.createElement(
    'slot-boundary',
    {
      ref: setRef,
      'data-slot-boundary': '',
      style: { display: 'contents', ...style },
      ...rest,
    },
    children,
  );
});
