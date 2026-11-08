import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';
import { globSync } from 'tinyglobby';
import { compileModule } from './index.js';

export interface CliOptions {
  inputs: string[];
  outDir: string;
  suffix?: string;
  emitCss: boolean;
  emitDts: boolean;
  tsconfig?: string;
  stripPrefix?: string;
  targetTier?: 'Tier0Pure' | 'Tier1Hosted' | 'Tier2HostedWithFacade' | 'Bailout';
  noCache?: boolean;
}

export function parseArgs(args: string[]): CliOptions & { help?: boolean; version?: boolean } {
  const effectiveArgs = args[0] === 'build' ? args.slice(1) : args;
  const { values, positionals } = nodeParseArgs({
    args: effectiveArgs,
    allowPositionals: true,
    allowNegative: true,
    strict: false,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      'out-dir': { type: 'string', short: 'o', default: 'dist/react' },
      suffix: { type: 'string' },
      'emit-css': { type: 'boolean' },
      css: { type: 'boolean' },
      'emit-dts': { type: 'boolean' },
      dts: { type: 'boolean' },
      tsconfig: { type: 'string', short: 'p' },
      'strip-prefix': { type: 'string' },
      'target-tier': { type: 'string' },
      cache: { type: 'boolean', default: true },
    },
  });

  const emitCss = values['emit-css'] !== undefined ? Boolean(values['emit-css']) : values.css !== undefined ? Boolean(values.css) : false;
  const emitDts = values['emit-dts'] !== undefined ? Boolean(values['emit-dts']) : values.dts !== undefined ? Boolean(values.dts) : true;
  const noCache = values.cache === false;

  return {
    inputs: positionals.length > 0 ? positionals : ['src/**/*.{ts,tsx,js,jsx}'],
    outDir: (values['out-dir'] as string) || 'dist/react',
    suffix: values.suffix as string | undefined,
    emitCss,
    emitDts,
    tsconfig: values.tsconfig as string | undefined,
    stripPrefix: values['strip-prefix'] as string | undefined,
    targetTier: values['target-tier'] as CliOptions['targetTier'],
    noCache,
    help: Boolean(values.help),
    version: Boolean(values.version),
  };
}

export function printHelp(): void {
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

function resolveFiles(patterns: string[]): string[] {
  const files: string[] = [];

  for (const pattern of patterns) {
    if (pattern.includes('*') || pattern.includes('?') || pattern.includes('{')) {
      const matches = globSync(pattern, {
        ignore: ['**/node_modules/**', '**/.git/**'],
      });
      files.push(...matches);
    } else if (fs.existsSync(pattern)) {
      const stat = fs.statSync(pattern);
      if (stat.isDirectory()) {
        const matches = globSync('**/*.{ts,tsx,js,jsx}', {
          cwd: pattern,
          ignore: ['**/node_modules/**', '**/.git/**'],
        }).map((m) => path.join(pattern, m));
        files.push(...matches);
      } else {
        files.push(pattern);
      }
    }
  }

  return [...new Set(files)];
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
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
    // Fast check for Lit component indicators
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
    } catch (err: any) {
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
