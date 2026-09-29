import { type BufferedEvent, RESUMED_EVENT_FLAG, replayQueue } from './replay.js';

export interface LoaderOptions {
  /**
   * Tag name to chunk URL manifest map.
   */
  manifest?: Record<string, string>;

  /**
   * Custom function to resolve a tag name to a chunk URL.
   */
  chunkResolver?: (tagName: string) => string;

  /**
   * Preload component chunks on pointer hover.
   * @default true
   */
  preloadOnHover?: boolean;

  /**
   * Events to intercept for resumption.
   * @default ['click', 'input', 'change', 'keydown', 'submit', 'pointerdown', 'focusin', 'focusout']
   */
  events?: string[];

  /**
   * Callback fired when a component is upgraded.
   */
  onUpgrade?: (tagName: string) => void;
}

export const DEFAULT_RESUMPTION_EVENTS = ['click', 'input', 'change', 'keydown', 'submit', 'pointerdown', 'focusin', 'focusout'];

/**
 * Client-side loader controller that manages interception, chunk loading, and event replay.
 */
export class ResumableLoader {
  private bufferedEvents: BufferedEvent[] = [];
  private loadingTags = new Set<string>();
  private preloadedUrls = new Set<string>();
  private manifest: Record<string, string>;
  private chunkResolver?: (tagName: string) => string;
  private preloadOnHover: boolean;
  private events: string[];
  private cleanupFns: Array<() => void> = [];

  constructor(options: LoaderOptions = {}) {
    this.manifest = options.manifest || (typeof window !== 'undefined' && (window as any).__LIT_RESUMABLE_MANIFEST__) || {};
    this.chunkResolver = options.chunkResolver;
    this.preloadOnHover = options.preloadOnHover ?? true;
    this.events = options.events || DEFAULT_RESUMPTION_EVENTS;
  }

  /**
   * Resolve chunk URL for a custom element tag name.
   */
  public resolveChunk(tagName: string): string {
    const tag = tagName.toLowerCase();
    if (this.chunkResolver) {
      return this.chunkResolver(tag);
    }
    if (this.manifest[tag]) {
      return this.manifest[tag];
    }
    return `/components/${tag}.js`;
  }

  /**
   * Preload a component chunk via <link rel="modulepreload"> or dynamic import.
   */
  public preload(tagName: string): void {
    const url = this.resolveChunk(tagName);
    if (this.preloadedUrls.has(url)) return;
    this.preloadedUrls.add(url);

    if (typeof document !== 'undefined') {
      try {
        const link = document.createElement('link');
        link.rel = 'modulepreload';
        link.href = url;
        document.head.appendChild(link);
      } catch {
        // Fallback to dynamic import
        import(/* @vite-ignore */ url).catch(() => {});
      }
    }
  }

  /**
   * Load chunk and wait for custom element definition.
   */
  public async loadAndUpgrade(tagName: string): Promise<void> {
    const tag = tagName.toLowerCase();
    if (typeof customElements === 'undefined') return;

    if (customElements.get(tag)) {
      return;
    }

    if (!this.loadingTags.has(tag)) {
      this.loadingTags.add(tag);
      const chunkUrl = this.resolveChunk(tag);
      try {
        await import(/* @vite-ignore */ chunkUrl);
      } catch (err) {
        console.error(`[resumable] Failed to load chunk for <${tag}> from ${chunkUrl}:`, err);
      }
    }

    await customElements.whenDefined(tag);
  }

  /**
   * Find all un-upgraded custom element hosts in an event's composed path.
   */
  public findUnupgradedHosts(path: EventTarget[]): HTMLElement[] {
    if (typeof customElements === 'undefined') return [];
    const unupgraded: HTMLElement[] = [];

    for (const target of path) {
      if (target && (target as any).nodeType === 1) {
        const el = target as HTMLElement;
        const tagName = el.tagName ? el.tagName.toLowerCase() : '';
        if (tagName.includes('-') && !customElements.get(tagName)) {
          unupgraded.push(el);
        }
      }
    }

    return unupgraded;
  }

