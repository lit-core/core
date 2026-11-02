/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/**
 * Standard HTML element properties that reflect to attributes when assigned,
 * derived from the W3C HTML specification and upstream Lit SSR (`@lit-labs/ssr`).
 */
const reflectedAttributesSource: ReadonlyArray<readonly [string | readonly [string, string], readonly string[]]> = [
  ['accept', ['input']],
  [['accept-charset', 'acceptCharset'], ['form']],
  [['accesskey', 'accessKey'], ['*']],
  ['action', ['form']],
  ['align', ['caption', 'col', 'colgroup', 'hr', 'iframe', 'img', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr']],
  ['allow', ['iframe']],
  ['alt', ['area', 'img', 'input']],
  ['async', ['script']],
  ['autocapitalize', ['*']],
  ['autocomplete', ['form', 'input', 'select', 'textarea']],
  ['autofocus', ['button', 'input', 'keygen', 'select', 'textarea']],
  ['autoplay', ['audio', 'video']],
  ['background', ['body']],
  [
    ['bgcolor', 'bgColor'],
    ['body', 'marquee', 'table', 'td', 'th', 'tr'],
  ],
  ['border', ['img', 'object', 'table']],
  ['charset', ['script']],
  ['checked', ['input']],
  ['cite', ['blockquote', 'del', 'ins', 'q']],
  [['class', 'className'], ['*']],
  ['color', ['font', 'hr']],
  ['cols', ['textarea']],
  [
    ['colspan', 'colSpan'],
    ['td', 'th'],
  ],
  ['content', ['meta']],
  [['contenteditable', 'contentEditable'], ['*']],
  ['controls', ['audio', 'video']],
  ['coords', ['area']],
  [
    ['crossorigin', 'crossOrigin'],
    ['audio', 'img', 'link', 'script', 'video'],
  ],
  ['csp', ['iframe']],
  ['data', ['object']],
  [
    ['datetime', 'dateTime'],
    ['del', 'ins', 'time'],
  ],
  ['decoding', ['img']],
  ['default', ['track']],
  ['defer', ['script']],
  ['dir', ['*']],
  [
    ['dirname', 'dirName'],
    ['input', 'textarea'],
  ],
  ['disabled', ['button', 'fieldset', 'input', 'optgroup', 'option', 'select', 'textarea']],
  ['download', ['a', 'area']],
  ['draggable', ['*']],
  ['enctype', ['form']],
  [
    ['enterkeyhint', 'enterKeyHint'],
    ['textarea', 'contenteditable'],
  ],
  [
    ['formaction', 'formAction'],
    ['input', 'button'],
  ],
  [
    ['formenctype', 'formEnctype'],
    ['button', 'input'],
  ],
  [
    ['formmethod', 'formMethod'],
    ['button', 'input'],
  ],
  [
    ['formnovalidate', 'formNoValidate'],
    ['button', 'input'],
  ],
  [
    ['formtarget', 'formTarget'],
    ['button', 'input'],
  ],
  ['headers', ['td', 'th']],
  ['height', ['canvas', 'embed', 'iframe', 'img', 'input', 'object', 'video']],
  ['hidden', ['*']],
  ['high', ['meter']],
  ['href', ['a', 'area', 'base', 'link']],
  ['hreflang', ['a', 'link']],
  [['http-equiv', 'httpEquiv'], ['meta']],
  ['id', ['*']],
  ['integrity', ['link', 'script']],
  [
    ['inputmode', 'inputMode'],
    ['textarea', 'contenteditable'],
  ],
  [['ismap', 'isMap'], ['img']],
  ['kind', ['track']],
  ['label', ['optgroup', 'option', 'track']],
  ['lang', ['*']],
  ['loading', ['img', 'iframe']],
  ['loop', ['audio', 'marquee', 'video']],
  ['low', ['meter']],
  ['max', ['input', 'meter', 'progress']],
  [
    ['maxlength', 'maxLength'],
    ['input', 'textarea'],
  ],
  [
    ['minlength', 'minLength'],
    ['input', 'textarea'],
  ],
  ['media', ['link', 'source', 'style']],
  ['method', ['form']],
  ['min', ['input', 'meter']],
  ['multiple', ['input', 'select']],
  ['muted', ['audio', 'video']],
  ['name', ['button', 'form', 'fieldset', 'iframe', 'input', 'object', 'output', 'select', 'textarea', 'map', 'meta', 'param']],
  [['novalidate', 'noValidate'], ['form']],
  ['open', ['details']],
  ['optimum', ['meter']],
  ['pattern', ['input']],
  ['ping', ['a', 'area']],
  ['placeholder', ['input', 'textarea']],
  ['poster', ['video']],
  ['preload', ['audio', 'video']],
  [
    ['readonly', 'readOnly'],
    ['input', 'textarea'],
  ],
  [
    ['referrerpolicy', 'referrerPolicy'],
    ['a', 'area', 'iframe', 'img', 'link', 'script'],
  ],
  ['rel', ['a', 'area', 'link']],
  ['required', ['input', 'select', 'textarea']],
  ['reversed', ['ol']],
  ['rows', ['textarea']],
  [
    ['rowspan', 'rowSpan'],
    ['td', 'th'],
  ],
  ['sandbox', ['iframe']],
  ['scope', ['th']],
  ['selected', ['option']],
  ['shape', ['a', 'area']],
  ['size', ['input', 'select']],
  ['sizes', ['link', 'img', 'source']],
  ['slot', ['*']],
  ['span', ['col', 'colgroup']],
  ['spellcheck', ['*']],
  ['src', ['audio', 'embed', 'iframe', 'img', 'input', 'script', 'source', 'track', 'video']],
  ['srcdoc', ['iframe']],
  ['srclang', ['track']],
  ['srcset', ['img', 'source']],
  ['start', ['ol']],
  ['step', ['input']],
  ['style', ['*']],
  ['summary', ['table']],
  [['tabindex', 'tabIndex'], ['*']],
  ['target', ['a', 'area', 'base', 'form']],
  ['title', ['*']],
  ['type', ['button', 'input', 'embed', 'object', 'script', 'source', 'style']],
  [
    ['usemap', 'useMap'],
    ['img', 'input', 'object'],
  ],
  ['value', ['button', 'data', 'input', 'li', 'meter', 'option', 'progress', 'param']],
  ['width', ['canvas', 'embed', 'iframe', 'img', 'input', 'object', 'video']],
  ['wrap', ['textarea']],
];

const reflectedAttributes = new Map<string, Map<string, string>>();

const addPropertyForElement = (elementName: string, attributeName: string, propertyName: string): void => {
  const existing = reflectedAttributes.get(elementName);
  if (existing !== undefined) {
    existing.set(propertyName, attributeName);
  } else {
    reflectedAttributes.set(elementName, new Map([[propertyName, attributeName]]));
  }
};

for (const [attr, elements] of reflectedAttributesSource) {
  for (const rawElementName of elements) {
    const elementName = rawElementName.toUpperCase();
    if (Array.isArray(attr)) {
      addPropertyForElement(elementName, attr[0], attr[1]);
    } else {
      addPropertyForElement(elementName, attr as string, attr as string);
    }
  }
}

const wildcardAttributes = reflectedAttributes.get('*') ?? new Map<string, string>();

/**
 * Returns the HTML attribute name reflected by `propertyName` on `elementName`
 * (or `undefined` when the property does not reflect to an attribute).
 */
export function reflectedAttributeName(elementName: string, propertyName: string): string | undefined {
  const upper = elementName.toUpperCase();
  const attributes = reflectedAttributes.get(upper);
  if (attributes !== undefined && attributes.has(propertyName)) {
    return attributes.get(propertyName);
  }
  return wildcardAttributes.get(propertyName);
}
