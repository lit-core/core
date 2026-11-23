import { ELEMENT_NODE } from './dom.js';
import { isStartMarker, resolveNodeByPath } from './markers.js';

const SHEET_KEY_ATTRIBUTE = 'data-lit-sheet';
const LOCAL_STYLE_ATTRIBUTE = 'data-lit-local';

type SheetRegistry = Record<string, CSSStyleSheet>;

function sheetRegistry(): SheetRegistry | null {
  return typeof window === 'undefined' ? null : (((window as unknown as { __litCS?: SheetRegistry }).__litCS ??= {}) as SheetRegistry);
}

function isServerStyle(el: Element): boolean {
  return el.hasAttribute(SHEET_KEY_ATTRIBUTE) || el.hasAttribute(LOCAL_STYLE_ATTRIBUTE);
}

interface PathAnchor {
  path?: number[];
  startPath?: number[];
  targetTag?: string;
}

/** First compiled descriptor that carries a path, used to calibrate how many leading nodes are styles. */
function anchorDescriptor(el: object | undefined, fallbacks: ReadonlyArray<PathAnchor> | undefined): PathAnchor | undefined {
  const parts = ((el?.constructor as { __litParts?: PathAnchor[] } | undefined)?.__litParts ?? []) as PathAnchor[];
  return parts.find((part) => part.path?.length || part.startPath?.length) ?? fallbacks?.find((part) => part.path?.length);
}

/**
 * How many leading `<style>` elements the server prepended for `static styles`.
 *
 * Elements tagged by the server are counted directly. When untagged leading styles exist, the
 * count is calibrated against a compiled path: the correct count is the one under which the
 * first compiled anchor resolves to a node of the expected kind.
 */
function countServerStyles(root: Node, styles: Element[], el: object | undefined, fallbacks: ReadonlyArray<PathAnchor> | undefined): number {
  let tagged = 0;
  while (tagged < styles.length && isServerStyle(styles[tagged])) tagged++;
  if (tagged === styles.length) return tagged;

  const anchor = anchorDescriptor(el, fallbacks);
  const path = anchor?.path ?? anchor?.startPath;
  if (!path) return styles.length;

  const tag = anchor?.targetTag?.toLowerCase();
  for (let count = tagged; count <= styles.length; count++) {
    const node = resolveNodeByPath(root, [path[0] + count, ...path.slice(1)]);
    const matches = anchor?.startPath ? isStartMarker(node) : node?.nodeType === ELEMENT_NODE && (!tag || (node as Element).localName === tag);
    if (matches) return count;
  }
  return tagged;
}

/**
 * Migrates SSR-prepended `static styles` `<style>` elements at the start of a shadow root into
 * `adoptedStyleSheets`, so the numeric child paths compiled from the template line up one to one
 * with the live DOM. Sheets tagged with a key are shared across elements through one registry.
 */
export function adoptLeadingSsrStyles(el?: object, root?: ShadowRoot | Node, fallbacks?: ReadonlyArray<PathAnchor>): void {
  const shadow = root as ShadowRoot | undefined;
  if (!shadow?.adoptedStyleSheets) return;

  const styles: Element[] = [];
  for (let node = shadow.firstChild as Element | null; node?.localName === 'style'; node = node.nextSibling as Element | null) {
    styles.push(node);
  }
  if (styles.length === 0) return;

  const count = countServerStyles(shadow, styles, el, fallbacks);
  if (count === 0) return;

  const registry = sheetRegistry();
  const sheets = [...shadow.adoptedStyleSheets];
  for (const style of styles.slice(0, count)) {
    const key = style.getAttribute(SHEET_KEY_ATTRIBUTE);
    let sheet = key && registry ? registry[key] : undefined;
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(style.textContent || '');
      if (key && registry) registry[key] = sheet;
    }
    style.remove();
    if (!sheets.includes(sheet)) sheets.push(sheet);
  }
  shadow.adoptedStyleSheets = sheets;
}
