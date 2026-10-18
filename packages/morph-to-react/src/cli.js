#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModule } from './index.js';

export function parseArgs(args) {
  const inputs = [];
  let outDir = 'dist/react';
  let suffix;
  let emitCss = false;
  let emitDts = true;
  let tsconfig;
  let stripPrefix;
  let targetTier;
  let noCache = false;
  let help = false;
  let version = false;

  let i = 0;
  if (args[0] === 'build') {
    i = 1;
  }

  while (i < args.length) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--version' || arg === '-v') {
      version = true;
    } else if (arg === '--out-dir' || arg === '-o') {
      i++;
      if (args[i]) outDir = args[i];
    } else if (arg.startsWith('--out-dir=')) {
      outDir = arg.slice('--out-dir='.length);
    } else if (arg === '--suffix') {
      i++;
      if (args[i]) suffix = args[i];
    } else if (arg.startsWith('--suffix=')) {
      suffix = arg.slice('--suffix='.length);
    } else if (arg === '--emit-css') {
      emitCss = true;
    } else if (arg === '--no-css') {
      emitCss = false;
    } else if (arg === '--emit-dts' || arg === '--dts') {
      emitDts = true;
    } else if (arg === '--no-dts') {
      emitDts = false;
    } else if (arg === '--tsconfig' || arg === '-p') {
      i++;
      if (args[i]) tsconfig = args[i];
    } else if (arg.startsWith('--tsconfig=')) {
      tsconfig = arg.slice('--tsconfig='.length);
    } else if (arg === '--strip-prefix') {
      i++;
      if (args[i]) stripPrefix = args[i];
    } else if (arg.startsWith('--strip-prefix=')) {
      stripPrefix = arg.slice('--strip-prefix='.length);
    } else if (arg === '--target-tier') {
      i++;
      if (args[i]) targetTier = args[i];
    } else if (arg.startsWith('--target-tier=')) {
      targetTier = arg.slice('--target-tier='.length);
    } else if (arg === '--no-cache') {
      noCache = true;
    } else if (!arg.startsWith('-')) {
      inputs.push(arg);
    }
    i++;
  }

  return {
    inputs: inputs.length > 0 ? inputs : ['src/**/*.{ts,tsx,js,jsx}'],
    outDir,
    suffix,
    emitCss,
    emitDts,
    tsconfig,
    stripPrefix,
    targetTier,
    noCache,
    help,
    version,
  };
}

export function printHelp() {
  console.log(`
Usage: morph-to-react [build] [patterns...] [options]

Ahead-of-time compiler lowering Lit components to native React 19 components.

Options:
  -o, --out-dir <dir>       Output directory for generated React components (default: dist/react)
  --suffix <suffix>         Suffix to append to host element tag names (e.g. -r)
  --emit-css                Emit separate .css files alongside components
  --no-dts                  Disable TypeScript .d.ts generation
  -p, --tsconfig <path>     Path to tsconfig.json
  --strip-prefix <prefix>   Component class or tag prefix to strip
  --target-tier <tier>      Force compilation tier (Tier0Pure, Tier1Hosted, Tier2HostedWithFacade, Bailout)
  --no-cache                Disable content-hashed incremental build caching
  -h, --help                Show this help message
  -v, --version             Show version number
`);
}

function resolveFiles(patterns) {
  const files = [];

  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      if (typeof fs.globSync === 'function') {
        const matches = fs.globSync(pattern);
        for (const m of matches) {
          if (typeof m === 'string') files.push(m);
        }
      } else {
        const baseDir = pattern.split('*')[0] || '.';
        if (fs.existsSync(baseDir)) {
          const scan = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const full = path.join(dir, entry.name);
              if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
                scan(full);
              } else if (entry.isFile() && /\.[jt]sx?$/.test(entry.name)) {
                files.push(full);
              }
            }
          };
          scan(baseDir);
        }
      }
    } else if (fs.existsSync(pattern)) {
      const stat = fs.statSync(pattern);
      if (stat.isDirectory()) {
        const scan = (dir) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
              scan(full);
            } else if (entry.isFile() && /\.[jt]sx?$/.test(entry.name)) {
              files.push(full);
            }
          }
        };
        scan(pattern);
      } else {
        files.push(pattern);
      }
    }
  }

  return [...new Set(files)];
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help) {
    printHelp();
    return 0;
  }

  if (options.version) {
    console.log('morph-to-react 0.1.0');
    return 0;
  }

  const files = resolveFiles(options.inputs);
  if (files.length === 0) {
    console.log('No matching files found for compilation.');
    return 0;
  }

  const outDir = path.resolve(process.cwd(), options.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const startTime = Date.now();
  let compiledCount = 0;
  let tier0Count = 0;
  let tier1Count = 0;
  let tier2Count = 0;
  let bailoutCount = 0;

  for (const file of files) {
    const sourceText = fs.readFileSync(file, 'utf-8');
    if (!sourceText.includes('LitElement') && !sourceText.includes('ReactiveElement') && !sourceText.includes('html`')) {
      continue;
    }

    try {
      const result = compileModule(sourceText, {
        filePath: file,
        emitCss: options.emitCss,
        emitDts: options.emitDts,
        tagSuffix: options.suffix,
        stripPrefix: options.stripPrefix,
        targetTier: options.targetTier,
        noCache: options.noCache,
      });

      if (result.tier === 'None' || !result.componentName) {
        continue;
      }

      compiledCount++;
      if (result.tier === 'Tier0Pure') tier0Count++;
      else if (result.tier === 'Tier1Hosted') tier1Count++;
      else if (result.tier === 'Tier2HostedWithFacade') tier2Count++;
      else if (result.tier === 'Bailout') bailoutCount++;

      const baseName = path.basename(file, path.extname(file));
      const outCodeFile = path.join(outDir, `${baseName}.jsx`);
      fs.writeFileSync(outCodeFile, result.code, 'utf-8');

      if (options.emitDts && result.dts) {
        const outDtsFile = path.join(outDir, `${baseName}.d.ts`);
        fs.writeFileSync(outDtsFile, result.dts, 'utf-8');
      }

      if (options.emitCss && result.css) {
        const outCssFile = path.join(outDir, `${baseName}.css`);
        fs.writeFileSync(outCssFile, result.css, 'utf-8');
      }
    } catch (err) {
      console.error(`Error compiling ${file}: ${err?.message || err}`);
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(`Successfully compiled ${compiledCount} component(s) into ${options.outDir} in ${durationMs}ms`);
  console.log(`Tier breakdown: ${tier0Count} pure, ${tier1Count} hosted, ${tier2Count} facade, ${bailoutCount} bailout`);

  return 0;
}

if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('cli.js'))) {
  runCli().then((code) => {
    if (code !== 0) process.exit(code);
  });
}
