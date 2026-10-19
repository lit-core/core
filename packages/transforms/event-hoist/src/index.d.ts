export interface EventHoistOptions {
  /**
   * Custom list of event names to hoist.
   * Defaults to standard safe bubbling events (click, input, change, etc.).
   */
  events?: string[];

  /**
   * Generate sourcemap for transformed files.
   * @default true
   */
  sourcemap?: boolean;

  /**
   * Source filename for parser and sourcemap generation.
   * @default 'file.ts'
   */
  filename?: string;
}

export interface EventHoistResult {
  code: string;
  map?: string | null;
  hoistedEventsCount: number;
  events: string[];
  componentsCount: number;
}

export declare const SAFE_BUBBLING_EVENTS: string[];

export declare function transformEventHoist(
  source: string,
  options?: EventHoistOptions
): EventHoistResult;
