import checkboxStylesRaw from '@carbon/web-components/es/components/checkbox/checkbox.scss.js';
import type React from 'react';
import { Children, forwardRef, isValidElement, type MouseEvent, type ReactNode, useCallback, useId, useLayoutEffect } from 'react';
import { transformHostCss } from '../../runtime/css.js';
import { MorphHost } from '../../runtime/morph-host.js';
import { useMorphHost } from '../../runtime/use-morph-host.js';

export const checkboxStyles = transformHostCss((checkboxStylesRaw as any).cssText, 'cds-checkbox').replace(/::slotted\(([^)]+)\)/g, '$1');

export const checkboxStylesHref = 'carbon-cds-checkbox';

function WarningFilled16(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg focusable="false" preserveAspectRatio="xMidYMid meet" fill="currentColor" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path d="M8,1C4.1,1,1,4.1,1,8s3.1,7,7,7s7-3.1,7-7S11.9,1,8,1z M7.4,4h1.2v5H7.4V4z M8,12c-0.4,0-0.8-0.3-0.8-0.8 c0-0.4,0.3-0.8,0.8-0.8s0.8,0.3,0.8,0.8C8.8,11.7,8.4,12,8,12z" />
    </svg>
  );
}

function WarningAltFilled16(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg focusable="false" preserveAspectRatio="xMidYMid meet" fill="currentColor" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path d="M8.7 1.3c-.4-.4-1-.4-1.4 0l-6 12c-.2.4-.2.8 0 1.2.2.4.6.5 1 .5h12c.4 0 .8-.1 1-.5.2-.4.2-.8 0-1.2l-6-12zM7.4 5h1.2v4H7.4V5zm.6 8c-.4 0-.8-.4-.8-.8s.4-.8.8-.8.8.4.8.8-.4.8-.8.8z" />
    </svg>
  );
}

export class CdsCheckboxHost extends MorphHost {
  checked = false;
  defaultChecked = false;
  dataTable = false;
  disabled = false;
  helperText: string | null = null;
  hideCheckbox = false;
  hideLabel = false;
  id = 'checkbox';
  indeterminate = false;
  labelText = '';
  name?: string;
  readonly = false;
  invalid = false;
  invalidText?: string;
  title = '';
  value = 'on';
  warn = false;
  warnText?: string;
  _hasAILabel = false;

  _checkboxNode: HTMLInputElement | null = null;

  static readonly _propertyDefaults = {
    checked: false,
    defaultChecked: false,
    dataTable: false,
    disabled: false,
    helperText: null,
    hideCheckbox: false,
    hideLabel: false,
    id: 'checkbox',
    indeterminate: false,
    labelText: '',
    name: undefined,
    readonly: false,
    invalid: false,
    invalidText: undefined,
    title: '',
    value: 'on',
    warn: false,
    warnText: undefined,
  };

  static get eventChange() {
    return 'cds-checkbox-changed';
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.defaultChecked) {
      this.checked = this.defaultChecked;
    }
  }

  _handleChange() {
    if (!this._checkboxNode) return;
    const { checked, indeterminate } = this._checkboxNode;
    this.checked = checked;
    this.indeterminate = indeterminate;

    const event = new CustomEvent(CdsCheckboxHost.eventChange, {
      bubbles: true,
      composed: true,
      detail: {
        checked,
        indeterminate,
      },
    });

    this.dispatchEvent(event);
    this.requestUpdate('checked');
  }

  _handleClick(event: MouseEvent) {
    if (this.readonly) {
      event.preventDefault();
    }
  }

  override focus(options?: FocusOptions) {
    if (this._checkboxNode) {
      this._checkboxNode.focus(options);
    } else {
      super.focus(options);
    }
  }

  override blur() {
    if (this._checkboxNode) {
      this._checkboxNode.blur();
    } else {
      super.blur();
    }
  }

  click() {
    if (this._checkboxNode) {
      this._checkboxNode.click();
    }
  }
}

