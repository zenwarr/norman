import { getServer, LocalNpmServer } from "../server";
import { ModuleSynchronizer } from "../module-synchronizer";
import * as chalk from "chalk";
import { getArgs } from "../arguments";
import { getConfig } from "../config";
import { walkDependencyTree } from "../dependency-tree";
import { fetchModules, installModules } from "../fetcher";
import { ModulePackager } from "../module-packager";


export async function syncAllCommand() {
  let args = getArgs();
  let config = getConfig();

  if (args.subCommand !== "sync-all") {
    return;
  }

  let buildDeps = args.buildDeps;

  await LocalNpmServer.init();
  await ModulePackager.prepackLocalModules();

  try {
    await fetchModules();
    await installModules();

    await walkDependencyTree(config.modules, async localModule => {
      if (localModule.needsNpmInstall) {
        let synchronizer = new ModuleSynchronizer(localModule);
        await synchronizer.sync(buildDeps);
      } else {
        console.log(chalk.yellow(`Skipping sync for module ${ localModule.name } because npmInstall for this module is false`));
      }
    });
  } finally {
    await getServer().stop();
  }
}
