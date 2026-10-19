import buttonStylesRaw from '@carbon/web-components/es/components/button/button.scss.js';
import type React from 'react';
import { forwardRef, useId, useRef } from 'react';
import { transformHostCss } from '../../runtime/css.js';
import { MorphHost } from '../../runtime/morph-host.js';
import { partitionSlots } from '../../runtime/slots.js';
import { useMorphHost } from '../../runtime/use-morph-host.js';

export const buttonStyles = transformHostCss((buttonStylesRaw as any).cssText, 'cds-button').replace(/::slotted\(([^)]+)\)/g, '$1');

export const buttonStylesHref = 'carbon-cds-button';

export class CDSButtonHost extends MorphHost {
  autofocus = false;
  batchAction = false;
  buttonClassName = '';
  dangerDescription = '';
  disabled = false;
  download = '';
  hasMainContent = false;
  href = '';
  hreflang = '';
  isExpressive = false;
  isSelected = false;
  kind = 'primary';
  linkRole = 'button';
  openTooltip = false;
  ping = '';
  rel = '';
  size = 'lg';
  tabIndex = 0;
  target = '';
  tooltipAlignment = '';
  tooltipPosition = 'top';
  tooltipText = '';
  type = 'button';

  _hasIcon = false;

  static readonly _propertyDefaults = {
    autofocus: false,
    batchAction: false,
    buttonClassName: '',
    dangerDescription: '',
    disabled: false,
    download: '',
    hasMainContent: false,
    href: '',
    hreflang: '',
    isExpressive: false,
    isSelected: false,
    kind: 'primary',
    linkRole: 'button',
    openTooltip: false,
    ping: '',
    rel: '',
    size: 'lg',
    tabIndex: 0,
    target: '',
    tooltipAlignment: '',
    tooltipPosition: 'top',
    tooltipText: '',
    type: 'button',
  };

  _handleOver = () => {
    this.openTooltip = true;
    this.requestUpdate('openTooltip');
  };

  _handleHoverOut = () => {
    this.openTooltip = false;
    this.requestUpdate('openTooltip');
  };

  _handleFocus = () => {
    this.openTooltip = true;
    this.requestUpdate('openTooltip');
  };

  _handleFocusout = () => {
    this.openTooltip = false;
    this.requestUpdate('openTooltip');
  };

  _handleDisabledClick = (event: MouseEvent) => {
    if (this.disabled) {
      event.stopPropagation();
      event.preventDefault();
    }
  };

  _checkBadgeWarning() {
    if (this._hostElement?.querySelector('cds-badge-indicator') && (this.kind !== 'ghost' || this.size !== 'lg')) {
      console.warn("The badge indicator must be used with kind='ghost' and size='lg'");
    }
  }

  override updated(changedProperties: Map<PropertyKey, unknown>) {
    super.updated(changedProperties);
    this._checkBadgeWarning();
  }

  override focus(options?: FocusOptions) {
    if (this._hostElement) {
      const delegateTarget = this._hostElement.querySelector<HTMLElement>('button, a, [tabindex]:not([tabindex="-1"])');
      if (delegateTarget) {
        delegateTarget.focus(options);
        return;
      }
      super.focus(options);
    }
  }

  click() {
    if (this._hostElement) {
      const target = this._hostElement.querySelector<HTMLElement>('button, a');
      target?.click();
    }
  }
}

export interface CdsButtonProps extends React.HTMLAttributes<HTMLElement> {
  autofocus?: boolean;
  batchAction?: boolean;
  buttonClassName?: string;
  dangerDescription?: string;
  disabled?: boolean;
  download?: string;
  hasMainContent?: boolean;
  href?: string;
  hreflang?: string;
  isExpressive?: boolean;
  isSelected?: boolean;
  kind?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'danger-tertiary' | 'danger-ghost' | 'ghost';
  linkRole?: string;
  openTooltip?: boolean;
  ping?: string;
  rel?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  tabIndex?: number;
  target?: string;
  tooltipAlignment?: 'start' | 'center' | 'end' | '';
  tooltipPosition?: 'top' | 'right' | 'bottom' | 'left';
  tooltipText?: string;
  type?: 'button' | 'reset' | 'submit';
  icon?: React.ReactNode;
  badgeIndicator?: React.ReactNode;
  children?: React.ReactNode;
  onCdsButtonClick?: (e: CustomEvent) => void;
}

