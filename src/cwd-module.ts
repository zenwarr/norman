import * as chalk from "chalk";
import { shutdown } from "./shutdown";
import { getProject } from "./project";

export function getCwdModule() {
  let project = getProject();

  let dir = process.cwd();
  let mod = project.modules.find(m => m.path === dir);
  if (!mod) {
    console.error(chalk.red("No local module found inside current working directory"));
    shutdown(-1);
  }

  return mod;
}
