import * as chalk from "chalk";
import { getServer, LocalNpmServer } from "../server";
import * as path from "path";
import { ModulesFeeder } from "../module-watcher";
import { ModuleSynchronizer } from "../module-synchronizer";
import { getArgs } from "../arguments";
import { getConfig } from "../config";


export async function syncCommand() {
  let args = getArgs();
  let config = getConfig();

  if (args.subCommand !== "sync") {
    return;
  }

  if (args.buildDeps && args.watch) {
    console.log(chalk.red("--build-deps cannot be used with --watch"));
    process.exit();
    return;
  }

  await LocalNpmServer.init();

  try {
    let argPath = args.path;
    let localModule = config.modules.find(module => {
      return module.name === argPath;
    });

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

    if (!localModule.needsNpmInstall) {
      console.log(chalk.red(`Cannot sync module: 'npmInstall' for module ${ localModule.name } is false`));
      process.exit(-1);
      return;
    }

    if (args.watch) {
      let feeder = new ModulesFeeder([ localModule ]);
      await feeder.start();
    } else {
      let synchronizer = new ModuleSynchronizer(localModule);
      await synchronizer.sync(args.buildDeps);
    }
  } finally {
    if (!args.watch) {
      await getServer().stop();
    }
  }
}
