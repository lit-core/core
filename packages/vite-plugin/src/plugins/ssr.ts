import fs from 'node:fs';
import path from 'node:path';
import { collectResult, HTMLElementStub, IsolateCustomElementRegistry, installIsolateGlobals, renderToString } from '@lit-core/ssr';
import ts from 'typescript';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { reportTransformError } from '../errors.js';
import type { SsrOptions } from '../options.js';
import { formatVirtualLitCoreId, isVirtualLitCoreId, matchesPattern } from '../utils.js';
import { ISLANDS_LOADER_SOURCE, SSR_RUNTIME_SOURCE } from '../virtual.js';

export const LIT_SSR_FAST_CHECK = /(?:@customElement|customElements\.define|LitElement|html`|css`)/;

/**
 * Normalizes an arbitrary prerender route into a valid, canonical HTML bundle asset path.
 * Returns null if the input is not a valid string.
 */
export function sanitizePrerenderRoute(route: unknown): string | null {
  if (typeof route !== 'string') {
    return null;
  }

  const withoutQuery = (route.split('?')[0] ?? '').split('#')[0] ?? '';
  const collapsed = withoutQuery.trim().replace(/\/+/g, '/');
  const trimmed = collapsed.replace(/^\/+|\/+$/g, '');

  if (trimmed === '' || trimmed === 'index') {
    return 'index.html';
  }

  if (trimmed.endsWith('.html')) {
    return trimmed;
  }

  return `${trimmed}.html`;
}

/**
 * Renders custom element tags in an HTML string into genuine Declarative Shadow DOM
 * using @lit-core/ssr.
 */
export function transformHtmlWithSsr(html: string, options: SsrOptions = {}): string {
  if (typeof html !== 'string' || html.length === 0) {
    return html;
  }

  installIsolateGlobals();

  if (typeof (globalThis as any).HTMLElement?.prototype?.attachInternals === 'undefined') {
    (globalThis as any).HTMLElement.prototype.attachInternals = function () {
      return {
        shadowRoot: this.shadowRoot,
        setFormValue() {},
        setValidity() {},
        checkValidity() {
          return true;
        },
        reportValidity() {
          return true;
        },
      };
    };
  }

  const baseRegistry = options.customElements ?? (globalThis as any).customElements;
  const registry = new IsolateCustomElementRegistry(baseRegistry);
  const domPaths = Boolean(options.domPaths);
  const resumable = Boolean(options.resumable);
  const islands = Boolean(options.islands);

  // 1. Stash protected blocks (comments, scripts, styles)
  const protectedBlocks: string[] = [];
  let tokenizedHtml = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, (match) => {
    const token = `<!--__LIT_PROTECTED_BLOCK_${protectedBlocks.length}__-->`;
    protectedBlocks.push(match);
    return token;
  });

  // If domPaths is requested, ensure data-lit-paths is added to custom elements
  if (domPaths) {
    tokenizedHtml = tokenizedHtml.replace(/<([a-z][a-z0-9._-]*-[a-z0-9._-]*)([^>]*)>/gi, (match, tag, attrs) => {
      if (!attrs.includes('data-lit-paths')) {
        return `<${tag}${attrs} data-lit-paths="true">`;
      }
      return match;
    });
  }

  // 2. Identify custom elements and register fallback stub for unregistered elements
  const customTagRegex = /<([a-z][a-z0-9._-]*-[a-z0-9._-]*)(?=[\s>/])/gi;
  let tagMatch = customTagRegex.exec(tokenizedHtml);
  while (tagMatch !== null) {
    const tagName = tagMatch[1].toLowerCase();
    if (!registry.get(tagName)) {
      class FallbackComponent extends HTMLElementStub {
        render() {
          return { strings: ['<slot></slot>'], values: [] };
        }
      }
      try {
        registry.define(tagName, FallbackComponent);
      } catch {
        // Element already defined
      }
    }
    tagMatch = customTagRegex.exec(tokenizedHtml);
  }

  // 3. Render HTML using @lit-core/ssr
  const templateResult = { strings: [tokenizedHtml], values: [] };
  let renderedHtml = renderToString(templateResult, {
    customElements: registry,
    domPaths,
    resumable,
    mode: 'dsd',
  });

  // 4. Restore protected blocks
  for (let i = 0; i < protectedBlocks.length; i++) {
    renderedHtml = renderedHtml.replace(`<!--__LIT_PROTECTED_BLOCK_${i}__-->`, protectedBlocks[i]);
  }

  // 5. Inject islands loader microloader if islands option is enabled
  if (islands && !renderedHtml.includes('islands-loader')) {
    const islandScript = `<script type="module" src="/@id/__x00__virtual:lit-core/islands-loader.js"></script>`;
    if (renderedHtml.includes('</head>')) {
      renderedHtml = renderedHtml.replace('</head>', `  ${islandScript}\n</head>`);
    } else if (renderedHtml.includes('</body>')) {
      renderedHtml = renderedHtml.replace('</body>', `  ${islandScript}\n</body>`);
    } else {
      renderedHtml += islandScript;
    }
  }

  // 6. Inject state snapshot if resumable mode is enabled and not already present
  if (resumable && !renderedHtml.includes('<script type="lit/state">') && options.injectState !== false) {
    const stateScript = '<script type="lit/state">{}</script>';
    if (renderedHtml.includes('</body>')) {
      renderedHtml = renderedHtml.replace('</body>', `  ${stateScript}\n</body>`);
    } else {
      renderedHtml += stateScript;
    }
  }

  return renderedHtml;
}

