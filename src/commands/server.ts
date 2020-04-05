import * as chalk from "chalk";
import { NpmRegistry } from "../registry";
import { getConfig, RegistryServerType } from "../config/config";
import { shutdown } from "../shutdown";


export async function startServerCommand() {
  let config = getConfig();

  if (config.registryServerType !== RegistryServerType.ManagedLocal) {
    console.error(chalk.red("Cannot start local npm registry server: not configured to use local managed registry"));
    shutdown(-1);
  }

  await NpmRegistry.init();
}
