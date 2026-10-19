/**
 * Autonomous plain JavaScript base class replacing LitElement.
 * Does not extend HTMLElement, preventing Illegal Constructor errors in standard JS/React environments.
 * Implements Lit ReactiveControllerHost and provides DOM forwarding facade.
 */

import { stopNonComposedEvent, toEventPropName } from './events.js';

export interface ReactiveController {
  hostConnected?(): void;
  hostDisconnected?(): void;
  hostUpdate?(): void;
  hostUpdated?(): void;
}

export interface ReactiveControllerHost {
  addController(controller: ReactiveController): void;
  removeController(controller: ReactiveController): void;
  requestUpdate(name?: PropertyKey, oldValue?: unknown): void;
  readonly updateComplete: Promise<boolean>;
}

export interface ValidityStateFlags {
  badInput?: boolean;
  customError?: boolean;
  patternMismatch?: boolean;
  rangeOverflow?: boolean;
  rangeUnderflow?: boolean;
  stepMismatch?: boolean;
  tooLong?: boolean;
  tooShort?: boolean;
  typeMismatch?: boolean;
  valueMissing?: boolean;
}

export class MorphElementInternals {
  private _host: MorphHost;
  private _formValue: File | string | FormData | null = null;
  private _formState: File | string | FormData | null = null;
  _validityFlags: ValidityStateFlags = {};
  _validationMessage = '';
  _validationAnchor: HTMLElement | null = null;
  private _customStates: Set<string> = new Set();

  constructor(host: MorphHost) {
    this._host = host;
  }

  setFormValue(value: File | string | FormData | null, state?: File | string | FormData | null): void {
    this._formValue = value;
    this._formState = state ?? value;
    this._host._syncFormValueToProxy(value);
  }

  get formValue(): File | string | FormData | null {
    return this._formValue;
  }

  get formState(): File | string | FormData | null {
    return this._formState;
  }

  get form(): HTMLFormElement | null {
    return this._host.form;
  }

  setValidity(flags?: ValidityStateFlags, message?: string, anchor?: HTMLElement): void {
    const hasFlags = flags && Object.values(flags).some(Boolean);
    if (hasFlags && (!message || message.trim() === '')) {
      throw new TypeError("Failed to execute 'setValidity' on 'ElementInternals': The second argument is mandatory and must not be empty when flags are set.");
    }

    this._validityFlags = flags ? { ...flags } : {};
    this._validationMessage = hasFlags ? (message ?? '') : '';
    this._validationAnchor = anchor ?? null;

    this._host._syncValidityToProxy(this._validityFlags, this._validationMessage, this._validationAnchor);
  }

  get validity(): ValidityState {
    const flags = this._validityFlags;
    const badInput = Boolean(flags.badInput);
    const customError = Boolean(flags.customError);
    const patternMismatch = Boolean(flags.patternMismatch);
    const rangeOverflow = Boolean(flags.rangeOverflow);
    const rangeUnderflow = Boolean(flags.rangeUnderflow);
    const stepMismatch = Boolean(flags.stepMismatch);
    const tooLong = Boolean(flags.tooLong);
    const tooShort = Boolean(flags.tooShort);
    const typeMismatch = Boolean(flags.typeMismatch);
    const valueMissing = Boolean(flags.valueMissing);

    const isInvalid = badInput || customError || patternMismatch || rangeOverflow || rangeUnderflow || stepMismatch || tooLong || tooShort || typeMismatch || valueMissing;

    return {
      badInput,
      customError,
      patternMismatch,
      rangeOverflow,
      rangeUnderflow,
      stepMismatch,
      tooLong,
      tooShort,
      typeMismatch,
      valid: !isInvalid,
      valueMissing,
    };
  }

  get validationMessage(): string {
    return this.validity.valid ? '' : this._validationMessage;
  }

  get willValidate(): boolean {
    return this._host.willValidate;
  }

  checkValidity(): boolean {
    return this._host.checkValidity();
  }

