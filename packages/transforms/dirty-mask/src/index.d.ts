export interface DirtyMaskOptions {
  sourcemap?: boolean;
  filename?: string;
}

export interface DirtyMaskResult {
  code: string;
  map?: string | null;
  componentsCount: number;
  maskedPartsCount: number;
  propertiesCount: number;
}

export function transformDirtyMask(source: string, options?: DirtyMaskOptions): DirtyMaskResult;
export function transformDirtyMaskJs(source: string, options?: DirtyMaskOptions): DirtyMaskResult;