const STATIC_ASSET_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.tiff',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.wasm',
  '.map',
  '.json',
  '.webmanifest',
  '.mp4',
  '.webm',
  '.ogg',
  '.mp3',
  '.wav',
  '.flac',
  '.aac',
  '.pdf',
  '.zip',
  '.gz',
  '.br',
]);

function isStaticAssetRequest(url: string): boolean {
  if (url.startsWith('/@') || url.startsWith('/__')) {
    return true;
  }
  const pathname = (url.split('?')[0] ?? '').split('#')[0] ?? '';
  const ext = path.extname(pathname).toLowerCase();
  return ext !== '' && STATIC_ASSET_EXTENSIONS.has(ext);
}

function validateComponentSyntax(code: string, filename: string): void {
  const sourceFile = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') || filename.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  const diagnostics = (sourceFile as any).parseDiagnostics;
  if (diagnostics && diagnostics.length > 0) {
    const firstDiag = diagnostics[0];
    const rawMessage = typeof firstDiag.messageText === 'string' ? firstDiag.messageText : firstDiag.messageText.messageText;
    throw new Error(`Malformed component template syntax: ${rawMessage}`);
  }
}

function transformIslandsAst(sourceText: string, filename: string, options: SsrOptions): { code: string; modified: boolean } | null {
  const islandsConfig = typeof options.islands === 'object' ? options.islands : null;
  const includePatterns = islandsConfig?.include;
  const excludePatterns = islandsConfig?.exclude;
  const isAllIslands = options.islands === true || (!includePatterns && !excludePatterns);

  const sourceFile = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') || filename.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  const classToTag = new Map<string, string>();
  function scanRegistrations(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const calleeText = node.expression.getText(sourceFile);
      if ((calleeText === 'customElements.define' || calleeText === 'window.customElements.define' || calleeText === 'globalThis.customElements.define') && node.arguments.length >= 2) {
        const firstArg = node.arguments[0];
        const secondArg = node.arguments[1];
        if (ts.isStringLiteral(firstArg)) {
          classToTag.set(secondArg.getText(sourceFile), firstArg.text);
        }
      }
    }
    ts.forEachChild(node, scanRegistrations);
  }
  scanRegistrations(sourceFile);

  function getTagFromDecorators(node: ts.ClassDeclaration | ts.ClassExpression): string | null {
    const decorators = typeof ts.canHaveDecorators === 'function' && ts.canHaveDecorators(node) ? ts.getDecorators(node) : (node as any).decorators;
    if (decorators) {
      for (const dec of decorators) {
        if (ts.isCallExpression(dec.expression)) {
          const calleeText = dec.expression.expression.getText(sourceFile);
          if ((calleeText === 'customElement' || calleeText.endsWith('.customElement')) && dec.expression.arguments.length > 0) {
            const firstArg = dec.expression.arguments[0];
            if (ts.isStringLiteral(firstArg)) {
              return firstArg.text;
            }
          }
        }
      }
    }
    return null;
  }

  function matchesIslandCriteria(tag: string | null, isCustomElement: boolean): boolean {
    if (excludePatterns && tag && excludePatterns.some((p) => tag === p || tag.includes(p))) {
      return false;
    }
    if (isAllIslands) {
      return isCustomElement;
    }
    if (!tag || !includePatterns) {
      return false;
    }
    return includePatterns.some((pattern) => tag === pattern || tag.includes(pattern));
  }

  let modified = false;

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => (rootNode) => {
    function visitor(node: ts.Node): ts.Node {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        let tag = getTagFromDecorators(node);
        if (!tag && node.name) {
          tag = classToTag.get(node.name.text) ?? null;
        }

        let isCustomElement = Boolean(tag);
        if (!isCustomElement && node.heritageClauses) {
          for (const hc of node.heritageClauses) {
            if (hc.token === ts.SyntaxKind.ExtendsKeyword) {
              for (const type of hc.types) {
                const exprText = type.expression.getText(sourceFile);
                if (exprText.includes('LitElement') || exprText.includes('ReactiveElement') || exprText.includes('HTMLElement')) {
                  isCustomElement = true;
                  break;
                }
              }
            }
          }
        }

        const shouldTag = matchesIslandCriteria(tag, isCustomElement);

        const hasExistingIslandProp = node.members.some((member) => {
          if (ts.isPropertyDeclaration(member) && member.name) {
            const nameText = member.name.getText(sourceFile);
            const isStatic = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
            return nameText === '__isIsland' && isStatic;
          }
          return false;
        });

        if (shouldTag && !hasExistingIslandProp) {
          modified = true;
          const islandProperty = ts.factory.createPropertyDeclaration(
            [ts.factory.createModifier(ts.SyntaxKind.StaticKeyword)],
            ts.factory.createIdentifier('__isIsland'),
            undefined,
            undefined,
            ts.factory.createTrue(),
          );

          const updatedMembers = [islandProperty, ...node.members];

          if (ts.isClassDeclaration(node)) {
            return ts.factory.updateClassDeclaration(node, node.modifiers, node.name, node.typeParameters, node.heritageClauses, updatedMembers);
          }
          return ts.factory.updateClassExpression(node, node.modifiers, node.name, node.typeParameters, node.heritageClauses, updatedMembers);
        }
      }
      return ts.visitEachChild(node, visitor, context);
    }
    return ts.visitNode(rootNode, visitor) as ts.SourceFile;
  };

  const transformationResult = ts.transform(sourceFile, [transformer]);
  if (!modified) {
    return null;
  }

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  let printedCode = printer.printFile(transformationResult.transformed[0]);
  printedCode = printedCode.replace(/\{\n\s+static __isIsland = true;/g, '{\n  static __isIsland = true;');

  return {
    code: printedCode,
    modified: true,
  };
}