  reportValidity(): boolean {
    return this._host.reportValidity();
  }

  get labels(): NodeList {
    if (this._host._proxyInput?.labels) {
      return this._host._proxyInput.labels;
    }
    const id = this._host.getAttribute('id');
    if (id && typeof document !== 'undefined') {
      return document.querySelectorAll(`label[for="${id}"]`);
    }
    return typeof document !== 'undefined' ? document.createDocumentFragment().childNodes : ([] as any);
  }

  get states(): CustomStateSet {
    return this._customStates as unknown as CustomStateSet;
  }

  get shadowRoot(): ShadowRoot | null {
    return null;
  }
}

export class MorphHost implements ReactiveControllerHost {
  static _propertyDefaults: Record<string, unknown> = {};

  _controllers: Set<ReactiveController> = new Set();
  _hostElement: HTMLElement | null = null;
  _props: Record<string, any> = {};
  _version = 0;
  _subscribers: Set<() => void> = new Set();
  _isUpdatePending = false;
  _hasUpdated = false;
  _isConnected = false;

  _internals: MorphElementInternals | null = null;
  _proxyInput: HTMLInputElement | null = null;
  _proxyInputRef = (node: HTMLInputElement | null) => {
    this._attachProxyInput(node);
  };
  _isFormAssociated = false;
  _currentFormDisabledState: boolean | null = null;
  _form: HTMLFormElement | null = null;

  _changedProperties: Map<PropertyKey, unknown> = new Map();

  private _resolveUpdateComplete!: (val: boolean) => void;
  _updateCompletePromise!: Promise<boolean>;

  constructor() {
    this._markUpdatePending();
  }

  /**
   * Arms a pending update and creates a fresh updateComplete promise if one is not already pending.
   */
  _markUpdatePending(): void {
    if (!this._isUpdatePending) {
      this._isUpdatePending = true;
      this._updateCompletePromise = new Promise((resolve) => {
        this._resolveUpdateComplete = resolve;
      });
    }
  }

  // =========================================================================
  // ReactiveControllerHost implementation
  // =========================================================================

  addController(controller: ReactiveController): void {
    this._controllers.add(controller);
    if (this._isConnected) {
      try {
        controller.hostConnected?.();
      } catch (err) {
        console.error('Error in controller hostConnected:', err);
      }
    }
  }

  removeController(controller: ReactiveController): void {
    this._controllers.delete(controller);
    try {
      controller.hostDisconnected?.();
    } catch (err) {
      console.error('Error in controller hostDisconnected:', err);
    }
  }

  requestUpdate(name?: PropertyKey, oldValue?: unknown): void {
    if (name !== undefined && !this._changedProperties.has(name)) {
      this._changedProperties.set(name, oldValue);
    }

    this._markUpdatePending();

    this._version++;
    for (const subscriber of this._subscribers) {
      try {
        subscriber();
      } catch (err) {
        console.error('Error in MorphHost subscriber:', err);
      }
    }
  }

  get updateComplete(): Promise<boolean> {
    return this._updateCompletePromise;
  }

  get isUpdatePending(): boolean {
    return this._isUpdatePending;
  }

