import { getServer, LocalNpmServer } from "../server";
import { ModuleSynchronizer } from "../module-synchronizer";
import { getArgs } from "../arguments";
import { walkAllLocalModules } from "../dry-dependency-tree";
import { getConfig } from "../config";
import {fetchLocalModule} from "../fetch";
import {installModuleDepsIfNotInitialized} from "../deps";


export async function syncAllCommand() {
  let args = getArgs();

  if (args.subCommand !== "sync-all") {
    return;
  }

  await LocalNpmServer.init();

  try {
    await walkAllLocalModules(async module => fetchLocalModule(module));

    await walkAllLocalModules(async module => installModuleDepsIfNotInitialized(module));

    await ModuleSynchronizer.syncRoots(getConfig().modules, true);
  } finally {
    await getServer().stop();
  }
}
