import { getProject } from "../project";
import * as chalk from "chalk";
import { LocalModule } from "../local-module";
import { shutdown } from "../shutdown";


export async function publishCommand() {
  let config = getProject();

  let moduleDir = process.cwd();
  let module = config.modules.find(mod => mod.path === moduleDir);
  if (!module) {
    console.error(chalk.red("No local module found in current working directory"));
    shutdown(-1);
  }

  publishModule(module);
}


function publishModule(mod: LocalModule) {
  throw new Error("Method not implemented");
}
