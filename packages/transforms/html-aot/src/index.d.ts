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
}

export interface HtmlAotResult {
  code: string;
  map?: string;
  templatesCount: number;
}

/**
 * Ahead-of-time compile Lit HTML template literals in a source string.
 * Transforms `html` tagged templates into `CompiledTemplateResult`s that
 * skip Lit's runtime prepare and parse phase.
 */
export function compileHtmlAot(source: string, options?: HtmlAotOptions): HtmlAotResult;
export function transformHtmlAot(source: string, options?: HtmlAotOptions): HtmlAotResult;
export default compileHtmlAot;
