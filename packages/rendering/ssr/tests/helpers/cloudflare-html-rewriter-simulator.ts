/**
 * Test helper simulator for Cloudflare HTMLRewriter (lol-html).
 * Faithfully reproduces lol-html's streaming behaviors for unit and integration tests:
 * 1. If an `element(el)` handler returns a Promise, the tokenizer pauses at that byte until it resolves.
 * 2. Strings injected via `el.prepend(content, { html: true })` are emitted verbatim and never re-parsed.
 */

import { escapeAttribute, isThenable } from '../../src/compiler-bridge.js';
import type {
  HtmlRewriterDocumentEndLike,
  HtmlRewriterDocumentHandler,
  HtmlRewriterElementHandler,
  HtmlRewriterElementLike,
  HtmlRewriterEndTagLike,
  HtmlRewriterLike,
} from '../../src/html-rewriter.js';

export class CloudflareHtmlRewriterSimulator implements HtmlRewriterLike {
  private readonly elementHandlers: Array<{ selector: string; handler: HtmlRewriterElementHandler }> = [];
  private readonly documentHandlers: HtmlRewriterDocumentHandler[] = [];

  public on(selector: string, handler: HtmlRewriterElementHandler): this {
    this.elementHandlers.push({ selector: selector.toLowerCase(), handler });
    return this;
  }

  public onDocument(handler: HtmlRewriterDocumentHandler): this {
    this.documentHandlers.push(handler);
    return this;
  }