  get hasUpdated(): boolean {
    return this._hasUpdated;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  _armUpdatePromise(): void {
    this._markUpdatePending();
  }

  // =========================================================================
  // Lifecycle hooks (invoked by useMorphHost coordination)
  // =========================================================================

  connectedCallback(): void {
    this._isConnected = true;
    for (const controller of this._controllers) {
      try {
        controller.hostConnected?.();
      } catch (err) {
        console.error('Error in controller hostConnected:', err);
      }
    }
  }

  disconnectedCallback(): void {
    this._isConnected = false;
    for (const controller of this._controllers) {
      try {
        controller.hostDisconnected?.();
      } catch (err) {
        console.error('Error in controller hostDisconnected:', err);
      }
    }
  }

  shouldUpdate(_changedProperties: Map<PropertyKey, unknown>): boolean {
    return true;
  }

  willUpdate(_changedProperties: Map<PropertyKey, unknown>): void {
    for (const controller of this._controllers) {
      try {
        controller.hostUpdate?.();
      } catch (err) {
        console.error('Error in controller hostUpdate:', err);
      }
    }
  }

  update(_changedProperties: Map<PropertyKey, unknown>): void {
    // Subclasses may perform pre-render updates
  }

  firstUpdated(_changedProperties: Map<PropertyKey, unknown>): void {
    this._hasUpdated = true;
  }

  updated(_changedProperties: Map<PropertyKey, unknown>): void {
    for (const controller of this._controllers) {
      try {
        controller.hostUpdated?.();
      } catch (err) {
        console.error('Error in controller hostUpdated:', err);
      }
    }
  }

  _commitUpdate(shouldRender = true): void {
    this._isUpdatePending = false;
    this._changedProperties.clear();
    if (this._resolveUpdateComplete) {
      this._resolveUpdateComplete(shouldRender);
    }
  }

  // =========================================================================
  // DOM facade forwarding to host DOM element
  // =========================================================================

  _eventListeners: Map<string, Set<EventListenerOrEventListenerObject>> = new Map();

  _attachHostElement(el: HTMLElement | null): void {
    this._hostElement = el;
    if (el) {
      if (this._isFormAssociated && !el.hasAttribute('tabindex')) {
        el.tabIndex = -1;
      }
      for (const [type, listeners] of this._eventListeners.entries()) {
        for (const listener of listeners) {
          el.addEventListener(type, listener);
        }
      }
    }
  }

  querySelector<E extends Element = Element>(selectors: string): E | null {
    if (!this._hostElement) return null;
    return this._hostElement.querySelector<E>(selectors);
  }

  querySelectorAll<E extends Element = Element>(selectors: string): NodeListOf<E> {
    if (!this._hostElement) {
      return document.createDocumentFragment().querySelectorAll<E>(selectors);
    }
    return this._hostElement.querySelectorAll<E>(selectors);
  }

  getAttribute(name: string): string | null {
    return typeof this._hostElement?.getAttribute === 'function' ? this._hostElement.getAttribute(name) : null;
  }

  setAttribute(name: string, value: string): void {
    if (typeof this._hostElement?.setAttribute === 'function') {
      this._hostElement.setAttribute(name, value);
    }
  }

  removeAttribute(name: string): void {
    if (typeof this._hostElement?.removeAttribute === 'function') {
      this._hostElement.removeAttribute(name);
    }
  }

  hasAttribute(name: string): boolean {
    return typeof this._hostElement?.hasAttribute === 'function' ? this._hostElement.hasAttribute(name) : false;
  }

  focus(options?: FocusOptions): void {
    if (this._hostElement && typeof this._hostElement.focus === 'function') {
      const hasTabIndex = typeof this._hostElement.hasAttribute === 'function' ? this._hostElement.hasAttribute('tabindex') : false;
      if (!hasTabIndex && 'tabIndex' in this._hostElement) {
        this._hostElement.tabIndex = -1;
      }
      this._hostElement.focus(options);
    }
  }

  blur(): void {
    if (this._hostElement && typeof this._hostElement.blur === 'function') {
      this._hostElement.blur();
    }
  }

  getBoundingClientRect(): DOMRect {
    if (this._hostElement && typeof this._hostElement.getBoundingClientRect === 'function') {
      return this._hostElement.getBoundingClientRect();
    }
    return typeof DOMRect !== 'undefined' ? new DOMRect() : ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as any);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
    if (!this._eventListeners.has(type)) {
      this._eventListeners.set(type, new Set());
    }
    this._eventListeners.get(type)?.add(listener);
    this._hostElement?.addEventListener(type, listener, options);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
    this._eventListeners.get(type)?.delete(listener);
    this._hostElement?.removeEventListener(type, listener, options);
  }

