import { escapeAttribute } from './escape.js';

export interface SharedStyleEntry {
  key: string;
  css: string;
  styleTag: string;
}

export interface ExtractedStyles {
  sharedSheets: string[];
  localStyles: string[];
  sharedEntries: SharedStyleEntry[];
  allSharedKeys: string[];
  inlinedAllStyleTag: string;
  inlinedLocalStyleTag: string;
  inlinedLocalDataStyleTag: string;
}

export interface ResolvedComponentStyles {
  firstTimeShared: SharedStyleEntry[];
  adoptedSharedKeys: string[];
  allSharedEntries: SharedStyleEntry[];
  localStyles: string[];
}

export const EMPTY_STRING_ARRAY: string[] = [];

export const EMPTY_SHARED_ENTRIES: SharedStyleEntry[] = [];

export const EMPTY_EXTRACTED_STYLES: ExtractedStyles = {
  sharedSheets: EMPTY_STRING_ARRAY,
  localStyles: EMPTY_STRING_ARRAY,
  sharedEntries: EMPTY_SHARED_ENTRIES,
  allSharedKeys: EMPTY_STRING_ARRAY,
  inlinedAllStyleTag: '',
  inlinedLocalStyleTag: '',
  inlinedLocalDataStyleTag: '',
};

export class StyleDeduplicator {
  private seenSharedSheets: Set<string> | null = null;
  private inlineEmittedSheets: Set<string> | null = null;
  private urlFallbackSheets: Map<string, string> | null = null;
  private collectedStyles: string[] | null = null;
  private pendingStyles: Array<{ key: string; css: string }> | null = null;
  private pendingInlineAdoption = false;
  private adoptBootstrapEmitted = false;
  private static ctorStyleCache = new WeakMap<any, ExtractedStyles>();

  public static resetCache(): void {
    StyleDeduplicator.ctorStyleCache = new WeakMap<any, ExtractedStyles>();
  }

