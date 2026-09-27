import { type StateSerializerOptions } from './state-serializer.js';
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
export declare function formatAttributes(attributes?: Record<string, string | number | boolean | null | undefined>): string;
/**
 * Render standard Declarative Shadow DOM markup with optional state snapshot.
 */
export declare function renderToDsd(options: DsdRenderOptions): string;
/**
 * Render a LitElement component instance into Declarative Shadow DOM.
 */
export declare function renderComponentToDsd(component: any, options?: ComponentDsdOptions): string;
/**
 * Render a Lit TemplateResult to plain HTML string without runtime client dependencies.
 */
export declare function renderTemplateResult(result: any): string;
//# sourceMappingURL=dsd-renderer.d.ts.map