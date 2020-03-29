import { getArgs } from "../arguments";
import { getProject } from "../project";
import * as chalk from "chalk";
import { LocalModule } from "../local-module";


export async function publishCommand() {
  let args = getArgs();
  let config = getProject();

  if (args.subCommand !== "publish") {
    return;
  }

  let moduleDir = process.cwd();
  let module = config.modules.find(mod => mod.path === moduleDir);
  if (!module) {
    console.error(chalk.red("No local module found in current working directory"));
    process.exit(-1);
  }

  publishModule(module);
}


function publishModule(mod: LocalModule) {
  throw new Error("Method not implemented");
}