  public processComponentStyles(ctor: any): ExtractedStyles {
    if (ctor) {
      const cached = StyleDeduplicator.ctorStyleCache.get(ctor);
      if (cached) {
        const entries = cached.sharedEntries;
        if (entries.length > 0) {
          const seen = (this.seenSharedSheets ??= new Set<string>());
          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!seen.has(entry.key)) {
              seen.add(entry.key);
              (this.collectedStyles ??= []).push(entry.css);
              (this.pendingStyles ??= []).push(entry);
            }
          }
        }
        return cached;
      }
    }

    const rawStyles = ctor?.styles;
    if (!rawStyles) {
      if (ctor) StyleDeduplicator.ctorStyleCache.set(ctor, EMPTY_EXTRACTED_STYLES);
      return EMPTY_EXTRACTED_STYLES;
    }

    const flatStyles = Array.isArray(rawStyles) ? rawStyles.flat(Infinity) : [rawStyles];
    const shared: string[] = [];
    const local: string[] = [];
    const sharedEntries: SharedStyleEntry[] = [];
    const allSharedKeys: string[] = [];

    for (const item of flatStyles) {
      if (!item) continue;
      const cssText = typeof item === 'string' ? item : (item.cssText ?? String(item));
      const trimmed = cssText.trim();
      if (!trimmed) continue;

      const isFused = Boolean((item as any)._fusedId || (item as any)._fused || trimmed.includes('/* @lit-core/css-fuse */'));
      const sheetKey = (item as any)._fusedId || this.hashCss(trimmed);

      if (isFused || this.isSharedCandidate(trimmed)) {
        const entry: SharedStyleEntry = {
          key: sheetKey,
          css: trimmed,
          styleTag: `<style data-lit-sheet="${escapeAttribute(sheetKey)}">${trimmed}</style>`,
        };
        const seen = (this.seenSharedSheets ??= new Set<string>());
        if (!seen.has(sheetKey)) {
          seen.add(sheetKey);
          (this.collectedStyles ??= []).push(trimmed);
          (this.pendingStyles ??= []).push(entry);
        }
        shared.push(trimmed);
        sharedEntries.push(entry);
        allSharedKeys.push(sheetKey);
      } else {
        local.push(trimmed);
      }
    }

    const inlinedLocalCss = local.length > 0 ? local.join('\n') : '';
    const allParts = shared.length > 0 ? (local.length > 0 ? [...shared, ...local] : shared) : local;
    const inlinedAllCss = allParts.length > 0 ? allParts.join('\n') : '';

    const result: ExtractedStyles = {
      sharedSheets: shared,
      localStyles: local,
      sharedEntries,
      allSharedKeys,
      inlinedAllStyleTag: inlinedAllCss.length > 0 ? `<style>${inlinedAllCss}</style>` : '',
      inlinedLocalStyleTag: inlinedLocalCss.length > 0 ? `<style>${inlinedLocalCss}</style>` : '',
      inlinedLocalDataStyleTag: inlinedLocalCss.length > 0 ? `<style data-lit-local>${inlinedLocalCss}</style>` : '',
    };
    if (ctor) StyleDeduplicator.ctorStyleCache.set(ctor, result);
    return result;
  }

  public resolveDefaultStyleTag(ctor: any, cssFuse: boolean): { styleTag: string; adoptKeys: string[] } {
    if (!cssFuse) {
      let cached = ctor ? StyleDeduplicator.ctorStyleCache.get(ctor) : undefined;
      if (!cached) {
        cached = this.processComponentStyles(ctor);
      }
      return { styleTag: cached.inlinedAllStyleTag, adoptKeys: EMPTY_STRING_ARRAY };
    }

    const extracted = this.processComponentStyles(ctor);
    const sharedEntries = extracted.sharedEntries;
    if (sharedEntries.length === 0) {
      return { styleTag: extracted.inlinedLocalStyleTag, adoptKeys: EMPTY_STRING_ARRAY };
    }

    const emitted = (this.inlineEmittedSheets ??= new Set<string>());
    let styleTag = '';
    let adoptedSharedKeys: string[] | null = null;

    for (let i = 0; i < sharedEntries.length; i++) {
      const entry = sharedEntries[i];
      if (!emitted.has(entry.key)) {
        emitted.add(entry.key);
        styleTag += entry.styleTag;
      } else {
        (adoptedSharedKeys ??= []).push(entry.key);
        this.pendingInlineAdoption = true;
      }
    }

    if (extracted.localStyles.length > 0) {
      styleTag += adoptedSharedKeys !== null ? extracted.inlinedLocalDataStyleTag : extracted.inlinedLocalStyleTag;
    }

    return {
      styleTag,
      adoptKeys: adoptedSharedKeys ?? EMPTY_STRING_ARRAY,
    };
  }

  public resolveComponentStyles(ctor: any, cssFuse: boolean): ResolvedComponentStyles {
    const extracted = this.processComponentStyles(ctor);
    const sharedEntries = extracted.sharedEntries;

    if (!cssFuse) {
      return {
        firstTimeShared: EMPTY_SHARED_ENTRIES,
        adoptedSharedKeys: EMPTY_STRING_ARRAY,
        allSharedEntries: sharedEntries,
        localStyles: extracted.sharedSheets.length > 0 ? [...extracted.sharedSheets, ...extracted.localStyles] : extracted.localStyles,
      };
    }

    if (sharedEntries.length === 0) {
      return {
        firstTimeShared: EMPTY_SHARED_ENTRIES,
        adoptedSharedKeys: EMPTY_STRING_ARRAY,
        allSharedEntries: sharedEntries,
        localStyles: extracted.localStyles,
      };
    }

    const emitted = (this.inlineEmittedSheets ??= new Set<string>());
    const firstTimeShared: SharedStyleEntry[] = [];
    const adoptedSharedKeys: string[] = [];

    for (let i = 0; i < sharedEntries.length; i++) {
      const entry = sharedEntries[i];
      if (!emitted.has(entry.key)) {
        emitted.add(entry.key);
        firstTimeShared.push(entry);
      } else {
        adoptedSharedKeys.push(entry.key);
        this.pendingInlineAdoption = true;
      }
    }

    return {
      firstTimeShared,
      adoptedSharedKeys,
      allSharedEntries: sharedEntries,
      localStyles: extracted.localStyles,
    };
  }

  public recordAdoptedUrlSheet(url: string, css: string): void {
    const map = (this.urlFallbackSheets ??= new Map<string, string>());
    if (!map.has(url)) {
      map.set(url, css);
    }
  }

  public flushAdoptedUrlSheets(): Array<{ url: string; css: string }> {
    if (!this.urlFallbackSheets || this.urlFallbackSheets.size === 0) return EMPTY_SHARED_ENTRIES as any;
    const entries = Array.from(this.urlFallbackSheets.entries(), ([url, css]) => ({ url, css }));
    this.urlFallbackSheets.clear();
    return entries;
  }

  public consumePendingInlineAdoption(): { needsBootstrap: boolean; needsCall: boolean } {
    if (!this.pendingInlineAdoption) {
      return { needsBootstrap: false, needsCall: false };
    }
    this.pendingInlineAdoption = false;
    const needsBootstrap = !this.adoptBootstrapEmitted;
    this.adoptBootstrapEmitted = true;
    return { needsBootstrap, needsCall: true };
  }

  public getCollectedStyles(): string[] {
    return this.collectedStyles ? [...this.collectedStyles] : [];
  }

  public flushPendingSharedStyles(): Array<{ key: string; css: string }> {
    if (!this.pendingStyles || this.pendingStyles.length === 0) return [];
    return this.pendingStyles.splice(0, this.pendingStyles.length);
  }

  private hashCss(css: string): string {
    let hash = 5381;
    for (let i = 0; i < css.length; i++) {
      hash = (hash * 33) ^ css.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }

  private isSharedCandidate(css: string): boolean {
    return css.length > 256;
  }
}