/**
 * First-class server-side rendering sub-plugin for @lit-core/vite-plugin.
 */
export function ssr(options: SsrOptions = {}): Plugin {
  let config: ResolvedConfig | undefined;
  let isServerBuild = false;

  return {
    name: 'lit-ssr',
    enforce: 'post',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
      isServerBuild = Boolean(config.build?.ssr);
    },

    resolveId(id) {
      const cleanId = id.split('?')[0];
      if (cleanId === 'virtual:lit-core/ssr-runtime' || cleanId === 'virtual:lit-core/ssr-runtime.js') {
        return '\0virtual:lit-core/ssr-runtime.js';
      }
      if (cleanId === 'virtual:lit-core/islands-loader' || cleanId === 'virtual:lit-core/islands-loader.js') {
        return '\0virtual:lit-core/islands-loader.js';
      }
      if (cleanId === '@lit-core/ssr/client') {
        return '\0virtual:lit-core/ssr-runtime.js';
      }
      if (isVirtualLitCoreId(id)) {
        return formatVirtualLitCoreId(id);
      }
      return undefined;
    },

    load(id) {
      const cleanId = id.split('?')[0];
      if (cleanId === '\0virtual:lit-core/ssr-runtime.js' || cleanId === '\0virtual:lit-core/ssr-runtime') {
        return {
          code: SSR_RUNTIME_SOURCE,
          map: null,
        };
      }
      if (cleanId === '\0virtual:lit-core/islands-loader.js' || cleanId === '\0virtual:lit-core/islands-loader') {
        return {
          code: ISLANDS_LOADER_SOURCE,
          map: null,
        };
      }
      return undefined;
    },

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[jt]sx?$/.test(cleanId)) {
        return null;
      }

      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      } else if (!options.include && !options.islands && cleanId.includes('/node_modules/')) {
        return null;
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      // Fast check for Lit code
      if (!LIT_SSR_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        validateComponentSyntax(code, cleanId);

        if (options.islands && !isServerBuild) {
          const result = transformIslandsAst(code, cleanId, options);
          if (result) {
            return {
              code: result.code,
              map: null,
            };
          }
        }

        return null;
      } catch (err) {
        reportTransformError(this, 'lit-ssr', cleanId, err);
      }
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' || !req.headers.accept?.includes('text/html')) {
          return next();
        }
        const url = req.url || '/';
        if (isStaticAssetRequest(url)) {
          return next();
        }

        try {
          const rootDir = config?.root || process.cwd();
          const indexHtmlPath = path.resolve(rootDir, 'index.html');
          let rawHtml = fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, 'utf-8') : '<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>';

          rawHtml = await server.transformIndexHtml(url, rawHtml);

          let renderedContent: any = rawHtml;
          if (options.entry) {
            try {
              const mod = await server.ssrLoadModule(options.entry);
              const renderFn = mod.render || mod.default;
              if (typeof renderFn === 'function') {
                renderedContent = await renderFn(url, { req, res });
              }
            } catch {}
          } else {
            renderedContent = transformHtmlWithSsr(rawHtml, options);
          }

          const isStreaming = options.streaming !== false;
          if (isStreaming && renderedContent && typeof renderedContent.getReader === 'function') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Transfer-Encoding', 'chunked');
            const reader = (renderedContent as ReadableStream<Uint8Array>).getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) res.write(value);
            }
            res.end();
          } else {
            const finalHtml = typeof renderedContent === 'string' ? renderedContent : await collectResult(renderedContent);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(finalHtml);
          }
        } catch (err) {
          if (typeof server.ssrFixStacktrace === 'function' && err instanceof Error) {
            server.ssrFixStacktrace(err);
          }
          if (res.headersSent) {
            try {
              if (typeof (res as any).destroy === 'function') {
                (res as any).destroy(err as any);
              } else if (!res.writableEnded && !res.finished) {
                res.end();
              }
            } catch {}
          } else {
            next(err);
          }
        }
      });
    },

    transformIndexHtml(html: string) {
      return transformHtmlWithSsr(html, options);
    },

    async generateBundle(_outputOptions, bundle) {
      if (!options.prerender) return;

      const prerenderConfig = typeof options.prerender === 'object' ? options.prerender : {};
      const rawRoutes = prerenderConfig.routes ?? ['/'];
      if (!Array.isArray(rawRoutes) || rawRoutes.length === 0) return;

      const validRoutes: { raw: string; fileName: string }[] = [];
      for (const r of rawRoutes) {
        const sanitized = sanitizePrerenderRoute(r);
        if (sanitized) {
          validRoutes.push({ raw: String(r), fileName: sanitized });
        }
      }
      if (validRoutes.length === 0) return;

      // Locate client entry JS chunk from bundle
      const entryChunk = Object.values(bundle).find((c: any) => c.type === 'chunk' && Boolean(c.isEntry)) || (Object.values(bundle).find((c: any) => c.type === 'chunk') as any);
      const clientScriptTag = entryChunk ? `<script type="module" src="/assets/${entryChunk.fileName}"></script>` : '';

      // Base template resolution
      const rootDir = config?.root || process.cwd();
      const indexHtmlPath = path.resolve(rootDir, 'index.html');
      let baseTemplate = '';
      if (bundle['index.html'] && (bundle['index.html'] as any).source) {
        baseTemplate = String((bundle['index.html'] as any).source);
      } else if (fs.existsSync(indexHtmlPath)) {
        baseTemplate = fs.readFileSync(indexHtmlPath, 'utf-8');
      }

      // Check if entry module or server render function exists
      let serverEntryMod: any = null;
      const entryPath = options.entry || prerenderConfig.entry;
      if (entryPath) {
        try {
          const resolvedEntry = path.isAbsolute(entryPath) ? entryPath : path.resolve(rootDir, entryPath);
          serverEntryMod = await import(resolvedEntry);
        } catch {}
      }

      for (const { raw, fileName } of validRoutes) {
        let routeHtml = '';

        if (serverEntryMod) {
          const renderFn = serverEntryMod.render || serverEntryMod.default || serverEntryMod.template;
          if (typeof renderFn === 'function') {
            const renderResult = await renderFn(raw);
            routeHtml = typeof renderResult === 'string' ? transformHtmlWithSsr(renderResult, options) : renderToString(renderResult, { customElements: options.customElements });
          } else if (renderFn && typeof renderFn === 'object') {
            routeHtml = renderToString(renderFn, { customElements: options.customElements });
          }
        }

        if (!routeHtml) {
          if (baseTemplate) {
            routeHtml = transformHtmlWithSsr(baseTemplate, options);
          } else {
            let bodyMarkup = '<div id="app"></div>';
            if (entryChunk?.code) {
              const match = /<([a-z][a-z0-9._-]*-[a-z0-9._-]*)[^>]*>([\s\S]*?)<\/\1>/i.exec(entryChunk.code);
              if (match) {
                bodyMarkup = transformHtmlWithSsr(match[0], options);
              }
            }
            routeHtml = `<!DOCTYPE html><html><head>${clientScriptTag}</head><body>${bodyMarkup}</body></html>`;
          }
        }

        if (clientScriptTag && !routeHtml.includes(entryChunk.fileName)) {
          if (routeHtml.includes('</head>')) {
            routeHtml = routeHtml.replace('</head>', `  ${clientScriptTag}\n</head>`);
          } else if (routeHtml.includes('<body>')) {
            routeHtml = routeHtml.replace('<body>', `<head>${clientScriptTag}</head><body>`);
          } else {
            routeHtml = `${clientScriptTag}${routeHtml}`;
          }
        }

        const existingAsset = bundle[fileName];
        if (existingAsset && existingAsset.type === 'asset') {
          existingAsset.source = routeHtml;
        } else {
          this.emitFile({
            type: 'asset',
            fileName,
            source: routeHtml,
          });
        }
      }
    },
  };
}

export const litSsr = ssr;
