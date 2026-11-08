/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Unified Declarative Shadow DOM and Lit template hydration runtime for @lit-core/resumable.
 */

import * as litHtmlNs from 'lit/html.js';
import { createHydrationRuntime } from './hydrate-core.js';

const runtime = createHydrationRuntime((litHtmlNs as any)._$LH);

export interface HydrateRootOptions {
  host?: object;
  renderBefore?: ChildNode | null;
  creationScope?: { importNode(node: Node, deep?: boolean): Node };
  isConnected?: boolean;
}

export interface HydratedTemplateRoot {
  container: DocumentFragment | HTMLElement | Element;
  rootSlot: any;
  ctx: any;
  rootPart: any;
}

export const hydrate: (rootValue: unknown, container: Element | DocumentFragment, options?: HydrateRootOptions) => any = runtime.hydrate;
export const hydrateTemplateRoot: (templateResult: unknown, container: DocumentFragment | HTMLElement | Element, options?: HydrateRootOptions) => HydratedTemplateRoot | null =
  runtime.hydrateTemplateRoot;
export const updateHydratedRoot: (hydrated: HydratedTemplateRoot, nextResult: unknown) => boolean = runtime.updateHydratedRoot;
export const restoreStateFromHostAttribute: (host: HTMLElement) => Record<string, unknown> | null = runtime.restoreStateFromHostAttribute;
export const hydrateShadowRoots: (root?: Document | DocumentFragment | Element) => void = runtime.hydrateShadowRoots;
export const bindDataActionDelegation: (root: DocumentFragment | HTMLElement | Element, host: any) => void = runtime.bindDataActionDelegation;
export const digestForTemplateResult: (templateResult: any) => string = runtime.digestForTemplateResult;
export const patchPrototypeForHydration: (targetProto: any) => void = runtime.patchPrototypeForHydration;
export const installLitHydrationSupport: (LitElementOrReactiveElementClass?: any) => void = runtime.installLitHydrationSupport;
export const parseComponentStateInternal: (rawState: string) => Record<string, unknown> = runtime.parseComponentState;
export const withResumableInternal: <T extends new (...args: any[]) => any>(Base: T) => T = runtime.withResumable;
export const bindTemplateEventHandlersInternal: (shadowRoot: DocumentFragment | HTMLElement | Element, templateResult: any, host: any) => HydratedTemplateRoot | null =
  runtime.bindTemplateEventHandlers;
export const RESUMED_EVENT_FLAG_INTERNAL: string = runtime.RESUMED_EVENT_FLAG;
export const createReplayedEventInternal: (origEvent: Event) => Event = runtime.createReplayedEvent;
export const replayEventInternal: (buffered: any) => boolean = runtime.replayEvent;
export const replayQueueInternal: (queue: any[]) => void = runtime.replayQueue;