export const CdsButton = forwardRef<HTMLElement, CdsButtonProps>(function CdsButton(props, forwardedRef) {
  const { children, icon, badgeIndicator, onClick } = props;

  const { host, elementRef } = useMorphHost(CDSButtonHost, props, forwardedRef);

  // Partition slot children deterministically in React
  const { defaultChildren, namedSlots } = partitionSlots(children);
  const slottedIcon = namedSlots.icon?.[0] || null;
  const slottedBadgeIndicator = namedSlots['badge-indicator']?.[0] || null;
  const hasIcon = Boolean(icon || slottedIcon);
  const hasMainContent = defaultChildren.length > 0;

  host._hasIcon = hasIcon;
  host.hasMainContent = hasMainContent;

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (host.disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    onClick?.(event);

    if (!event.defaultPrevented) {
      const customEvent = new CustomEvent('cds-button-click', {
        bubbles: true,
        composed: true,
        detail: { event },
      });
      host.dispatchEvent(customEvent);
    }
  };

  const cleanupControllerRef = useRef<AbortController | null>(null);

  const nativeListenersRef = (node: HTMLElement | null) => {
    if (cleanupControllerRef.current) {
      cleanupControllerRef.current.abort();
      cleanupControllerRef.current = null;
    }
    if (!node) return;

    const controller = new AbortController();
    cleanupControllerRef.current = controller;
    const { signal } = controller;

    node.addEventListener('click', host._handleDisabledClick as EventListener, { capture: true, signal });
    node.addEventListener('mouseover', host._handleOver, { signal });
    node.addEventListener('mouseout', host._handleHoverOut, { signal });
    node.addEventListener('focus', host._handleFocus, { signal });
    node.addEventListener('focusout', host._handleFocusout, { signal });

    return () => {
      controller.abort();
    };
  };

  const combinedRef = (node: HTMLElement | null) => {
    elementRef(node);
    if (node) {
      Object.defineProperties(node, {
        click: {
          value: () => host.click(),
          configurable: true,
          writable: true,
        },
        focus: {
          value: (options?: FocusOptions) => host.focus(options),
          configurable: true,
          writable: true,
        },
        disabled: {
          get: () => host.disabled,
          set: (v: boolean) => {
            host.disabled = v;
            host.requestUpdate('disabled');
          },
          configurable: true,
        },
        kind: {
          get: () => host.kind,
          set: (v: string) => {
            host.kind = v;
            host.requestUpdate('kind');
          },
          configurable: true,
        },
        size: {
          get: () => host.size,
          set: (v: string) => {
            host.size = v;
            host.requestUpdate('size');
          },
          configurable: true,
        },
      });
      nativeListenersRef(node);
    } else {
      nativeListenersRef(null);
    }
  };

  const {
    kind = 'primary',
    size = 'lg',
    disabled = false,
    isSelected = false,
    isExpressive = false,
    buttonClassName,
    href,
    linkRole = 'button',
    download,
    hreflang,
    ping,
    rel,
    target,
    type = 'button',
    tabIndex = 0,
    tooltipText,
    tooltipPosition = 'top',
    tooltipAlignment = '',
    openTooltip = host.openTooltip,
    autofocus = false,
    dangerDescription,
  } = host;

  const isIconOnly = hasIcon && !hasMainContent;
  const isGhostIconOnly = isIconOnly && kind === 'ghost';
  const ariaPressed = isGhostIconOnly && isSelected ? true : undefined;

  const defaultClasses: Record<string, boolean | undefined> = {
    'cds--btn': true,
    [`cds--btn--${kind}`]: Boolean(kind),
    'cds--btn--danger--tertiary': kind === 'danger-tertiary',
    'cds--btn--danger--ghost': kind === 'danger-ghost',
    'cds--btn--disabled': disabled,
    'cds--btn--icon-only': isIconOnly,
    [`cds--btn--${size}`]: Boolean(size),
    [`cds--layout--size-${size}`]: Boolean(size),
    'cds-ce--btn--has-icon': hasIcon,
    'cds--btn--expressive': isExpressive,
    'cds--btn--selected': isGhostIconOnly && isSelected,
  };

  if (buttonClassName) {
    for (const cls of buttonClassName.split(' ')) {
      if (cls) defaultClasses[cls] = true;
    }
  }

  const classes = Object.entries(defaultClasses)
    .filter(([_, active]) => Boolean(active))
    .map(([cls]) => cls)
    .join(' ');

  const hasDangerDescription = kind?.includes('danger') && Boolean(dangerDescription);
  const dangerDescriptionId = useId();

  const iconElement = icon || slottedIcon;
  const badgeElement = badgeIndicator || slottedBadgeIndicator;

  let innerContent: React.ReactNode;

  if (href) {
    if (disabled) {
      innerContent = (
        <p id="button" part="button" className={classes}>
          {defaultChildren}
          {iconElement}
        </p>
      );
    } else {
      innerContent = (
        <>
          <a
            id="button"
            part="button"
            role={linkRole}
            className={classes}
            download={download || undefined}
            href={href || undefined}
            hrefLang={hreflang || undefined}
            ping={ping || undefined}
            rel={rel || undefined}
            target={target || undefined}
            type={type || undefined}
            tabIndex={tabIndex}
            aria-describedby="badge-indicator"
          >
            {defaultChildren}
            {iconElement}
          </a>
          {!disabled && badgeElement}
        </>
      );
    }
  } else if (tooltipText && !disabled) {
    const alignmentClass = tooltipAlignment && (tooltipPosition === 'top' || tooltipPosition === 'bottom') ? `-${tooltipAlignment}` : '';

    const tooltipClasses = [
      'cds--popover-container',
      'cds--popover--caret',
      'cds--popover--high-contrast',
      'cds--tooltip',
      hasIcon ? 'cds--icon-tooltip' : '',
      openTooltip ? 'cds--popover--open' : '',
      `cds--popover--${tooltipPosition}${alignmentClass}`,
    ]
      .filter(Boolean)
      .join(' ');

    innerContent = (
      <span className={tooltipClasses}>
        <button
          id="button"
          part="button"
          className={classes}
          // biome-ignore lint/a11y/noAutofocus: Carbon button specification preserves autofocus attribute
          autoFocus={autofocus}
          disabled={disabled}
          tabIndex={tabIndex}
          type={type as any}
          aria-label={tooltipText}
          aria-pressed={ariaPressed}
          aria-describedby="badge-indicator"
        >
          {defaultChildren}
          {iconElement}
        </button>
        <span className="cds--popover">
          <span className="cds--popover-content cds--tooltip-content">{tooltipText}</span>
          <span className="cds--popover-caret" />
        </span>
        {!disabled && badgeElement}
      </span>
    );
  } else {
    innerContent = (
      <>
        <button
          id="button"
          part="button"
          className={classes}
          // biome-ignore lint/a11y/noAutofocus: Carbon button specification preserves autofocus attribute
          autoFocus={autofocus}
          disabled={disabled}
          tabIndex={tabIndex}
          type={type as any}
          aria-label={tooltipText || undefined}
          aria-pressed={ariaPressed}
          aria-describedby={hasDangerDescription ? dangerDescriptionId : undefined}
        >
          {hasDangerDescription && (
            <span id={dangerDescriptionId} className="cds--visually-hidden">
              {dangerDescription}
            </span>
          )}
          {defaultChildren}
          {iconElement}
        </button>
        {!disabled && badgeElement}
      </>
    );
  }

  const ariaAndDataProps: Record<string, any> = {};
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('data-') || k.startsWith('aria-')) {
      ariaAndDataProps[k] = v;
    }
  }

  return (
    <cds-button
      ref={combinedRef}
      id={props.id}
      className={props.className}
      kind={kind}
      size={size}
      disabled={disabled ? '' : undefined}
      href={href || undefined}
      tab-index={tabIndex}
      has-main-content={hasMainContent ? '' : undefined}
      is-expressive={isExpressive ? '' : undefined}
      is-selected={isSelected ? '' : undefined}
      style={{ display: 'inline-flex', ...props.style }}
      onClick={handleClick}
      {...ariaAndDataProps}
    >
      <style href={buttonStylesHref} precedence="default">
        {buttonStyles}
      </style>
      {innerContent}
    </cds-button>
  );
});
