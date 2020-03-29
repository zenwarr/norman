import { getRegistry, NpmRegistry } from "../registry";
import { getArgs } from "../arguments";
import { walkAllLocalModules } from "../dry-dependency-tree";
import {fetchLocalModule} from "../fetch";
import {installModuleDepsIfNotInitialized} from "../deps";


export async function syncAllCommand() {
  let args = getArgs();

  if (args.subCommand !== "sync-all") {
    return;
  }

  await NpmRegistry.init();

  try {
    await walkAllLocalModules(async module => fetchLocalModule(module));

    await walkAllLocalModules(async module => installModuleDepsIfNotInitialized(module));
  } finally {
    getRegistry().stop();
  }
}
