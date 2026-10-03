import { renderStateScript, type StateSerializerOptions, serializeComponentState } from './state-serializer.js';

export interface DsdRenderOptions {
  tagName: string;
  shadowHtml?: string;
  styles?: string | string[];
  attributes?: Record<string, string | number | boolean | null | undefined>;
  lightDom?: string;
  state?: Record<string, unknown> | null;
  serializerOptions?: StateSerializerOptions;
}

export interface ComponentDsdOptions {
  attributes?: Record<string, string | number | boolean | null | undefined>;
  lightDom?: string;
  serializerOptions?: StateSerializerOptions;
}

/**
 * Format an attributes map into an HTML attribute string.
 */
export function formatAttributes(attributes?: Record<string, string | number | boolean | null | undefined>): string {
  if (!attributes) return '';
  const parts: string[] = [];

  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (value === true) {
      parts.push(key);
    } else {
      const escaped = String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      parts.push(`${key}="${escaped}"`);
    }
  }

  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/**
 * Render standard Declarative Shadow DOM markup with optional state snapshot.
 */
export function renderToDsd(options: DsdRenderOptions): string {
  const { tagName, shadowHtml = '', styles, attributes, lightDom = '', state, serializerOptions } = options;

  const tag = tagName.toLowerCase();
  const attrStr = formatAttributes(attributes);

  let styleTag = '';
  if (styles) {
    const cssContent = Array.isArray(styles) ? styles.join('\n') : styles;
    if (cssContent.trim()) {
      styleTag = `<style>${cssContent.trim()}</style>`;
    }
  }

  let stateScript = '';
  if (state && Object.keys(state).length > 0) {
    const serialized = serializeComponentState(state, serializerOptions);
    if (serialized) {
      stateScript = renderStateScript(serialized);
    }
  }

  return `<${tag}${attrStr}><template shadowrootmode="open">${styleTag}${shadowHtml}</template>${lightDom}${stateScript}</${tag}>`;
}

/**
 * Render a LitElement component instance into Declarative Shadow DOM.
 */
export function renderComponentToDsd(component: any, options: ComponentDsdOptions = {}): string {
  if (!component) {
    throw new Error('[resumable] Cannot render null or undefined component to DSD');
  }

  const ctor = component.constructor;
  const tagName = component.tagName ? component.tagName.toLowerCase() : ctor.is || 'custom-element';

  // Extract static styles
  const stylesList: string[] = [];
  if (ctor.styles) {
    const stylesArr = Array.isArray(ctor.styles) ? ctor.styles.flat(Infinity) : [ctor.styles];
    for (const s of stylesArr) {
      if (s) {
        if (typeof s === 'string') {
          stylesList.push(s);
        } else if (s.cssText) {
          stylesList.push(s.cssText);
        }
      }
    }
  }

  // Render shadow template if component has render()
  let shadowHtml = '';
  if (typeof component.render === 'function') {
    const renderResult = component.render();
    if (renderResult && typeof renderResult === 'object' && 'strings' in renderResult) {
      // Lit TemplateResult
      shadowHtml = renderTemplateResult(renderResult);
    } else if (typeof renderResult === 'string') {
      shadowHtml = renderResult;
    }
  }

  // Extract state
  const stateJson = serializeComponentState(component, options.serializerOptions);
  let stateScript = '';
  if (stateJson) {
    stateScript = renderStateScript(stateJson);
  }

  // Combine attributes
  const attrStr = formatAttributes(options.attributes);
  const lightDom = options.lightDom || '';
  const styleTag = stylesList.length > 0 ? `<style>${stylesList.join('\n')}</style>` : '';

  return `<${tagName}${attrStr}><template shadowrootmode="open">${styleTag}${shadowHtml}</template>${lightDom}${stateScript}</${tagName}>`;
}

/**
 * Render a Lit TemplateResult to plain HTML string without runtime client dependencies.
 * Serializes @event and .onEvent listener bindings into resumes-on-* marker attributes
 * so client micro-loader can perform zero-overhead, fine-grained interaction detection.
 */
export function renderTemplateResult(result: any): string {
  if (!result || typeof result !== 'object') {
    return String(result ?? '');
  }

  if (typeof result === 'string') return result;

  const strings = result.strings;
  const values = result.values || [];

  if (!Array.isArray(strings)) {
    return String(result);
  }

  let html = '';
  let stripLeadingQuote: string | null = null;

  for (let i = 0; i < strings.length; i++) {
    let str = strings[i];
    if (stripLeadingQuote && str.startsWith(stripLeadingQuote)) {
      str = str.slice(stripLeadingQuote.length);
      stripLeadingQuote = null;
    }

    if (i < values.length) {
      const val = values[i];
      if (typeof val === 'function') {
        // Event listener or directive in template
        const match = str.match(/(?:@|\.on)([a-zA-Z0-9_-]+)\s*=\s*(["']?)$/);
        if (match) {
          const eventName = match[1].toLowerCase();
          const quote = match[2];
          if (quote) {
            stripLeadingQuote = quote;
          }
          str = `${str.slice(0, match.index)}resumes-on-${eventName} `;
        }
        html += str;
        continue;
      }

      html += str;

      if (val === null || val === undefined || val === false) {
        continue;
      }
      if (Array.isArray(val)) {
        html += val.map(renderTemplateResult).join('');
      } else if (typeof val === 'object' && 'strings' in val) {
        html += renderTemplateResult(val);
      } else {
        html += String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
    } else {
      html += str;
    }
  }

  return html;
}
