import { getServer, LocalNpmServer } from "../server";
import { getArgs } from "../arguments";
import { getConfig } from "../config";
import { walkAllLocalModules } from "../dry-dependency-tree";


export async function fetchCommand() {
  const args = getArgs();

  if (args.subCommand !== "fetch") {
    return;
  }

  await LocalNpmServer.init();

  try {
    const config = getConfig();

    for (let module of config.modules) {
      await module.fetch();
    }

    if (!args.noInstall) {
      await walkAllLocalModules(async module => {
        await module.installIfDepsNotInitialized();
      });
    }
  } finally {
    await getServer().stop();
  }
}
