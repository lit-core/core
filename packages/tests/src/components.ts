import fs from 'node:fs';
import path from 'node:path';

export interface ComponentDescriptor {
  name: string;
  tag: string;
  pkg: string;
  source: string;
  css?: string;
  className?: string;
}

import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);

/**
 * Locate the root directory for a given package, resolving through Node.js module resolution
 * from the tests package context or falling back across monorepo workspace candidate paths.
 */
export function resolvePackageDir(pkg: string): string {
  if (pkg === '@spectrum-web-components') {
    try {
      const bundlePkg = req.resolve('@spectrum-web-components/bundle/package.json');
      const parentDir = path.dirname(path.dirname(bundlePkg));
      if (fs.existsSync(parentDir)) return fs.realpathSync(parentDir);
    } catch {}
  }

  // 1. Try direct package.json resolution
  try {
    const pkgJsonPath = req.resolve(`${pkg}/package.json`);
    return fs.realpathSync(path.dirname(pkgJsonPath));
  } catch {}

  // 2. Try entry point resolution and walk up to package.json (handles packages without package.json in exports)
  try {
    const entryPath = req.resolve(pkg);
    let curr = path.dirname(entryPath);
    while (curr !== path.dirname(curr)) {
      if (fs.existsSync(path.join(curr, 'package.json'))) {
        return fs.realpathSync(curr);
      }
      curr = path.dirname(curr);
    }
  } catch {}

  // 3. Fallback candidates in monorepo
  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  const candidates = [path.resolve(thisDir, '../node_modules', pkg), path.resolve(process.cwd(), 'node_modules', pkg), path.resolve(thisDir, '../../../node_modules', pkg)];
  for (const c of candidates) {
    if (fs.existsSync(c)) return fs.realpathSync(c);
  }

  throw new Error(`Package directory could not be resolved: ${pkg}`);
}

/**
 * Validate that all required paths and properties in a component descriptor exist.
 */
export function validateComponentDescriptor(comp: ComponentDescriptor): void {
  if (!comp.name || !comp.tag || !comp.pkg || !comp.source) {
    throw new Error(`Incomplete component descriptor for tag: ${comp.tag}`);
  }
  const pkgDir = resolvePackageDir(comp.pkg);
  const srcFile = path.join(pkgDir, comp.source);
  if (!fs.existsSync(srcFile)) {
    throw new Error(`Component source file does not exist: ${srcFile}`);
  }
  if (comp.css) {
    const cssFile = path.join(pkgDir, comp.css);
    if (!fs.existsSync(cssFile)) {
      throw new Error(`Component stylesheet file does not exist: ${cssFile}`);
    }
  }
}

/**
 * Load and validate all Carbon Web Components directly from official custom-elements.json and es/ artifacts.
 */