  /**
   * Dual dispatch: fires native DOM event on _hostElement and routes to on* React callback prop.
   * Passes the full CustomEvent object in compliance with Decision D6.
   * Honors event.preventDefault() canceling the event.
   */
  dispatchEvent(event: Event): boolean {
    let allowed = true;

    if (this._hostElement) {
      allowed = this._hostElement.dispatchEvent(event);
    } else {
      const listeners = this._eventListeners.get(event.type);
      if (listeners) {
        for (const listener of listeners) {
          try {
            if (typeof listener === 'function') {
              listener.call(this, event);
            } else if (typeof (listener as any)?.handleEvent === 'function') {
              (listener as any).handleEvent(event);
            }
          } catch (err) {
            console.error(`Error in event listener for ${event.type}:`, err);
          }
        }
      }
    }

    const propName = toEventPropName(event.type);
    if (this._props && typeof this._props[propName] === 'function') {
      try {
        this._props[propName](event);
      } catch (err) {
        console.error(`Error in event callback ${propName}:`, err);
      }
    }

    stopNonComposedEvent(event);

    return allowed && !event.defaultPrevented;
  }

  // =========================================================================
  // ElementInternals and Form Association Facade
  // =========================================================================

  attachInternals(): ElementInternals {
    if (this._internals) {
      throw new DOMException("Failed to execute 'attachInternals' on 'HTMLElement': ElementInternals for the given element already exists.", 'NotSupportedError');
    }
    const internals = new MorphElementInternals(this);
    this._internals = internals;
    this._isFormAssociated = true;
    if (this._hostElement && typeof this._hostElement.hasAttribute === 'function' && !this._hostElement.hasAttribute('tabindex')) {
      this._hostElement.tabIndex = -1;
    }
    return internals as unknown as ElementInternals;
  }

  _attachProxyInput(el: HTMLInputElement | null): void {
    if (this._proxyInput && this._proxyInput !== el) {
      this._proxyInput.removeEventListener('invalid', this._handleProxyInvalid);
      this._proxyInput.removeEventListener('focus', this._handleProxyFocus);
    }

    this._proxyInput = el;

    if (el) {
      if (this._internals) {
        this._syncFormValueToProxy(this._internals.formValue);
        const isInvalid = !this._internals.validity.valid;
        if (isInvalid) {
          this._syncValidityToProxy(this._internals._validityFlags, this._internals.validationMessage, this._internals._validationAnchor);
        }
      }
      el.addEventListener('invalid', this._handleProxyInvalid);
      el.addEventListener('focus', this._handleProxyFocus);
    }
  }

  _syncFormValueToProxy(value: any): void {
    if (!this._proxyInput) return;
    if (value === null || value === undefined) {
      this._proxyInput.value = '';
      this._proxyInput.defaultValue = '';
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const str = String(value);
      this._proxyInput.value = str;
      this._proxyInput.defaultValue = str;
    } else if (typeof File !== 'undefined' && value instanceof File) {
      try {
        const dt = new DataTransfer();
        dt.items.add(value);
        this._proxyInput.files = dt.files;
      } catch {
        // Fallback for environments without DataTransfer items.add
      }
    }
  }

  _syncValidityToProxy(flags: ValidityStateFlags, message: string, _anchor?: HTMLElement | null): void {
    if (!this._proxyInput) return;
    const isInvalid = Object.values(flags).some(Boolean);
    this._proxyInput.setCustomValidity(isInvalid ? message || 'Invalid field' : '');
  }

  private _handleProxyInvalid = (e: Event): void => {
    if (this._hostElement && typeof this._hostElement.dispatchEvent === 'function') {
      const invalidEvt = typeof Event !== 'undefined' ? new Event('invalid', { bubbles: false, cancelable: true }) : ({ type: 'invalid', cancelable: true, bubbles: false } as any);
      const notPrevented = this._hostElement.dispatchEvent(invalidEvt);
      if (!notPrevented) {
        e.preventDefault();
      }
    }
  };

