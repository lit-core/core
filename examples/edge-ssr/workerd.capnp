using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    ( name = "app", worker = .edgeAppWorker ),
    ( name = "clientDisk", disk = "dist/client" ),
  ],
  sockets = [
    ( name = "http", address = "*:8787", http = (), service = "app" ),
  ],
);

const edgeAppWorker :Workerd.Worker = (
  modules = [
    ( name = "worker", esModule = embed "dist/worker/worker.js" ),
  ],
  bindings = [
    ( name = "LIT_ACTION_SECRET", text = "local-workerd-edge-ssr-secret-32b!" ),
    ( name = "ASSETS", service = "clientDisk" ),
  ],
  compatibilityDate = "2024-01-01",
  compatibilityFlags = ["nodejs_compat"],
);
