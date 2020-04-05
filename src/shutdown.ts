import { getRegistryIfExists } from "./registry";


export function shutdown(exitCode?: number): never {
  let server = getRegistryIfExists();
  if (server) {
    server.stop();
  }

  process.exit(exitCode);
}
