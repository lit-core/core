export interface ServerSplitOptions {
  filename?: string;
  sourcemap?: boolean;
  actionRoutePrefix?: string;
  emitZeroLitClient?: boolean;
  buildId?: string;
}

export interface ParamValidationMeta {
  name: string;
  tsType: string;
  optional: boolean;
}

export interface ActionMetadata {
  name: string;
  hash: string;
  params: ParamValidationMeta[];
  writtenProperties: string[];
  /** `@action({ revalidate: false })` skips loader revalidation after the action. */
  revalidate?: boolean;
}

export interface LoaderMetadata {
  name: string;
  /** Reactive properties this loader assigns, computed per loader. */
  writtenProperties: string[];
  /** `@loader({ dependencies })`: re-run after an action only when it wrote one of these. */
  dependencies?: string[];
}

export interface ServerSplitDiagnostic {
  code: string;
  severity: string;
  message: string;
  start: number;
  end: number;
}

export interface ServerSplitResult {
  isServerElement: boolean;
  tagName?: string;
  className?: string;
  clientCode: string;
  workerCode: string;
  actions: ActionMetadata[];
  loaders: LoaderMetadata[];
  diagnostics: ServerSplitDiagnostic[];
  hasErrors: boolean;
  zeroLit: boolean;
  buildId?: string;
  clientMap?: string;
  workerMap?: string;
}

/**
 * Reports reactive properties typed as something the JSON state wire cannot carry (SE109).
 * Run it on the author's original source, before decorator lowering strips the type annotations.
 */
export function checkStateTypes(
  source: string,
  filename?: string
): ServerSplitDiagnostic[];

export function splitServerElement(
  source: string,
  options?: ServerSplitOptions
): ServerSplitResult;

export interface WorkerEntryAction {
  name: string;
  hash: string;
}

export interface WorkerEntryElement {
  tagName?: string;
  className?: string;
  filePath: string;
  actions: WorkerEntryAction[];
}

export interface WorkerEntryOptions {
  elements: WorkerEntryElement[];
  buildId?: string;
  actionRoutePrefix?: string;
  includeWasm?: boolean;
  additionalImports?: string[];
}

export function compileWorkerEntry(options?: WorkerEntryOptions): string;
