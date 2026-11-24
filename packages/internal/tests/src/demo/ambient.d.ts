declare module 'virtual:lit-core/install-globals';

declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
