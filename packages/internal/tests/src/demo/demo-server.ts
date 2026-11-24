import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { propsLower, serverElements } from '@lit-core/vite-plugin';
import { build } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const testsRoot = path.resolve(here, '../..');
const repoRoot = path.resolve(testsRoot, '../../..');
const workerdBin = path.join(repoRoot, 'node_modules/.bin/workerd');
const ssrWasmSource = path.join(repoRoot, 'packages/rendering/ssr/wasm/ssr_bg.wasm');

export interface DemoServer {
  /** Origin the demo answers on, such as `http://127.0.0.1:41873`. */
  origin: string;
  /** Output of the workerd process so far, for diagnosing a failed start. */
  log(): string;
  stop(): Promise<void>;
}

export interface DemoOptions {
  /** Directory the bundles and workerd config are written to. */
  outDir: string;
  /** Signing secret handed to the worker as a binding. */
  secret?: string;
  /** Signed state lifetime in milliseconds. Leave unset for the library default. */
  stateTtlMs?: number;
}

function firstOutput(result: unknown): { code: string } {
  const outputs = Array.isArray(result) ? (result[0] as { output: Array<{ type: string; code?: string }> }).output : (result as { output: Array<{ type: string; code?: string }> }).output;
  const chunk = outputs.find((o) => o.type === 'chunk');
  return { code: chunk?.code ?? '' };
}

async function buildBundles(outDir: string): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });

  const client = await build({
    root: testsRoot,
    logLevel: 'silent',
    configFile: false,
    build: { write: false, minify: false, rollupOptions: { input: path.join(here, 'client.ts'), output: { format: 'es' } } },
    plugins: [propsLower(), serverElements({ target: 'client', autoInjectExecutor: true })],
  });
  fs.writeFileSync(path.join(outDir, 'client.js'), firstOutput(client).code);

  await build({
    root: testsRoot,
    logLevel: 'silent',
    configFile: false,
    build: {
      write: true,
      outDir,
      emptyOutDir: false,
      minify: false,
      ssr: true,
      rollupOptions: { input: path.join(here, 'worker.ts'), external: ['./ssr_bg.wasm'], output: { format: 'es', entryFileNames: 'worker.js' } },
    },
    ssr: { noExternal: true },
    plugins: [propsLower(), serverElements({ target: 'worker' })],
  });

  const emittedWasm = path.join(outDir, 'ssr_bg.wasm');
  if (!fs.existsSync(emittedWasm)) fs.copyFileSync(ssrWasmSource, emittedWasm);
}

/** Asks the OS for a free loopback port, which workerd then binds. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function workerdConfig(port: number, secret: string, stateTtlMs?: number): string {
  return `using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [ ( name = "main", worker = .mainWorker ) ],
  sockets = [ ( name = "http", address = "127.0.0.1:${port}", http = (), service = "main" ) ],
);

const mainWorker :Workerd.Worker = (
  modules = [
    ( name = "worker", esModule = embed "worker.js" ),
    ( name = "./ssr_bg.wasm", wasm = embed "ssr_bg.wasm" ),
  ],
  bindings = [
    ( name = "SECRET", text = ${JSON.stringify(secret)} ),
${stateTtlMs === undefined ? '' : `    ( name = "STATE_TTL_MS", text = ${JSON.stringify(String(stateTtlMs))} ),\n`}
    ( name = "CLIENT_JS", text = embed "client.js" ),
    ( name = "TODOS", durableObjectNamespace = "TodoStore" ),
    ( name = "REPLAYS", durableObjectNamespace = "ReplayGuardStore" ),
  ],
  durableObjectNamespaces = [
    ( className = "TodoStore", uniqueKey = "demo-todos" ),
    ( className = "ReplayGuardStore", uniqueKey = "demo-replays" ),
  ],
  durableObjectStorage = ( inMemory = void ),
  compatibilityDate = "2024-01-01",
  compatibilityFlags = ["nodejs_compat"],
);
`;
}

async function waitUntilServing(origin: string, process: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`workerd exited early (${process.exitCode}):\n${log()}`);
    try {
      const response = await fetch(`${origin}/client.js`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`workerd did not start serving within 20s:\n${log()}`);
}

/**
 * Builds the demo and runs it in the real `workerd` binary on a loopback port the OS picked.
 * Only the demo's own worker is served, and `stop()` ends the process.
 */
export async function startDemo(options: DemoOptions): Promise<DemoServer> {
  await buildBundles(options.outDir);
  const port = await freePort();
  const configPath = path.join(options.outDir, 'workerd.capnp');
  fs.writeFileSync(configPath, workerdConfig(port, options.secret ?? 'demo-secret-at-least-32-characters-long', options.stateTtlMs));

  let output = '';
  const child = spawn(workerdBin, ['serve', configPath], { cwd: options.outDir });
  child.stdout?.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr?.on('data', (chunk) => {
    output += chunk;
  });

  const origin = `http://127.0.0.1:${port}`;
  const log = () => output;
  try {
    await waitUntilServing(origin, child, log);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }

  return {
    origin,
    log,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
}