export interface CdsCheckboxProps extends React.HTMLAttributes<HTMLElement> {
  checked?: boolean;
  defaultChecked?: boolean;
  dataTable?: boolean;
  disabled?: boolean;
  helperText?: ReactNode;
  hideCheckbox?: boolean;
  hideLabel?: boolean;
  id?: string;
  indeterminate?: boolean;
  invalid?: boolean;
  invalidText?: ReactNode;
  labelText?: string;
  name?: string;
  readonly?: boolean;
  title?: string;
  value?: string;
  warn?: boolean;
  warnText?: ReactNode;

  aiLabel?: ReactNode;
  decorator?: ReactNode;
  slug?: ReactNode;
  children?: ReactNode;

  onCdsCheckboxChanged?: (event: CustomEvent<{ checked: boolean; indeterminate: boolean }>) => void;
}

export const CdsCheckbox = forwardRef<HTMLElement, CdsCheckboxProps>(function CdsCheckbox(props, forwardedRef) {
  const generatedId = useId();
  const inputId = props.id || generatedId;

  const { host, elementRef } = useMorphHost(CdsCheckboxHost, props, forwardedRef);

  const normalizedProps = {
    invalid: !host.readonly && !host.disabled && host.invalid,
    warn: !host.readonly && !host.invalid && !host.disabled && host.warn,
  };
  const showHelper = !normalizedProps.invalid && !normalizedProps.warn;

  // Ref callback on native input
  const inputRef = useCallback(
    (el: HTMLInputElement | null) => {
      host._checkboxNode = el;
      if (!el) return;

      el.checked = host.checked;
      el.indeterminate = host.indeterminate;

      const onNativeChange = () => host._handleChange();
      const onNativeClick = (e: any) => host._handleClick(e);

      el.addEventListener('change', onNativeChange);
      el.addEventListener('click', onNativeClick);

      return () => {
        el.removeEventListener('change', onNativeChange);
        el.removeEventListener('click', onNativeClick);
        if (host._checkboxNode === el) {
          host._checkboxNode = null;
        }
      };
    },
    [host],
  );

  // Keep DOM input properties in sync after commit
  useLayoutEffect(() => {
    const el = host._checkboxNode;
    if (el) {
      if (el.checked !== host.checked) {
        el.checked = host.checked;
      }
      if (el.indeterminate !== host.indeterminate) {
        el.indeterminate = host.indeterminate;
      }
    }
  }, [host.checked, host.indeterminate, host._checkboxNode]);

  // Reflect boolean attributes onto host element to prevent React 19 Custom Element IDL property overwrite
  useLayoutEffect(() => {
    const hostEl = host._hostElement;
    if (!hostEl) return;

    if (host.checked) hostEl.setAttribute('checked', '');
    else hostEl.removeAttribute('checked');

    if (host.indeterminate) hostEl.setAttribute('indeterminate', '');
    else hostEl.removeAttribute('indeterminate');

    if (host.disabled) hostEl.setAttribute('disabled', '');
    else hostEl.removeAttribute('disabled');

    if (host.readonly) hostEl.setAttribute('readonly', '');
    else hostEl.removeAttribute('readonly');
  }, [host.checked, host.indeterminate, host.disabled, host.readonly, host._hostElement]);

  // Form reset support
  useLayoutEffect(() => {
    const hostEl = host._hostElement;
    if (!hostEl) return;
    const form = hostEl.closest('form');
    if (!form) return;

    const handleReset = () => {
      host.checked = host.defaultChecked ?? false;
      host.indeterminate = false;
      if (host._checkboxNode) {
        host._checkboxNode.checked = host.checked;
        host._checkboxNode.indeterminate = false;
      }
      host.requestUpdate('checked');
    };

    form.addEventListener('reset', handleReset);
    return () => {
      form.removeEventListener('reset', handleReset);
    };
  }, [host, host.defaultChecked]);

  // Combined host element ref with own properties
  const combinedRef = (node: HTMLElement | null) => {
    if (node) {
      Object.defineProperties(node, {
        checked: {
          get: () => host.checked,
          set: (v: boolean | string | undefined) => {
            if (v === undefined || v === '') return;
            const bool = Boolean(v);
            if (host.checked !== bool) {
              host.checked = bool;
              if (host._checkboxNode) host._checkboxNode.checked = bool;
              host.requestUpdate('checked');
            }
          },
          configurable: true,
        },
        indeterminate: {
          get: () => host.indeterminate,
          set: (v: boolean | string | undefined) => {
            if (v === undefined || v === '') return;
            const bool = Boolean(v);
            if (host.indeterminate !== bool) {
              host.indeterminate = bool;
              if (host._checkboxNode) host._checkboxNode.indeterminate = bool;
              host.requestUpdate('indeterminate');
            }
          },
          configurable: true,
        },
        disabled: {
          get: () => host.disabled,
          set: (v: boolean | string | undefined) => {
            if (v === undefined || v === '') return;
            const bool = Boolean(v);
            if (host.disabled !== bool) {
              host.disabled = bool;
              host.requestUpdate('disabled');
            }
          },
          configurable: true,
        },
        value: {
          get: () => host.value,
          set: (v: string) => {
            host.value = v;
            host.requestUpdate('value');
          },
          configurable: true,
        },
        name: {
          get: () => host.name,
          set: (v: string | undefined) => {
            host.name = v;
            host.requestUpdate('name');
          },
          configurable: true,
        },
        focus: {
          value: (options?: FocusOptions) => host.focus(options),
          configurable: true,
          writable: true,
        },
        blur: {
          value: () => host.blur(),
          configurable: true,
          writable: true,
        },
        click: {
          value: () => host.click(),
          configurable: true,
          writable: true,
        },
      });
    }
    elementRef(node);
  };

  // AI label detection
  const hasAILabel = Boolean(
    props.aiLabel ||
      props.decorator ||
      props.slug ||
      Children.toArray(props.children).some((c) => isValidElement(c) && ((c.props as any).slot === 'ai-label' || (c.props as any).slot === 'decorator' || (c.props as any).slot === 'slug')),
  );

  const labelClasses = 'cds--checkbox-label';
  const labelTextClasses = `cds--checkbox-label-text ${host.hideLabel ? 'cds--visually-hidden' : ''}`.trim();

  const labelContent = host.labelText || Children.toArray(props.children).filter((c) => !isValidElement(c) || !(c.props as any).slot);

  const ariaAndDataProps: Record<string, any> = {};
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('data-') || k.startsWith('aria-')) {
      ariaAndDataProps[k] = v;
    }
  }

  return (
    <>
      <style href={checkboxStylesHref} precedence="default">
        {checkboxStyles}
      </style>
      <cds-checkbox
        ref={combinedRef}
        id={props.id}
        checked={host.checked ? '' : undefined}
        disabled={host.disabled ? '' : undefined}
        invalid={normalizedProps.invalid ? '' : undefined}
        warn={normalizedProps.warn ? '' : undefined}
        data-table={host.dataTable ? '' : undefined}
        hide-checkbox={host.hideCheckbox ? '' : undefined}
        hide-label={host.hideLabel ? '' : undefined}
        ai-label={hasAILabel ? '' : undefined}
        className={props.className}
        style={props.style}
        {...ariaAndDataProps}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="checkbox"
          className="cds--checkbox"
          aria-readonly={Boolean(host.readonly)}
          defaultChecked={host.defaultChecked || host.checked}
          data-invalid={normalizedProps.invalid ? '' : undefined}
          disabled={host.disabled}
          name={host.name}
          value={host.value}
        />
        <label htmlFor={inputId} className={labelClasses} title={host.title || undefined}>
          <span className={labelTextClasses}>{labelContent}</span>
        </label>
        {props.aiLabel}
        {props.decorator}
        {props.slug}
        <div className="cds--checkbox__validation-msg">
          {normalizedProps.invalid && (
            <>
              <WarningFilled16 className="cds--checkbox__invalid-icon" />
              <div className="cds--form-requirement">{host.invalidText}</div>
            </>
          )}
          {normalizedProps.warn && (
            <>
              <WarningAltFilled16 className="cds--checkbox__invalid-icon cds--checkbox__invalid-icon--warning" />
              <div className="cds--form-requirement">{host.warnText}</div>
            </>
          )}
        </div>
        {showHelper && host.helperText && <div className="cds--form__helper-text">{host.helperText}</div>}
      </cds-checkbox>
    </>
  );
});
