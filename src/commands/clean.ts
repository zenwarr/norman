import * as chalk from "chalk";
import { getServer} from "../server";
import { getArgs } from "../arguments";
import { getStateManager } from "../module-state-manager";
import { getPublisher } from "../ModulePublisher";


export function cleanCommand() {
  let args = getArgs();

  if (args.subCommand !== "clean") {
    return;
  }

  if (args.cleanWhat === "cache" || args.cleanWhat === "all") {
    console.log(chalk.green("Cleaning local npm server cache"));
    getServer().cleanCache();
  }

  if (args.cleanWhat === "state" || args.cleanWhat === "all") {
    console.log(chalk.green("Cleaning stored modules state"));
    getStateManager().clearSavedState();
  }

  if (args.cleanWhat === "all") {
    console.log(chalk.green("Cleaning temp files"));
    getPublisher().cleanTemp();
  }
}
