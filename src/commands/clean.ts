import * as chalk from "chalk";
import { getArgs } from "../arguments";
import { getStateManager } from "../module-state-manager";


export function cleanCommand() {
  let args = getArgs();

  if (args.subCommand !== "clean") {
    return;
  }

  if (args.cleanWhat === "state" || args.cleanWhat === "all") {
    console.log(chalk.green("Cleaning stored modules state"));
    getStateManager().clearSavedState();
  }
}
