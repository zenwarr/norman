import * as chalk from "chalk";
import { getConfig } from "../config";


export async function listModulesCommand() {
  const config = getConfig();

  console.log(chalk.green("-- BEGIN MODULES LIST"));
  for (let module of config.modules) {
    console.log(`${ module.name }: ${ module.path }`);
  }
  console.log(chalk.green("-- END MODULES LIST"));

  process.exit(0);
}
