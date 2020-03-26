import { getServer, LocalNpmServer } from "../server";
import { getArgs } from "../arguments";
import { getConfig } from "../config";
import { walkAllLocalModules } from "../dry-dependency-tree";
import {fetchLocalModule} from "../fetch";
import {installModuleDepsIfNotInitialized} from "../deps";


export async function fetchCommand() {
  const args = getArgs();

  if (args.subCommand !== "fetch") {
    return;
  }

  await LocalNpmServer.init();

  try {
    const config = getConfig();

    for (let module of config.modules) {
      await fetchLocalModule(module);
    }

    if (!args.noInstall) {
      await walkAllLocalModules(async module => {
        await installModuleDepsIfNotInitialized(module);
      });
    }
  } finally {
    await getServer().stop();
  }
}
