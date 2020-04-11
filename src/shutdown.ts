import { getRegistryIfExists } from "./registry";


export function shutdown(exitCode?: number): never {
  let registry = getRegistryIfExists();
  if (registry) {
    registry.stop();
  }

  process.exit(exitCode);
}
