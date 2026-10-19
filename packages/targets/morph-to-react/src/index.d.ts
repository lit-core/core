export interface AnalyzeOptions {
  filename?: string;
}

export interface PropertyDto {
  name: string;
  propertyType: string;
  attribute?: string;
  reflect: boolean;
  hasChanged?: string;
  noAccessor: boolean;
  isState: boolean;
  defaultValue?: string;
}

export interface EventDto {
  name: string;
  propName: string;
  detailType?: string;
  bubbles: boolean;
  cancelable: boolean;
  composed: boolean;
}

export interface SlotDto {
  name?: string;
  hasFallback: boolean;
  inspected: boolean;
}

export interface StyleDto {
  cssText: string;
  isShared: boolean;
  sharedImportPath?: string;
}

export interface TemplateNodeDto {
  Element?: {
    tag_name: string;
    namespace: 'Html' | 'Svg' | 'MathML';
    attributes: TemplateAttributeDto[];
    children: TemplateNodeDto[];
  };
  Text?: string;
  Expression?: number;
  Comment?: string;
  Slot?: {
    name?: string;
    fallback: TemplateNodeDto[];
    attributes: TemplateAttributeDto[];
    inspected: boolean;
  };
}

export interface TemplateAttributeDto {
  name: string;
  prefix: 'Plain' | 'Property' | 'Event' | 'Boolean';
  value:
    | { Static: string }
    | { Dynamic: number }
    | { Mixed: Array<{ Static: string } | { Expression: number }> }
    | { Directive: number };
}

export interface TemplateDto {
  roots: TemplateNodeDto[];
  expression_count: number;
  has_slots: boolean;
  has_custom_elements: boolean;
}

export interface ComponentDto {
  tagName?: string;
  className: string;
  componentName: string;
  tier: 'Tier0Pure' | 'Tier1Hosted' | 'Tier2HostedWithFacade' | 'Bailout';
  properties: PropertyDto[];
  events: EventDto[];
  slots: SlotDto[];
  styles: StyleDto[];
  template?: TemplateDto;
  superClass?: string;
  mixins: string[];
}

export interface DiagnosticDto {
  code: string;
  severity: string;
  message: string;
  spanStart: number;
  spanEnd: number;
  universalLitHint: string;
}

export interface AnalysisResultDto {
  components: ComponentDto[];
  diagnostics: DiagnosticDto[];
  manifestFilePath: string;
}

export function analyzeLit(source: string, options?: AnalyzeOptions): AnalysisResultDto;
export function analyzeLitModule(source: string, options?: AnalyzeOptions): AnalysisResultDto;
export function parseLitTemplate(quasis: string[], expressionCount: number): TemplateDto;

export interface CompileOptionsDto {
  filePath?: string;
  emitCss?: boolean;
  emitDts?: boolean;
  knownTags?: Record<string, string>;
  stylesheetIdPrefix?: string;
  targetTier?: 'Tier0Pure' | 'Tier1Hosted' | 'Tier2HostedWithFacade' | 'Bailout';
  stripPrefix?: string;
  tagSuffix?: string;
  isServer?: boolean;
  noCache?: boolean;
}

export interface CompileResultDto {
  code: string;
  css?: string;
  stylesheetId?: string;
  tier: 'Tier0Pure' | 'Tier1Hosted' | 'Tier2HostedWithFacade' | 'Bailout' | 'None';
  componentName: string;
  tagName?: string;
  diagnostics: DiagnosticDto[];
  dts?: string;
}

export function compileModule(sourceText: string, options?: CompileOptionsDto): CompileResultDto;
export function clearCompileCache(): void;
export function getCompileCacheSize(): number;
