import * as chalk from "chalk";
import { LocalNpmServer } from "../server";
import { ModuleStateManager } from "../module-state-manager";
import { ModulePackager } from "../module-packager";
import { getArgs } from "../arguments";


export function cleanCommand() {
  let args = getArgs();

  if (args.subCommand !== "clean") {
    return;
  }

  if (args.cleanWhat === "cache" || args.cleanWhat === "all") {
    console.log(chalk.green("Cleaning local npm server cache"));
    LocalNpmServer.cleanCache();
  }

  if (args.cleanWhat === "state" || args.cleanWhat === "all") {
    console.log(chalk.green("Cleaning stored modules state"));
    ModuleStateManager.cleanState();
  }

  if (args.cleanWhat === "all") {
    console.log(chalk.green("Cleaning temp files"));
    ModulePackager.cleanTemp();
  }
}
