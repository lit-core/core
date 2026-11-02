export const PartType: {
  readonly ATTRIBUTE: 1;
  readonly CHILD: 2;
  readonly PROPERTY: 3;
  readonly BOOLEAN_ATTRIBUTE: 4;
  readonly EVENT: 5;
  readonly ELEMENT: 6;
  readonly COMMENT_PART: 7;
};
export type PartType = (typeof PartType)[keyof typeof PartType];

export const AttributeKind: {
  readonly ATTRIBUTE: 1;
  readonly PROPERTY: 3;
  readonly BOOLEAN_ATTRIBUTE: 4;
  readonly EVENT: 5;
};
export type AttributeKind = (typeof AttributeKind)[keyof typeof AttributeKind];

export type TemplatePart =
  | {
      type: typeof PartType.CHILD | typeof PartType.COMMENT_PART | typeof PartType.ELEMENT;
      index: number;
    }
  | {
      type: typeof PartType.ATTRIBUTE;
      index: number;
      name: string;
      strings: Array<string>;
      ctorType: AttributeKind;
    };

export interface HtmlAotOptions {
  filename?: string;
  sourcemap?: boolean;
  ssr?: boolean;
  strictSsr?: boolean;
}

export interface HtmlAotResult {
  code: string;
  map?: string;
  templatesCount: number;
  ssrErrors: string[];
  hasRuntimeTemplates: boolean;
}

export interface SsrMarkerSite {
  name: string;
  index: number;
  parentPath: number[];
  startPath: number[];
}

export type SsrDynamicAttribute =
  | { type: 'attribute'; name: string; index: number; indices?: number[]; strings?: string[] }
  | { type: 'boolean'; name: string; index: number }
  | { type: 'property'; name: string; index: number }
  | { type: 'event'; name: string; index: number }
  | { type: 'directive'; index: number };

export type SsrOpcode =
  | {
      type: 'open';
      tag: string;
      isCustomElement?: boolean;
      isVoid?: boolean;
      namespace?: string;
      staticAttrs?: Record<string, string>;
      dynamicAttrs?: SsrDynamicAttribute[];
      closeIndex?: number;
    }
  | { type: 'close'; tag: string }
  | { type: 'text'; value: string }
  | { type: 'comment'; value: string }
  | { type: 'part'; index: number }
  | { type: 'marker-start'; name: string; h?: string }
  | { type: 'marker-end' };

export interface SsrTemplatePlan {
  v: 2;
  h: string;
  opcodes: SsrOpcode[];
  markerSites: SsrMarkerSite[];
  parts: unknown[];
}

/**
 * Ahead-of-time compile Lit HTML template literals in a source string.
 * Transforms `html` tagged templates into `CompiledTemplateResult`s that
 * skip Lit's runtime prepare and parse phase.
 */
export function compileHtmlAot(source: string, options?: HtmlAotOptions): HtmlAotResult;
export function transformHtmlAot(source: string, options?: HtmlAotOptions): HtmlAotResult;
export default compileHtmlAot;
