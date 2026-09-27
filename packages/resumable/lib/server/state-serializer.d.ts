export interface StateSerializerOptions {
    /**
     * Property keys to explicitly exclude from serialization.
     */
    excludeProperties?: string[];
    /**
     * Custom filter predicate for determining if a property should be serialized.
     */
    filter?: (key: string, value: unknown) => boolean;
}
/**
 * Check if a value is JSON-serializable (primitives, plain objects, arrays).
 */
export declare function isSerializableValue(value: unknown): boolean;
/**
 * Extract serializable reactive property snapshot from a Lit component instance or property bag.
 */
export declare function extractComponentState(instanceOrProps: any, options?: StateSerializerOptions): Record<string, unknown>;
/**
 * Safely serialize state object to JSON string, escaping '<' to prevent script breakouts.
 */
export declare function serializeStateToJson(state: Record<string, unknown>): string;
/**
 * Serialize component instance or state dictionary into a JSON string or null if empty.
 */
export declare function serializeComponentState(instanceOrProps: any, options?: StateSerializerOptions): string | null;
/**
 * Render the <script type="lit/state"> tag for embedding inside the custom element host.
 */
export declare function renderStateScript(stateJsonOrObj: string | Record<string, unknown>): string;
/**
 * Parse state from serialized script text content.
 */
export declare function parseComponentState(scriptContent: string): Record<string, unknown>;
//# sourceMappingURL=state-serializer.d.ts.map