function loadCarbonComponents(): ComponentDescriptor[] {
  const pkg = '@carbon/web-components';
  const pkgDir = resolvePackageDir(pkg);
  const cemPath = path.join(pkgDir, 'custom-elements.json');
  if (!fs.existsSync(cemPath)) {
    throw new Error(`Carbon Web Components manifest not found at ${cemPath}`);
  }

  const cem = JSON.parse(fs.readFileSync(cemPath, 'utf-8'));
  const tags = (cem.tags || []).filter((t: { name: string }) => t.name.startsWith('cds-'));
  const components: ComponentDescriptor[] = [];
  const seenTags = new Set<string>();

  for (const t of tags) {
    if (seenTags.has(t.name)) continue;
    seenTags.add(t.name);

    const esPath = t.path.replace(/^\.\/src\//, 'es/').replace(/\.ts$/, '.js');
    const fullEsPath = path.join(pkgDir, esPath);
    if (!fs.existsSync(fullEsPath)) continue;

    const content = fs.readFileSync(fullEsPath, 'utf-8');
    const classMatch = /class\s+([A-Za-z0-9_$]+)\s+extends\s+/.exec(content);
    const className = classMatch ? classMatch[1] : undefined;

    const dir = path.dirname(fullEsPath);
    const baseName = path.basename(esPath, '.js');
    let cssPath: string | undefined;

    const directScss = path.join(dir, `${baseName}.scss.js`);
    if (fs.existsSync(directScss)) {
      cssPath = path.relative(pkgDir, directScss);
    } else if (fs.existsSync(dir)) {
      const scssFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.scss.js'));
      if (scssFiles.length > 0) {
        cssPath = path.relative(pkgDir, path.join(dir, scssFiles[0]));
      }
    }

    const desc: ComponentDescriptor = {
      name: t.name.replace(/^cds-/, ''),
      tag: t.name,
      pkg,
      source: esPath,
      ...(cssPath ? { css: cssPath } : {}),
      ...(className ? { className } : {}),
    };
    validateComponentDescriptor(desc);
    components.push(desc);
  }

  components.sort((a, b) => a.tag.localeCompare(b.tag));
  return components;
}

/**
 * Load and validate all Adobe Spectrum Web Components from individual package custom-elements.json manifests.
 */
function loadSpectrumComponents(): ComponentDescriptor[] {
  const pkg = '@spectrum-web-components';
  const specDir = resolvePackageDir(pkg);
  if (!fs.existsSync(specDir)) {
    throw new Error(`Spectrum Web Components directory not found at ${specDir}`);
  }

  const subpkgs = fs.readdirSync(specDir).filter((f) => !f.startsWith('.'));
  const components: ComponentDescriptor[] = [];
  const seenTags = new Set<string>();

  for (const sub of subpkgs) {
    if (sub === 'icons-workflow' || sub === 'icons-ui') continue;

    const cemPath = path.join(specDir, sub, 'custom-elements.json');
    if (!fs.existsSync(cemPath)) continue;

    try {
      const cem = JSON.parse(fs.readFileSync(cemPath, 'utf-8'));
      for (const mod of cem.modules || []) {
        for (const dec of mod.declarations || []) {
          if (dec.customElement && dec.tagName) {
            if (seenTags.has(dec.tagName)) continue;
            seenTags.add(dec.tagName);

            let sourceRel = path.join(sub, mod.path);
            let fullSource = path.join(specDir, sourceRel);

            if (!fs.existsSync(fullSource)) {
              sourceRel = path.join(sub, 'src', path.basename(mod.path));
              fullSource = path.join(specDir, sourceRel);
            }

            if (!fs.existsSync(fullSource)) continue;

            const base = path.basename(sourceRel, '.js');
            const kebabBase = dec.tagName.replace(/^sp-/, '');
            let cssRel: string | undefined;

            const candidateCss = [path.join(sub, 'src', `${kebabBase}.css.js`), path.join(sub, 'src', `${base.toLowerCase()}.css.js`), path.join(sub, `${kebabBase}.css.js`)];
            for (const c of candidateCss) {
              if (fs.existsSync(path.join(specDir, c))) {
                cssRel = c;
                break;
              }
            }

            const desc: ComponentDescriptor = {
              name: dec.tagName.replace(/^sp-/, ''),
              tag: dec.tagName,
              pkg,
              source: sourceRel,
              ...(cssRel ? { css: cssRel } : {}),
              ...(dec.name ? { className: dec.name } : {}),
            };
            validateComponentDescriptor(desc);
            components.push(desc);
          }
        }
      }
    } catch {}
  }

  components.sort((a, b) => a.tag.localeCompare(b.tag));
  return components;
}

/**
 * Load and validate all Web Awesome components directly from official dist/custom-elements.json.
 */
function loadWebAwesomeComponents(): ComponentDescriptor[] {
  const pkg = '@awesome.me/webawesome';
  const pkgDir = resolvePackageDir(pkg);
  const cemPath = path.join(pkgDir, 'dist/custom-elements.json');
  if (!fs.existsSync(cemPath)) {
    throw new Error(`Web Awesome manifest not found at ${cemPath}`);
  }

  const cem = JSON.parse(fs.readFileSync(cemPath, 'utf-8'));
  const components: ComponentDescriptor[] = [];
  const seenTags = new Set<string>();

  for (const mod of cem.modules || []) {
    for (const dec of mod.declarations || []) {
      if (dec.customElement && dec.tagName) {
        if (seenTags.has(dec.tagName)) continue;
        seenTags.add(dec.tagName);

        const sourcePath = path.join('dist', mod.path);
        const fullSourcePath = path.join(pkgDir, sourcePath);
        if (!fs.existsSync(fullSourcePath)) continue;

        const baseStyle = sourcePath.replace(/\.js$/, '.styles.js');
        let cssPath: string | undefined;
        if (fs.existsSync(path.join(pkgDir, baseStyle))) {
          cssPath = baseStyle;
        }

        const desc: ComponentDescriptor = {
          name: dec.tagName.replace(/^wa-/, ''),
          tag: dec.tagName,
          pkg,
          source: sourcePath,
          ...(cssPath ? { css: cssPath } : {}),
          ...(dec.name ? { className: dec.name } : {}),
        };
        validateComponentDescriptor(desc);
        components.push(desc);
      }
    }
  }

  components.sort((a, b) => a.tag.localeCompare(b.tag));
  return components;
}

/**
 * Load and validate all Material Web components directly from official custom-elements.json.
 */
function loadMaterialComponents(): ComponentDescriptor[] {
  const pkg = '@material/web';
  const pkgDir = resolvePackageDir(pkg);
  const cemPath = path.join(pkgDir, 'custom-elements.json');
  if (!fs.existsSync(cemPath)) {
    throw new Error(`Material Web manifest not found at ${cemPath}`);
  }

  const cem = JSON.parse(fs.readFileSync(cemPath, 'utf-8'));
  const components: ComponentDescriptor[] = [];
  const seenTags = new Set<string>();

  for (const mod of cem.modules || []) {
    for (const dec of mod.declarations || []) {
      if (dec.customElement && dec.tagName) {
        if (seenTags.has(dec.tagName)) continue;
        seenTags.add(dec.tagName);

        const sourcePath = mod.path;
        const fullSourcePath = path.join(pkgDir, sourcePath);
        if (!fs.existsSync(fullSourcePath)) continue;

        const dir = path.dirname(fullSourcePath);
        const baseName = path.basename(sourcePath, '.js');
        let cssPath: string | undefined;

        const internalDir = path.join(dir, 'internal');
        if (fs.existsSync(internalDir)) {
          const files = fs.readdirSync(internalDir);
          const directMatch = files.find((f) => f.includes(baseName) && f.endsWith('.cssresult.js'));
          const anyStyle = directMatch || files.find((f) => f.endsWith('-styles.cssresult.js')) || files.find((f) => f.endsWith('.cssresult.js'));
          if (anyStyle) {
            cssPath = path.relative(pkgDir, path.join(internalDir, anyStyle));
          }
        }

        const desc: ComponentDescriptor = {
          name: dec.tagName.replace(/^md-/, ''),
          tag: dec.tagName,
          pkg,
          source: sourcePath,
          ...(cssPath ? { css: cssPath } : {}),
          ...(dec.name ? { className: dec.name } : {}),
        };
        validateComponentDescriptor(desc);
        components.push(desc);
      }
    }
  }

  components.sort((a, b) => a.tag.localeCompare(b.tag));
  return components;
}

/**
 * Load and validate all Cisco Momentum Design components directly from official dist/custom-elements.json.
 */
function loadMomentumComponents(): ComponentDescriptor[] {
  const pkg = '@momentum-design/components';
  const pkgDir = resolvePackageDir(pkg);
  const cemPath = path.join(pkgDir, 'dist/custom-elements.json');
  if (!fs.existsSync(cemPath)) {
    throw new Error(`Momentum Design manifest not found at ${cemPath}`);
  }

  const cem = JSON.parse(fs.readFileSync(cemPath, 'utf-8'));
  const components: ComponentDescriptor[] = [];
  const seenTags = new Set<string>();

  for (const mod of cem.modules || []) {
    for (const dec of mod.declarations || []) {
      if (dec.customElement && dec.tagName) {
        if (seenTags.has(dec.tagName)) continue;
        seenTags.add(dec.tagName);

        const sourcePath = path.join('dist', mod.path);
        const fullSourcePath = path.join(pkgDir, sourcePath);
        if (!fs.existsSync(fullSourcePath)) continue;

        const stylePath = sourcePath.replace(/\.component\.js$/, '.styles.js');
        let cssPath: string | undefined;
        if (fs.existsSync(path.join(pkgDir, stylePath))) {
          cssPath = stylePath;
        }

        const desc: ComponentDescriptor = {
          name: dec.tagName.replace(/^mdc-/, ''),
          tag: dec.tagName,
          pkg,
          source: sourcePath,
          ...(cssPath ? { css: cssPath } : {}),
          ...(dec.name ? { className: dec.name } : {}),
        };
        validateComponentDescriptor(desc);
        components.push(desc);
      }
    }
  }

  components.sort((a, b) => a.tag.localeCompare(b.tag));
  return components;
}

// 284 Carbon Web Components (validated against @carbon/web-components/custom-elements.json)
export const CARBON_COMPONENTS: ComponentDescriptor[] = loadCarbonComponents();

// 93 Spectrum Web Components (validated against @spectrum-web-components subpackage manifests)
export const SPECTRUM_COMPONENTS: ComponentDescriptor[] = loadSpectrumComponents();

// 73 Web Awesome Components (validated against @awesome.me/webawesome/dist/custom-elements.json)
export const WEBAWESOME_COMPONENTS: ComponentDescriptor[] = loadWebAwesomeComponents();

// 54 Material Web components (validated against @material/web/custom-elements.json)
export const MATERIAL_COMPONENTS: ComponentDescriptor[] = loadMaterialComponents();

// 97 Momentum Design components (validated against @momentum-design/components/dist/custom-elements.json)
export const MOMENTUM_COMPONENTS: ComponentDescriptor[] = loadMomentumComponents();