  private _handleProxyFocus = (e: FocusEvent): void => {
    e.preventDefault();
    const anchor = this._internals?._validationAnchor;
    if (anchor && typeof anchor.focus === 'function') {
      const isHtmlElement = typeof HTMLElement !== 'undefined' && anchor instanceof HTMLElement;
      const hasTabIndex = typeof (anchor as any).hasAttribute === 'function' ? (anchor as any).hasAttribute('tabindex') : false;
      if ((isHtmlElement || (anchor as any).tagName) && !hasTabIndex) {
        (anchor as any).tabIndex = -1;
      }
      anchor.focus();
    } else if (this._hostElement && typeof this._hostElement.focus === 'function') {
      const hasTabIndex = typeof this._hostElement.hasAttribute === 'function' ? this._hostElement.hasAttribute('tabindex') : false;
      if (!hasTabIndex && 'tabIndex' in this._hostElement) {
        this._hostElement.tabIndex = -1;
      }
      this._hostElement.focus();
    }
  };

  get willValidate(): boolean {
    if (this.hasAttribute('disabled') || this._props?.disabled) {
      return false;
    }
    return true;
  }

  get validity(): ValidityState {
    if (this._internals) {
      return this._internals.validity;
    }
    if (this._proxyInput) {
      return this._proxyInput.validity;
    }
    return {
      badInput: false,
      customError: false,
      patternMismatch: false,
      rangeOverflow: false,
      rangeUnderflow: false,
      stepMismatch: false,
      tooLong: false,
      tooShort: false,
      typeMismatch: false,
      valid: true,
      valueMissing: false,
    };
  }

  get validationMessage(): string {
    return this._internals?.validationMessage ?? this._proxyInput?.validationMessage ?? '';
  }

  get form(): HTMLFormElement | null {
    return this._form ?? this._hostElement?.closest('form') ?? this._proxyInput?.form ?? null;
  }

  checkValidity(): boolean {
    if (!this.willValidate) return true;
    if (this._internals) {
      const valid = this._internals.validity.valid;
      if (!valid) {
        if (this._hostElement && typeof this._hostElement.dispatchEvent === 'function') {
          const event = typeof Event !== 'undefined' ? new Event('invalid', { bubbles: false, cancelable: true }) : ({ type: 'invalid', cancelable: true, bubbles: false } as any);
          this._hostElement.dispatchEvent(event);
        }
        return false;
      }
      return true;
    }
    if (this._proxyInput) {
      return this._proxyInput.checkValidity();
    }
    return true;
  }

  reportValidity(): boolean {
    if (!this.willValidate) return true;
    const valid = this.checkValidity();
    if (valid) return true;

    const anchor = this._internals?._validationAnchor;
    if (anchor && typeof anchor.focus === 'function') {
      const isHtmlElement = typeof HTMLElement !== 'undefined' && anchor instanceof HTMLElement;
      const hasTabIndex = typeof (anchor as any).hasAttribute === 'function' ? (anchor as any).hasAttribute('tabindex') : false;
      if ((isHtmlElement || (anchor as any).tagName) && !hasTabIndex) {
        (anchor as any).tabIndex = -1;
      }
      anchor.focus();
    } else if (this._hostElement && typeof this._hostElement.focus === 'function') {
      const hasTabIndex = typeof this._hostElement.hasAttribute === 'function' ? this._hostElement.hasAttribute('tabindex') : false;
      if (!hasTabIndex && 'tabIndex' in this._hostElement) {
        this._hostElement.tabIndex = -1;
      }
      this._hostElement.focus();
    }
    return false;
  }

  // =========================================================================
  // Form lifecycle callbacks (default no-ops, overridden by component author)
  // =========================================================================

  formResetCallback(): void {
    // Default no-op
  }

  formDisabledCallback(_disabled: boolean): void {
    // Default no-op
  }

  formStateRestoreCallback(_state: unknown, _mode: 'restore' | 'autocomplete'): void {
    // Default no-op
  }

  formAssociatedCallback(_form: HTMLFormElement | null): void {
    // Default no-op
  }
}