  /**
   * Handle an intercepted interaction event.
   */
  public async handleEvent(event: Event): Promise<void> {
    // Ignore already replayed events to avoid loops
    if ((event as any)[RESUMED_EVENT_FLAG]) {
      return;
    }

    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const unupgradedHosts = this.findUnupgradedHosts(path);

    if (unupgradedHosts.length === 0) {
      return;
    }

    // Intercept and hold event
    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopImmediatePropagation();

    const host = unupgradedHosts[0];
    const buffered: BufferedEvent = {
      event,
      host,
      target: event.target,
      path,
      timestamp: Date.now(),
    };
    this.bufferedEvents.push(buffered);

    // Extract all unique unupgraded tags in the composed path
    const tagsToLoad = [...new Set(unupgradedHosts.map((h) => h.tagName.toLowerCase()))];

    // Concurrently load all required component chunks
    await Promise.all(tagsToLoad.map((tag) => this.loadAndUpgrade(tag)));

    // Replay queued events
    this.flush();
  }

  /**
   * Flush all buffered events.
   */
  public flush(): void {
    if (this.bufferedEvents.length === 0) return;
    const queue = [...this.bufferedEvents];
    this.bufferedEvents = [];
    replayQueue(queue);
  }

  /**
   * Attach interception listeners to window.
   */
  public start(): () => void {
    if (typeof window === 'undefined') return () => {};

    const listener = (event: Event) => {
      this.handleEvent(event);
    };

    for (const type of this.events) {
      window.addEventListener(type, listener, { capture: true, passive: false });
      this.cleanupFns.push(() => {
        window.removeEventListener(type, listener, { capture: true });
      });
    }

    // Preload on hover
    if (this.preloadOnHover) {
      const hoverListener = (event: Event) => {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        const unupgraded = this.findUnupgradedHosts(path);
        for (const host of unupgraded) {
          this.preload(host.tagName);
        }
      };

      const hoverEvents = ['pointerover', 'mouseover'];
      for (const hType of hoverEvents) {
        window.addEventListener(hType, hoverListener, { capture: true, passive: true });
        this.cleanupFns.push(() => {
          window.removeEventListener(hType, hoverListener, { capture: true });
        });
      }
    }

    return () => this.stop();
  }

  /**
   * Stop intercepting and remove all attached listeners.
   */
  public stop(): void {
    for (const cleanup of this.cleanupFns) {
      cleanup();
    }
    this.cleanupFns = [];
    this.bufferedEvents = [];
    this.loadingTags.clear();
  }
}

/**
 * Initialize the loader in the current window.
 */
export function initLoader(options?: LoaderOptions): ResumableLoader {
  const loader = new ResumableLoader(options);
  loader.start();
  return loader;
}

/**
 * Generate the inline ~1.2 KB micro-loader script for injection into <head>.
 */
export function generateInlineLoader(manifest: Record<string, string> = {}, options: { preloadOnHover?: boolean } = {}): string {
  const pCode =
    options.preloadOnHover !== false
      ? `['pointerover','mouseover'].forEach(t=>addEventListener(t,e=>{for(const el of e.composedPath()){if(el.tagName?.includes('-')&&!customElements.get(el.tagName.toLowerCase()))pL(el.tagName.toLowerCase())}},{capture:true,passive:true}));`
      : '';

  return `(()=>{const M=window.__LIT_RESUMABLE_MANIFEST__||${JSON.stringify(manifest)},B=[],L=new Set(),P=new Set(),R='__lit_resumed__',rC=t=>M[t]||'/components/'+t+'.js',pL=t=>{const u=rC(t);if(!P.has(u)){P.add(u);const l=document.createElement('link');l.rel='modulepreload';l.href=u;document.head.appendChild(l)}};async function uG(t){if(!customElements.get(t)){if(!L.has(t)){L.add(t);await import(rC(t)).catch(()=>{})}await customElements.whenDefined(t)}}async function hI(e){if(e[R])return;const u=e.composedPath().filter(el=>el.tagName?.includes('-')&&!customElements.get(el.tagName.toLowerCase()));if(!u.length)return;if(e.cancelable)e.preventDefault();e.stopImmediatePropagation();B.push({e,t:e.target,h:u[0]});await Promise.all(u.map(el=>uG(el.tagName.toLowerCase())));while(B.length){const{e:o,t,h}=B.shift(),tgt=(t?.isConnected)?t:h;if(!tgt?.dispatchEvent)continue;let ev;try{ev=new o.constructor(o.type,o)}catch{ev=new CustomEvent(o.type,{bubbles:o.bubbles,cancelable:o.cancelable,composed:o.composed})}Object.defineProperty(ev,R,{value:true});tgt.dispatchEvent(ev)}}['click','input','change','keydown','submit','pointerdown','focusin','focusout'].forEach(t=>addEventListener(t,hI,{capture:true,passive:false}));${pCode}})();`;
}