  public transform(response: Response): Response {
    const encoder = new TextEncoder();
    const elementHandlers = [...this.elementHandlers];
    const documentHandlers = [...this.documentHandlers];

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const html = await response.text();
          const tagRegex = /<(\/?)([a-zA-Z][a-zA-Z0-9._-]*)((?:\s+[^>"']*|"[^"]*"|'[^']*')*)\s*(\/?)>/g;
          let lastIndex = 0;
          const endTagCallbacks = new Map<string, Array<(endTag: HtmlRewriterEndTagLike) => void | Promise<void>>>();

          let match = tagRegex.exec(html);
          while (match !== null) {
            const fullMatch = match[0];
            const isClosing = match[1] === '/';
            const rawTagName = match[2];
            const tagName = rawTagName.toLowerCase();
            const rawAttrs = match[3] || '';
            const isSelfClosing = match[4] === '/';
            const matchStart = match.index;

            if (matchStart > lastIndex) {
              controller.enqueue(encoder.encode(html.slice(lastIndex, matchStart)));
            }

            if (!isClosing) {
              const matchedHandlers = elementHandlers.filter((h) => h.selector === '*' || h.selector === tagName);

              if (matchedHandlers.length === 0) {
                controller.enqueue(encoder.encode(fullMatch));
              } else {
                const attrMap = new Map<string, string>();
                const attrRegex = /([\w\-.:?@]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
                let aMatch = attrRegex.exec(rawAttrs);
                while (aMatch !== null) {
                  attrMap.set(aMatch[1], aMatch[2] ?? aMatch[3] ?? aMatch[4] ?? '');
                  aMatch = attrRegex.exec(rawAttrs);
                }

                const beforeChunks: string[] = [];
                const prependChunks: string[] = [];
                const appendChunks: string[] = [];
                const afterChunks: string[] = [];
                let replacedContent: string | null = null;
                let removed = false;
                const registeredEndTagCbs: Array<(endTag: HtmlRewriterEndTagLike) => void | Promise<void>> = [];

                const elStub: HtmlRewriterElementLike = {
                  tagName: rawTagName,
                  get attributes() {
                    return attrMap.entries();
                  },
                  getAttribute(name: string) {
                    return attrMap.get(name) ?? null;
                  },
                  setAttribute(name: string, value: string) {
                    attrMap.set(name, String(value));
                    return elStub;
                  },
                  hasAttribute(name: string) {
                    return attrMap.has(name);
                  },
                  removeAttribute(name: string) {
                    attrMap.delete(name);
                    return elStub;
                  },
                  prepend(content: string) {
                    prependChunks.unshift(content);
                    return elStub;
                  },
                  append(content: string) {
                    appendChunks.push(content);
                    return elStub;
                  },
                  before(content: string) {
                    beforeChunks.push(content);
                    return elStub;
                  },
                  after(content: string) {
                    afterChunks.unshift(content);
                    return elStub;
                  },
                  replace(content: string) {
                    replacedContent = content;
                    return elStub;
                  },
                  remove() {
                    removed = true;
                    return elStub;
                  },
                  onEndTag(cb) {
                    registeredEndTagCbs.push(cb);
                  },
                };

                // lol-html invariant #1: if handler.element(el) returns a Promise, awaiting it here
                // pauses the tokenizer at this exact byte before advancing to the next tag!
                for (const { handler } of matchedHandlers) {
                  if (typeof handler.element === 'function') {
                    const maybePromise = handler.element(elStub);
                    if (isThenable(maybePromise)) {
                      await maybePromise;
                    }
                  }
                }

                if (registeredEndTagCbs.length > 0 && !isSelfClosing) {
                  let stack = endTagCallbacks.get(tagName);
                  if (!stack) {
                    stack = [];
                    endTagCallbacks.set(tagName, stack);
                  }
                  stack.push(...registeredEndTagCbs);
                }

                let serializedAttrs = '';
                for (const [k, v] of attrMap.entries()) {
                  serializedAttrs += v === '' ? ` ${k}` : ` ${k}="${escapeAttribute(v)}"`;
                }

                let openOut = '';
                for (const c of beforeChunks) openOut += c;
                if (!removed) {
                  if (replacedContent !== null) {
                    openOut += replacedContent;
                  } else if (isSelfClosing) {
                    openOut += `<${rawTagName}${serializedAttrs}/>`;
                  } else {
                    openOut += `<${rawTagName}${serializedAttrs}>`;
                    // lol-html invariant #2: prependChunks are emitted verbatim without re-parsing
                    for (const c of prependChunks) openOut += c;
                  }
                }
                if (isSelfClosing) {
                  for (const c of afterChunks) openOut += c;
                }
                if (openOut.length > 0) {
                  controller.enqueue(encoder.encode(openOut));
                }
              }
            } else {
              // Closing tag </tagName>
              const stack = endTagCallbacks.get(tagName);
              if (stack && stack.length > 0) {
                const cbs = stack.splice(0, stack.length);
                const beforeEndChunks: string[] = [];
                const afterEndChunks: string[] = [];
                let endRemoved = false;
                const endTagStub: HtmlRewriterEndTagLike = {
                  name: tagName,
                  before(content: string) {
                    beforeEndChunks.push(content);
                    return endTagStub;
                  },
                  after(content: string) {
                    afterEndChunks.push(content);
                    return endTagStub;
                  },
                  remove() {
                    endRemoved = true;
                    return endTagStub;
                  },
                };
                for (const cb of cbs) {
                  await cb(endTagStub);
                }
                let closeOut = '';
                for (const c of beforeEndChunks) closeOut += c;
                if (!endRemoved) closeOut += fullMatch;
                for (const c of afterEndChunks) closeOut += c;
                if (closeOut.length > 0) {
                  controller.enqueue(encoder.encode(closeOut));
                }
              } else {
                controller.enqueue(encoder.encode(fullMatch));
              }
            }

            lastIndex = matchStart + fullMatch.length;
            match = tagRegex.exec(html);
          }

          if (lastIndex < html.length) {
            controller.enqueue(encoder.encode(html.slice(lastIndex)));
          }

          if (documentHandlers.length > 0) {
            const docEndChunks: string[] = [];
            const docEndStub: HtmlRewriterDocumentEndLike = {
              append(content: string) {
                docEndChunks.push(content);
                return docEndStub;
              },
            };
            for (const docHandler of documentHandlers) {
              if (typeof docHandler.end === 'function') {
                await docHandler.end(docEndStub);
              }
            }
            if (docEndChunks.length > 0) {
              controller.enqueue(encoder.encode(docEndChunks.join('')));
            }
          }

          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
  }
}
