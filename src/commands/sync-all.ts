import { getServer, LocalNpmServer } from "../server";
import { ModuleSynchronizer } from "../module-synchronizer";
import * as chalk from "chalk";
import { getArgs } from "../arguments";
import { walkAllLocalModules } from "../dry-dependency-tree";
import { getConfig } from "../config";


export async function syncAllCommand() {
  let args = getArgs();

  if (args.subCommand !== "sync-all") {
    return;
  }

  let shouldBuild = args.buildDeps;

  await LocalNpmServer.init();

  try {
    await walkAllLocalModules(async module => module.fetch());
    await walkAllLocalModules(async module => module.installIfDepsNotInitialized());

    await ModuleSynchronizer.syncRoots(getConfig().modules, shouldBuild);
  } finally {
    await getServer().stop();
  }
}
