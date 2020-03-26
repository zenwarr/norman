import * as chalk from "chalk";
import { getServer, LocalNpmServer } from "../server";
import * as path from "path";
import { getArgs } from "../arguments";
import { getConfig } from "../config";
import { ModuleSynchronizer } from "../module-synchronizer";


export async function syncCommand() {
  let args = getArgs();
  let config = getConfig();

  if (args.subCommand !== "sync") {
    return;
  }

  await LocalNpmServer.init();

  try {
    let argPath = args.path;
    let localModule = config.modules.find(module => module.name && module.name.name === argPath);

    if (!localModule) {
      if (!path.isAbsolute(argPath)) {
        argPath = path.resolve(config.mainConfigDir, argPath);
      }

      if (!argPath.endsWith("/")) {
        argPath += "/";
      }

      localModule = config.modules.find(module => {
        let modulePath = module.path;
        if (!modulePath.endsWith("/")) {
          modulePath += "/";
        }

        return path.normalize(modulePath) === path.normalize(argPath);
      });

      if (!localModule) {
        console.log(chalk.red(`No local module found with name "${ argPath }" or at "${ argPath }"`));
        process.exit(-1);
        throw new Error();
      }
    }

    if (!localModule.useNpm) {
      console.log(chalk.red(`Cannot sync module: 'npmInstall' for module ${ localModule.name } is false`));
      process.exit(-1);
      return;
    }

    await ModuleSynchronizer.syncRoots([ localModule ], true);
  } finally {
    await getServer().stop();
  }
}
