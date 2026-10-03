(() => {
  const W = window,
    D = document,
    C = customElements,
    R = '__lit_resumed__';
  const M = W.__LIT_RESUMABLE_MANIFEST__ || __MANIFEST__,
    B = [],
    L = new Set();
  const uG = (t) => (L.has(t) || (L.add(t), M[t] && import(M[t]).catch(() => {})), C.whenDefined(t));
  const iT = (e) =>
    e?.nodeType === 1 && (/^(BUTTON|INPUT|SELECT|A)$/i.test(e.tagName) || e.tabIndex >= 0 || e.localName?.includes('-') || /tabindex|data-resumable|resumes-/.test(e.getAttributeNames?.()));
  const hI = async (e) => {
    if (e[R]) return;
    const p = e.composedPath?.() || [];
    if (!p.some(iT)) return;
    const u = [...new Set(p.map((l) => l.localName).filter((n) => n?.includes('-') && !C.get(n)))];
    if (!u.length) return;
    if (e.type === 'pointerover' || (/^p.*d|f.*n$/.test(e.type) && !p.some((l) => l.hasAttribute?.(`resumes-on-${e.type}`)))) return u.forEach(uG);
    e.cancelable && e.preventDefault();
    e.stopImmediatePropagation();
    B.push({ e, t: e.target, h: p.find((l) => l.localName?.includes('-')) });
    await Promise.all(u.map(uG));
    for (const { e: o, t, h } of B.splice(0)) {
      let v;
      try {
        v = new o.constructor(o.type, o);
      } catch {
        v = new CustomEvent(o.type, o);
      }
      v[R] = 1;
      (t?.isConnected ? t : h)?.dispatchEvent(v);
    }
  };
  __EVENTS__.forEach((t) => {
    W.addEventListener(t, hI, true);
  });
  if (__IDLE_HYDRATION__) {
    const q = W.requestIdleCallback || ((c) => setTimeout(c, 50));
    const s = (r) => [...r.querySelectorAll('*')].flatMap((e) => (e.shadowRoot ? [e, ...s(e.shadowRoot)] : e));
    const f = () => {
      const t = s(D).find((e) => e.localName?.includes('-') && !C.get(e.localName));
      if (t) uG(t.localName).then(() => q(f, { timeout: __IDLE_TIMEOUT__ }));
    };
    q(f, { timeout: __IDLE_TIMEOUT__ });
  }
})();
